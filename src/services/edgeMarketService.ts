import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import {
  EDGE_FUNCTIONS,
  StockMarket,
  type DividendInfoRequest,
  type DividendInfoResponse,
  type ExchangeRateResponse,
  type MarketHistoryRequest,
  type MarketHistoryResponse,
  type MarketIndexRequest,
  type MarketIndexResponse,
  type MarketQuotesRequest,
  type MarketQuotesResponse,
  type Stock,
  type StockListSyncRequest,
  type StockListSyncResponse,
  type TaiwanCalendarRequest,
  type TaiwanCalendarResponse,
} from "@/types";
import type {
  BundledStockRecord,
  TaiwanHolidayCalendarAsset,
  TaiwanHolidayCalendarSnapshot,
  UsdTwdExchangeRate,
} from "@/types/market";
import {
  getDemoDividendInfo,
  getDemoExchangeRate,
  getDemoTaiwanIndex,
  loadDemoState,
} from "./localDemoStore";

const FX_CACHE_KEY = "stockify_fx_cache_v1";
const CALENDAR_CACHE_KEY = "stockify_tw_calendar_cache_v1";
const STOCK_LIST_SYNC_KEY_PREFIX = "stockify_stock_list_sync_v1_";
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let fallbackToastShownInSession = false;
let certificateToastShownInSession = false;
let lastCalendarFailureAt = 0;

export function resetSessionToastFlags(): void {
  fallbackToastShownInSession = false;
  certificateToastShownInSession = false;
}

export function consumeFallbackToastMessage(
  fallbackUsed: boolean,
  notifyRepeatedly: boolean,
): string | null {
  if (!fallbackUsed) return null;
  if (!notifyRepeatedly && fallbackToastShownInSession) return null;
  fallbackToastShownInSession = true;
  return "部分股票主要來源異常，部分改用備用來源";
}

export function consumeCertificateToastMessage(
  certificateFailure: boolean,
): string | null {
  if (!certificateFailure || certificateToastShownInSession) return null;
  certificateToastShownInSession = true;
  return "抓取報價憑證失效";
}

export async function invokeMarketQuotes(
  request: MarketQuotesRequest,
): Promise<MarketQuotesResponse> {
  if (!isSupabaseConfigured) {
    const demo = loadDemoState();
    const quotes: MarketQuotesResponse["quotes"] = {};
    for (const target of request.stocks) {
      const key = `${target.market}:${target.code.trim().toUpperCase()}`;
      if (demo.quotes[key]) {
        quotes[key] = demo.quotes[key];
      }
    }
    return {
      quotes,
      fallbackUsed: false,
      certificateFailure: false,
    };
  }

  const { data, error } = await supabase.functions.invoke<MarketQuotesResponse>(
    EDGE_FUNCTIONS.MARKET_QUOTES,
    { body: request },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from market-quotes");
  return data;
}

export async function invokeMarketHistory(
  request: MarketHistoryRequest,
): Promise<MarketHistoryResponse> {
  if (!isSupabaseConfigured) {
    const demo = loadDemoState();
    const code = request.code.trim().toUpperCase();
    const key = `${request.market}:${code}`;
    const points = (demo.history[key] ?? []).filter(
      (p) => p.date >= request.fromDate && p.date <= request.toDate,
    );
    return {
      market: request.market,
      code,
      points,
      fromCache: true,
    };
  }

  const { data, error } =
    await supabase.functions.invoke<MarketHistoryResponse>(
      EDGE_FUNCTIONS.MARKET_HISTORY,
      { body: request },
    );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from market-history");
  return data;
}

export async function invokeMarketIndex(
  request: MarketIndexRequest = {},
): Promise<MarketIndexResponse> {
  if (!isSupabaseConfigured) {
    return {
      index: getDemoTaiwanIndex(),
      fallbackUsed: false,
    };
  }

  const { data, error } = await supabase.functions.invoke<MarketIndexResponse>(
    EDGE_FUNCTIONS.MARKET_INDEX,
    { body: request },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from market-index");
  return data;
}

export async function fetchUsdTwdExchangeRate(
  forceRefresh = false,
): Promise<UsdTwdExchangeRate> {
  if (!forceRefresh && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(FX_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as UsdTwdExchangeRate;
        if (
          Number.isFinite(cached.rate) &&
          cached.rate > 0 &&
          Date.now() - cached.updatedAtMillis < TWENTY_FOUR_HOURS_MS
        ) {
          return cached;
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }

  if (!isSupabaseConfigured) {
    const rate = getDemoExchangeRate();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(rate));
    }
    return rate;
  }

  const { data, error } = await supabase.functions.invoke<ExchangeRateResponse>(
    EDGE_FUNCTIONS.EXCHANGE_RATE,
    { body: {} },
  );
  if (error) throw new Error(error.message);
  if (!data?.exchangeRate) {
    throw new Error("Empty response from exchange-rate");
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      FX_CACHE_KEY,
      JSON.stringify(data.exchangeRate),
    );
  }
  return data.exchangeRate;
}

function calendarAssetToSnapshot(
  year: number,
  asset: TaiwanHolidayCalendarAsset,
): TaiwanHolidayCalendarSnapshot {
  const holidays: Record<string, boolean> = {};
  for (const item of asset.items) {
    const iso =
      item.date.length === 8
        ? `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}`
        : item.date;
    holidays[iso] = Boolean(item.isHoliday);
  }
  return {
    year,
    calendarVersion: asset.calendarVersion,
    updatedAtEpochMillis: Date.now(),
    holidays,
    source: asset.source,
  };
}

async function loadBundledTaiwanCalendar(
  year: number,
): Promise<TaiwanHolidayCalendarSnapshot | null> {
  if (year !== 2026 && year !== 2027) return null;
  try {
    const res = await fetch(`/data/taiwan_calendar/${year}.json`);
    if (!res.ok) return null;
    const asset = (await res.json()) as TaiwanHolidayCalendarAsset;
    if (!Array.isArray(asset.items) || asset.items.length === 0) return null;
    return calendarAssetToSnapshot(year, asset);
  } catch {
    return null;
  }
}

export async function fetchTaiwanHolidayCalendar(
  year: number,
  forceRefresh = false,
): Promise<TaiwanHolidayCalendarSnapshot | null> {
  if (typeof window !== "undefined" && !forceRefresh) {
    try {
      const raw = window.localStorage.getItem(CALENDAR_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as TaiwanHolidayCalendarSnapshot;
        if (
          cached.year === year &&
          Date.now() - cached.updatedAtEpochMillis < TWENTY_FOUR_HOURS_MS
        ) {
          return cached;
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }

  if (
    !forceRefresh &&
    lastCalendarFailureAt > 0 &&
    Date.now() - lastCalendarFailureAt < CALENDAR_RETRY_COOLDOWN_MS
  ) {
    return loadBundledTaiwanCalendar(year);
  }

  if (isSupabaseConfigured) {
    try {
      const req: TaiwanCalendarRequest = { year };
      const { data, error } =
        await supabase.functions.invoke<TaiwanCalendarResponse>(
          EDGE_FUNCTIONS.TAIWAN_CALENDAR,
          { body: req },
        );
      if (!error && data?.calendar?.items?.length) {
        lastCalendarFailureAt = 0;
        const snapshot = calendarAssetToSnapshot(year, data.calendar);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            CALENDAR_CACHE_KEY,
            JSON.stringify(snapshot),
          );
        }
        return snapshot;
      }
      lastCalendarFailureAt = Date.now();
    } catch {
      lastCalendarFailureAt = Date.now();
    }
  }

  const bundled = await loadBundledTaiwanCalendar(year);
  if (bundled && typeof window !== "undefined") {
    window.localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(bundled));
  }
  return bundled;
}

export function shouldSyncStockList(market: StockMarket): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(
    `${STOCK_LIST_SYNC_KEY_PREFIX}${market}`,
  );
  if (!raw) return true;
  const lastSync = Number(raw);
  if (!Number.isFinite(lastSync)) return true;
  return Date.now() - lastSync >= SEVEN_DAYS_MS;
}

