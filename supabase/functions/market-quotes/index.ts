import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  errorResponse,
  handleCors,
  jsonResponse,
  requireAuthHeader,
} from "../_shared/cors.ts";
import {
  chunkArray,
  fetchTextWithRetry,
  parseFiniteNumber,
  safeJsonParse,
  stripHtmlTags,
} from "../_shared/http.ts";

interface MarketQuoteTarget {
  market: "TW" | "US";
  code: string;
  exchange?: string;
  stockType?: string;
}

interface RealtimeStockInfo {
  currentPrice: number;
  change: number;
  changePercent: number;
  lastUpdated: number;
  limitState: "LIMIT_UP" | "LIMIT_DOWN" | "NONE";
}

const TW_USER_AGENT = "Mozilla/5.0";
const NASDAQ_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nasdaq.com/",
  Origin: "https://www.nasdaq.com",
  "Sec-Fetch-Site": "same-site",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function firstPositiveOrderBookPrice(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  for (const part of raw.split("_")) {
    const val = parseFiniteNumber(part);
    if (val !== null && val > 0) return val;
  }
  return null;
}

function resolveTwLimitState(
  currentPrice: number,
  limitUp: number | null,
  limitDown: number | null,
): "LIMIT_UP" | "LIMIT_DOWN" | "NONE" {
  if (limitUp !== null && limitUp > 0 && Math.abs(currentPrice - limitUp) < 1e-6) {
    return "LIMIT_UP";
  }
  if (
    limitDown !== null &&
    limitDown > 0 &&
    Math.abs(currentPrice - limitDown) < 1e-6
  ) {
    return "LIMIT_DOWN";
  }
  return "NONE";
}

