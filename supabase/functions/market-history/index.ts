import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createServiceRoleClient,
  errorResponse,
  handleCors,
  jsonResponse,
  requireAuthHeader,
} from "../_shared/cors.ts";
import {
  fetchTextWithRetry,
  parseFiniteNumber,
  safeJsonParse,
  sleep,
} from "../_shared/http.ts";

interface StockHistoryPoint {
  date: string;
  price: number;
}

const CHROME_HEADERS = { "User-Agent": "Chrome/120.0.0.0" };
const NASDAQ_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nasdaq.com/",
  Origin: "https://www.nasdaq.com",
};

function rocToGregorianDate(rocDate: string): string | null {
  const parts = rocDate.trim().split("/");
  if (parts.length !== 3) return null;
  const rocYear = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    !Number.isInteger(rocYear) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    rocYear <= 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const year = rocYear + 1911;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function usDateToIso(mmddyyyy: string): string | null {
  const parts = mmddyyyy.trim().split("/");
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function enumerateMonths(fromDate: string, toDate: string): string[] {
  const start = fromDate.slice(0, 7);
  const end = toDate.slice(0, 7);
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  if (!sy || !sm || !ey || !em) return [];

  const result: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (result.length > 36) break;
  }
  return result;
}

async function fetchTwMonth(
  code: string,
  exchange: string | undefined,
  yearMonth: string,
): Promise<StockHistoryPoint[]> {
  const [year, month] = yearMonth.replace("-", "/").split("/");
  if (!year || !month) return [];

  if (exchange === "興櫃") {
    const dateParam = encodeURIComponent(`${year}/${month}/01`);
    const url = `https://www.tpex.org.tw/www/zh-tw/emerging/historical?type=Monthly&date=${dateParam}&code=${encodeURIComponent(code)}&response=json`;
    const res = await fetchTextWithRetry(url, { headers: CHROME_HEADERS });
    if (!res.ok) return [];
    const payload = safeJsonParse<{
      stat?: string;
      tables?: Array<{ data?: unknown[][] }>;
    }>(res.text);
    if (payload?.stat?.toLowerCase() !== "ok") return [];
    const rows = payload.tables?.[0]?.data ?? [];
    const points: StockHistoryPoint[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length <= 5) continue;
      const date = rocToGregorianDate(String(row[0] ?? ""));
      const price = parseFiniteNumber(row[5]);
      if (date && price !== null && price > 0) {
        points.push({ date, price });
      }
    }
    return points;
  }

  if (exchange === "上櫃") {
    const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(code)}&date=${year}/${month}/01&response=json`;
    const res = await fetchTextWithRetry(url, { headers: CHROME_HEADERS });
    if (!res.ok) return [];
    const payload = safeJsonParse<{
      stat?: string;
      tables?: Array<{ data?: unknown[][] }>;
    }>(res.text);
    if (payload?.stat?.toLowerCase() !== "ok") return [];
    const rows = payload.tables?.[0]?.data ?? [];
    const points: StockHistoryPoint[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length <= 6) continue;
      const date = rocToGregorianDate(String(row[0] ?? ""));
      const price = parseFiniteNumber(row[6]);
      if (date && price !== null && price > 0) {
        points.push({ date, price });
      }
    }
    return points;
  }

  // Listed (上市) or default
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${year}${month}01&stockNo=${encodeURIComponent(code)}`;
  const res = await fetchTextWithRetry(url, { headers: CHROME_HEADERS });
  if (!res.ok) return [];
  const payload = safeJsonParse<{
    stat?: string;
    data?: unknown[][];
  }>(res.text);
  if (payload?.stat !== "OK") return [];
  const rows = payload.data ?? [];
  const points: StockHistoryPoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length <= 6) continue;
    const date = rocToGregorianDate(String(row[0] ?? ""));
    const price = parseFiniteNumber(row[6]);
    if (date && price !== null && price > 0) {
      points.push({ date, price });
    }
  }
  return points;
}

