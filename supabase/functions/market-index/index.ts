import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  errorResponse,
  handleCors,
  jsonResponse,
  requireAuthHeader,
} from "../_shared/cors.ts";
import {
  fetchTextWithRetry,
  parseFiniteNumber,
  safeJsonParse,
} from "../_shared/http.ts";

interface TaiwanWeightedIndexInfo {
  name: string;
  current: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  updatedAtMillis: number;
  change: number;
  changePercent: number;
}

async function fetchTwseIndex(): Promise<TaiwanWeightedIndexInfo | null> {
  const url =
    "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0";
  const res = await fetchTextWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return null;

  const payload = safeJsonParse<{
    msgArray?: Array<Record<string, unknown>>;
  }>(res.text);
  const row = payload?.msgArray?.[0];
  if (!row) return null;

  const current = parseFiniteNumber(row.z);
  if (current === null || current <= 0) return null;

  const previousClose = parseFiniteNumber(row.y) ?? current;
  const open = parseFiniteNumber(row.o) ?? current;
  const high = parseFiniteNumber(row.h) ?? current;
  const low = parseFiniteNumber(row.l) ?? current;
  const tlong = parseFiniteNumber(row.tlong);
  const updatedAtMillis = tlong && tlong > 0 ? tlong : Date.now();
  const change = previousClose > 0 ? current - previousClose : 0;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    name: typeof row.n === "string" && row.n.trim() ? row.n.trim() : "發行量加權股價指數",
    current,
    previousClose,
    open,
    high,
    low,
    updatedAtMillis,
    change,
    changePercent,
  };
}

async function fetchYahooIndex(): Promise<TaiwanWeightedIndexInfo | null> {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1d&includePrePost=false&events=div%2Csplits";
  const res = await fetchTextWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return null;

  const payload = safeJsonParse<{
    chart?: {
      result?: Array<{
        meta?: {
          shortName?: string;
          regularMarketPrice?: number;
          chartPreviousClose?: number;
          previousClose?: number;
          regularMarketOpen?: number;
          regularMarketDayHigh?: number;
          regularMarketDayLow?: number;
          regularMarketTime?: number;
        };
      }>;
    };
  }>(res.text);

  const meta = payload?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const current = parseFiniteNumber(meta.regularMarketPrice);
  if (current === null || current <= 0) return null;

  const previousClose =
    parseFiniteNumber(meta.chartPreviousClose) ??
    parseFiniteNumber(meta.previousClose) ??
    current;
  const open = parseFiniteNumber(meta.regularMarketOpen) ?? current;
  const high = parseFiniteNumber(meta.regularMarketDayHigh) ?? current;
  const low = parseFiniteNumber(meta.regularMarketDayLow) ?? current;
  const marketTime = parseFiniteNumber(meta.regularMarketTime);
  const updatedAtMillis =
    marketTime && marketTime > 0 ? marketTime * 1000 : Date.now();
  const change = previousClose > 0 ? current - previousClose : 0;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    name: meta.shortName?.trim() || "台灣加權指數",
    current,
    previousClose,
    open,
    high,
    low,
    updatedAtMillis,
    change,
    changePercent,
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

  const body = (await req.json().catch(() => ({}))) as {
    preferredSource?: "TWSE" | "Yahoo";
  };

  const preferred = body?.preferredSource === "Yahoo" ? "Yahoo" : "TWSE";
  const primaryFn = preferred === "TWSE" ? fetchTwseIndex : fetchYahooIndex;
  const fallbackFn = preferred === "TWSE" ? fetchYahooIndex : fetchTwseIndex;

  const primary = await primaryFn();
  if (primary) {
    return jsonResponse({ index: primary, fallbackUsed: false });
  }

  const fallback = await fallbackFn();
  if (fallback) {
    return jsonResponse({ index: fallback, fallbackUsed: true });
  }

  return errorResponse("Unable to fetch Taiwan Weighted Index", 502, "INDEX_FETCH_FAILED");
});