async function fetchTwseBatch(
  targets: MarketQuoteTarget[],
): Promise<{
  quotes: Record<string, RealtimeStockInfo>;
  certificateFailure: boolean;
}> {
  const quotes: Record<string, RealtimeStockInfo> = {};
  let certificateFailure = false;

  const batches = chunkArray(targets, 5);
  await Promise.all(
    batches.map(async (batch) => {
      const channels: string[] = [];
      for (const t of batch) {
        const code = t.code.trim().toUpperCase();
        if (t.exchange === "上市") {
          channels.push(`tse_${code}.tw`);
        } else if (t.exchange === "上櫃") {
          channels.push(`otc_${code}.tw`);
        } else {
          channels.push(`tse_${code}.tw`, `otc_${code}.tw`);
        }
      }
      if (channels.length === 0) return;

      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0`;
      const res = await fetchTextWithRetry(url, {
        headers: { "User-Agent": TW_USER_AGENT },
      });
      if (res.certificateFailure) certificateFailure = true;
      if (!res.ok) return;

      const payload = safeJsonParse<{
        msgArray?: Array<Record<string, unknown>>;
      }>(res.text);
      const rows = payload?.msgArray ?? [];
      const now = Date.now();

      for (const row of rows) {
        const code = typeof row.c === "string" ? row.c.trim().toUpperCase() : "";
        if (!code) continue;

        let currentPrice = parseFiniteNumber(row.z);
        if (currentPrice === null || currentPrice <= 0) {
          currentPrice =
            firstPositiveOrderBookPrice(row.a) ??
            firstPositiveOrderBookPrice(row.b);
        }
        if (currentPrice === null || currentPrice <= 0) continue;

        const yesterdayClose = parseFiniteNumber(row.y);
        const change =
          yesterdayClose !== null && yesterdayClose > 0
            ? currentPrice - yesterdayClose
            : 0;
        const changePercent =
          yesterdayClose !== null && yesterdayClose > 0
            ? (change / yesterdayClose) * 100
            : 0;

        const limitUp = parseFiniteNumber(row.u);
        const limitDown = parseFiniteNumber(row.w);

        quotes[`TW:${code}`] = {
          currentPrice,
          change,
          changePercent,
          lastUpdated: now,
          limitState: resolveTwLimitState(currentPrice, limitUp, limitDown),
        };
      }
    }),
  );

  return { quotes, certificateFailure };
}

function parseYahooTwHtml(html: string): RealtimeStockInfo | null {
  const sectionMatch = html.match(
    /<section[^>]*id=["']qsp-overview-realtime-info["'][^>]*>([\s\S]*?)<\/section>/i,
  );
  const scope = sectionMatch ? sectionMatch[1] : html;
  const kv = new Map<string, string>();
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liRegex.exec(scope)) !== null) {
    const spans = [...liMatch[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map(
      (m) => stripHtmlTags(m[1]),
    );
    if (spans.length >= 2) {
      kv.set(spans[0], spans[spans.length - 1]);
    }
  }

  const currentPrice =
    parseFiniteNumber(kv.get("成交")) ?? parseFiniteNumber(kv.get("收盤"));
  if (currentPrice === null || currentPrice <= 0) return null;

  const yesterdayClose =
    parseFiniteNumber(kv.get("昨收")) ?? parseFiniteNumber(kv.get("前收"));
  const change =
    yesterdayClose !== null && yesterdayClose > 0
      ? currentPrice - yesterdayClose
      : 0;
  const changePercent =
    yesterdayClose !== null && yesterdayClose > 0
      ? (change / yesterdayClose) * 100
      : 0;

  return {
    currentPrice,
    change,
    changePercent,
    lastUpdated: Date.now(),
    limitState: "NONE",
  };
}

async function fetchYahooTwSingle(
  code: string,
): Promise<{ info: RealtimeStockInfo | null; certificateFailure: boolean }> {
  const url = `https://tw.stock.yahoo.com/quote/${encodeURIComponent(code)}`;
  const res = await fetchTextWithRetry(url, {
    headers: { "User-Agent": TW_USER_AGENT },
  });
  if (!res.ok) {
    return { info: null, certificateFailure: res.certificateFailure };
  }
  return {
    info: parseYahooTwHtml(res.text),
    certificateFailure: res.certificateFailure,
  };
}

async function fetchNasdaqUsSingle(
  code: string,
  stockType?: string,
): Promise<{ info: RealtimeStockInfo | null; certificateFailure: boolean }> {
  const assetClass =
    stockType?.trim().toUpperCase() === "ETF" ? "etf" : "stocks";
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(code)}/info?assetclass=${assetClass}`;
  const res = await fetchTextWithRetry(url, { headers: NASDAQ_HEADERS });
  if (!res.ok) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const payload = safeJsonParse<{
    data?: {
      primaryData?: {
        lastSalePrice?: string;
        netChange?: string;
        percentageChange?: string;
      };
    };
  }>(res.text);
  const primary = payload?.data?.primaryData;
  if (!primary) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const currentPrice = parseFiniteNumber(primary.lastSalePrice);
  if (currentPrice === null || currentPrice <= 0) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const change = parseFiniteNumber(primary.netChange) ?? 0;
  const changePercent = parseFiniteNumber(primary.percentageChange) ?? 0;

  return {
    info: {
      currentPrice,
      change,
      changePercent,
      lastUpdated: Date.now(),
      limitState: "NONE",
    },
    certificateFailure: res.certificateFailure,
  };
}

async function fetchYahooUsSingle(
  code: string,
): Promise<{ info: RealtimeStockInfo | null; certificateFailure: boolean }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=1d&includePrePost=false&events=div%2Csplits`;
  const res = await fetchTextWithRetry(url, {
    headers: { "User-Agent": TW_USER_AGENT },
  });
  if (!res.ok) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const payload = safeJsonParse<{
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          chartPreviousClose?: number;
          previousClose?: number;
          regularMarketChange?: number;
          regularMarketChangePercent?: number;
        };
      }>;
    };
  }>(res.text);

  const meta = payload?.chart?.result?.[0]?.meta;
  if (!meta) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const currentPrice = parseFiniteNumber(meta.regularMarketPrice);
  if (currentPrice === null || currentPrice <= 0) {
    return { info: null, certificateFailure: res.certificateFailure };
  }

  const prevClose =
    parseFiniteNumber(meta.chartPreviousClose) ??
    parseFiniteNumber(meta.previousClose);
  const change =
    parseFiniteNumber(meta.regularMarketChange) ??
    (prevClose !== null && prevClose > 0 ? currentPrice - prevClose : 0);
  const changePercent =
    parseFiniteNumber(meta.regularMarketChangePercent) ??
    (prevClose !== null && prevClose > 0 ? (change / prevClose) * 100 : 0);

  return {
    info: {
      currentPrice,
      change,
      changePercent,
      lastUpdated: Date.now(),
      limitState: "NONE",
    },
    certificateFailure: res.certificateFailure,
  };
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const authErr = requireAuthHeader(req);
  if (authErr) return authErr;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  const body = await req.json().catch(() => null) as {
    stocks?: MarketQuoteTarget[];
    preferredTwSource?: "TWSE" | "Yahoo";
    preferredUsSource?: "Nasdaq" | "Yahoo";
  } | null;

  const targets = Array.isArray(body?.stocks) ? body.stocks : [];
  if (targets.length === 0) {
    return jsonResponse({
      quotes: {},
      fallbackUsed: false,
      certificateFailure: false,
    });
  }

  const preferredTw = body?.preferredTwSource === "Yahoo" ? "Yahoo" : "TWSE";
  const preferredUs = body?.preferredUsSource === "Yahoo" ? "Yahoo" : "Nasdaq";

  const quotes: Record<string, RealtimeStockInfo> = {};
  const errors: Record<string, string> = {};
  let fallbackUsed = false;
  let certificateFailure = false;

  const twTargets = targets
    .filter((t) => t.market === "TW" && t.code.trim().length > 0)
    .map((t) => ({ ...t, code: t.code.trim().toUpperCase() }));
  const usTargets = targets
    .filter((t) => t.market === "US" && t.code.trim().length > 0)
    .map((t) => ({ ...t, code: t.code.trim().toUpperCase() }));

  // TW Emerging goes directly to Yahoo TW
  const twEmerging = twTargets.filter((t) => t.exchange === "興櫃");
  const twRegular = twTargets.filter((t) => t.exchange !== "興櫃");

  await Promise.all(
    twEmerging.map(async (t) => {
      const key = `TW:${t.code}`;
      const res = await fetchYahooTwSingle(t.code);
      if (res.certificateFailure) certificateFailure = true;
      if (res.info) {
        quotes[key] = res.info;
      } else {
        errors[key] = "Failed to fetch TW emerging quote from Yahoo";
      }
    }),
  );

  // TW Regular: Primary + single fallback
  if (twRegular.length > 0) {
    if (preferredTw === "TWSE") {
      const primary = await fetchTwseBatch(twRegular);
      if (primary.certificateFailure) certificateFailure = true;
      Object.assign(quotes, primary.quotes);

      const missing = twRegular.filter((t) => !quotes[`TW:${t.code}`]);
      if (missing.length > 0) {
        await Promise.all(
          missing.map(async (t) => {
            const key = `TW:${t.code}`;
            const fb = await fetchYahooTwSingle(t.code);
            if (fb.certificateFailure) certificateFailure = true;
            if (fb.info) {
              quotes[key] = fb.info;
              fallbackUsed = true;
            } else {
              errors[key] = "Failed TWSE primary and Yahoo fallback";
            }
          }),
        );
      }
    } else {
      const missingForTwse: MarketQuoteTarget[] = [];
      await Promise.all(
        twRegular.map(async (t) => {
          const key = `TW:${t.code}`;
          const primary = await fetchYahooTwSingle(t.code);
          if (primary.certificateFailure) certificateFailure = true;
          if (primary.info) {
            quotes[key] = primary.info;
          } else {
            missingForTwse.push(t);
          }
        }),
      );
      if (missingForTwse.length > 0) {
        const fb = await fetchTwseBatch(missingForTwse);
        if (fb.certificateFailure) certificateFailure = true;
        for (const t of missingForTwse) {
          const key = `TW:${t.code}`;
          if (fb.quotes[key]) {
            quotes[key] = fb.quotes[key];
            fallbackUsed = true;
          } else {
            errors[key] = "Failed Yahoo primary and TWSE fallback";
          }
        }
      }
    }
  }

  // US: Primary + single fallback
  await Promise.all(
    usTargets.map(async (t) => {
      const key = `US:${t.code}`;
      if (preferredUs === "Nasdaq") {
        const primary = await fetchNasdaqUsSingle(t.code, t.stockType);
        if (primary.certificateFailure) certificateFailure = true;
        if (primary.info) {
          quotes[key] = primary.info;
          return;
        }
        const fb = await fetchYahooUsSingle(t.code);
        if (fb.certificateFailure) certificateFailure = true;
        if (fb.info) {
          quotes[key] = fb.info;
          fallbackUsed = true;
        } else {
          errors[key] = "Failed Nasdaq primary and Yahoo fallback";
        }
      } else {
        const primary = await fetchYahooUsSingle(t.code);
        if (primary.certificateFailure) certificateFailure = true;
        if (primary.info) {
          quotes[key] = primary.info;
          return;
        }
        const fb = await fetchNasdaqUsSingle(t.code, t.stockType);
        if (fb.certificateFailure) certificateFailure = true;
        if (fb.info) {
          quotes[key] = fb.info;
          fallbackUsed = true;
        } else {
          errors[key] = "Failed Yahoo primary and Nasdaq fallback";
        }
      }
    }),
  );

  return jsonResponse({
    quotes,
    fallbackUsed,
    certificateFailure,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
});