async function fetchNasdaqHistory(
  code: string,
  assetClass: "stocks" | "etf",
  fromDate: string,
  toDate: string,
): Promise<StockHistoryPoint[]> {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(code)}/historical?assetclass=${assetClass}&fromdate=${fromDate}&todate=${toDate}&limit=400`;
  const res = await fetchTextWithRetry(url, { headers: NASDAQ_HEADERS });
  if (!res.ok) return [];

  const payload = safeJsonParse<{
    data?: {
      tradesTable?: {
        rows?: Array<{ date?: string; close?: string }>;
      };
    };
  }>(res.text);

  const rows = payload?.data?.tradesTable?.rows ?? [];
  const points: StockHistoryPoint[] = [];
  for (const row of rows) {
    const date = usDateToIso(row.date ?? "");
    const price = parseFiniteNumber(row.close);
    if (date && price !== null && price > 0) {
      points.push({ date, price });
    }
  }
  return points;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const authErr = requireAuthHeader(req);
  if (authErr) return authErr;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  const body = (await req.json().catch(() => null)) as {
    market?: "TW" | "US";
    code?: string;
    exchange?: string;
    stockType?: string;
    fromDate?: string;
    toDate?: string;
    months?: string[];
    forceRefreshCurrentMonth?: boolean;
  } | null;

  const market = body?.market === "US" ? "US" : "TW";
  const code = body?.code?.trim().toUpperCase() ?? "";
  const fromDate = body?.fromDate?.trim() ?? "";
  const toDate = body?.toDate?.trim() ?? "";

  if (!code || !fromDate || !toDate) {
    return errorResponse(
      "Missing required parameters: code, fromDate, toDate",
      400,
      "INVALID_PARAMS",
    );
  }

  const serviceClient = createServiceRoleClient();
  const pointMap = new Map<string, number>();

  // 1. Read existing cache from stock_history_prices if Service Role is configured
  if (serviceClient) {
    const { data: cachedRows } = await serviceClient
      .from("stock_history_prices")
      .select("date, price")
      .eq("market", market)
      .eq("stock_code", code)
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true });

    if (Array.isArray(cachedRows)) {
      for (const row of cachedRows) {
        if (typeof row.date === "string" && Number.isFinite(row.price) && row.price > 0) {
          pointMap.set(row.date, row.price);
        }
      }
    }
  }

  const newlyFetched: StockHistoryPoint[] = [];
  let resolvedStockType: string | undefined;

  if (market === "TW") {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const targetMonths =
      Array.isArray(body?.months) && body.months.length > 0
        ? body.months.map((m) =>
            m.includes("-") ? m.slice(0, 7) : `${m.slice(0, 4)}-${m.slice(4, 6)}`,
          )
        : enumerateMonths(fromDate, toDate);

    const cachedMonths = new Set<string>();
    for (const d of pointMap.keys()) {
      cachedMonths.add(d.slice(0, 7));
    }

    const missingMonths = targetMonths.filter((m) => {
      if (body?.forceRefreshCurrentMonth && m === currentMonth) return true;
      return !cachedMonths.has(m);
    });

    for (let i = 0; i < missingMonths.length; i++) {
      if (i > 0) {
        await sleep(500);
      }
      const fetched = await fetchTwMonth(code, body?.exchange, missingMonths[i]);
      for (const p of fetched) {
        pointMap.set(p.date, p.price);
        newlyFetched.push(p);
      }
    }
  } else {
    const hasCachedRange = pointMap.size > 0 && !body?.forceRefreshCurrentMonth;
    if (!hasCachedRange) {
      const initialClass: "stocks" | "etf" =
        body?.stockType?.trim().toUpperCase() === "ETF" ? "etf" : "stocks";
      let fetched = await fetchNasdaqHistory(code, initialClass, fromDate, toDate);
      if (fetched.length === 0) {
        const altClass: "stocks" | "etf" =
          initialClass === "etf" ? "stocks" : "etf";
        const altFetched = await fetchNasdaqHistory(code, altClass, fromDate, toDate);
        if (altFetched.length > 0) {
          fetched = altFetched;
          resolvedStockType = altClass === "etf" ? "ETF" : "Stock";
        }
      }
      for (const p of fetched) {
        pointMap.set(p.date, p.price);
        newlyFetched.push(p);
      }
    }
  }

  // 2. Upsert newly fetched points into stock_history_prices via Service Role
  if (serviceClient && newlyFetched.length > 0) {
    const upsertRows = newlyFetched.map((p) => ({
      market,
      stock_code: code,
      date: p.date,
      price: p.price,
    }));
    await serviceClient
      .from("stock_history_prices")
      .upsert(upsertRows, { onConflict: "market,stock_code,date" });
  }

  const points: StockHistoryPoint[] = [...pointMap.entries()]
    .filter(([date]) => date >= fromDate && date <= toDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));

  return jsonResponse({
    market,
    code,
    points,
    ...(resolvedStockType ? { resolvedStockType } : {}),
    fromCache: newlyFetched.length === 0 && pointMap.size > 0,
  });
});