export async function invokeStockListSync(
  market: StockMarket,
): Promise<StockListSyncResponse> {
  if (!isSupabaseConfigured) {
    const demo = loadDemoState();
    const filtered = demo.stocks.filter((s) => s.market === market);
    return {
      market,
      syncedCount: filtered.length,
      updatedAtMillis: Date.now(),
      stocks: filtered,
    };
  }

  const req: StockListSyncRequest = { market };
  const { data, error } =
    await supabase.functions.invoke<StockListSyncResponse>(
      EDGE_FUNCTIONS.STOCK_LIST_SYNC,
      { body: req },
    );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from stock-list-sync");

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      `${STOCK_LIST_SYNC_KEY_PREFIX}${market}`,
      String(data.updatedAtMillis || Date.now()),
    );
  }
  return data;
}

export async function invokeDividendInfo(
  stockCodes: string[],
): Promise<DividendInfoResponse> {
  const normalizedCodes = [
    ...new Set(stockCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  ];
  if (normalizedCodes.length === 0) {
    return { results: {} };
  }

  if (!isSupabaseConfigured) {
    return {
      results: getDemoDividendInfo(normalizedCodes),
    };
  }

  const req: DividendInfoRequest = { stockCodes: normalizedCodes };
  const { data, error } = await supabase.functions.invoke<DividendInfoResponse>(
    EDGE_FUNCTIONS.DIVIDEND_INFO,
    { body: req },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from dividend-info");
  return data;
}

function mapBundledStockRecord(
  record: BundledStockRecord,
  fallbackMarket: StockMarket,
): Stock {
  const isUs =
    fallbackMarket === StockMarket.US || record.market === StockMarket.US;
  return {
    market: isUs ? StockMarket.US : StockMarket.TW,
    code: record.code.trim().toUpperCase(),
    name: record.name.trim(),
    exchange: isUs ? "" : record.market || "",
    industry: record.industry || "",
    stockType: record.stockType || "",
  };
}

export async function loadBundledStocks(): Promise<Stock[]> {
  try {
    const [twRes, usRes] = await Promise.all([
      fetch("/data/stocks.json"),
      fetch("/data/us_stocks.json"),
    ]);
    const twRaw = twRes.ok
      ? ((await twRes.json()) as BundledStockRecord[])
      : [];
    const usRaw = usRes.ok
      ? ((await usRes.json()) as BundledStockRecord[])
      : [];

    return [
      ...twRaw.map((r) => mapBundledStockRecord(r, StockMarket.TW)),
      ...usRaw.map((r) => mapBundledStockRecord(r, StockMarket.US)),
    ];
  } catch {
    return [];
  }
}
