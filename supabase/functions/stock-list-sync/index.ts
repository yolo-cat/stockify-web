import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createServiceRoleClient,
  errorResponse,
  handleCors,
  jsonResponse,
  requireAuthHeader,
} from "../_shared/cors.ts";
import { chunkArray, fetchTextWithRetry, stripHtmlTags } from "../_shared/http.ts";

interface StockRecord {
  market: "TW" | "US";
  code: string;
  name: string;
  exchange: string;
  industry: string;
  stockType: string;
}

const TW_MODES: Array<{ mode: number; defaultExchange: string }> = [
  { mode: 2, defaultExchange: "上市" },
  { mode: 4, defaultExchange: "上櫃" },
  { mode: 5, defaultExchange: "興櫃" },
];

const US_MOBILE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/plain, */*;q=0.8",
};

function stripTags(html: string): string {
  return stripHtmlTags(html)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function parseTwIsinHtml(html: string, defaultExchange: string): StockRecord[] {
  const tableMatch = html.match(/<table[^>]*class=["'][^"']*h4[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
  const scope = tableMatch ? tableMatch[1] : html;

  const stocks: StockRecord[] = [];
  let currentStockType = "";
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;

  while ((trMatch = trRegex.exec(scope)) !== null) {
    const tds = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1]),
    );
    if (tds.length === 1 && tds[0]) {
      currentStockType = tds[0];
      continue;
    }
    if (tds.length >= 7) {
      const codeAndName = tds[0];
      if (!codeAndName || codeAndName.includes("有價證券代號")) continue;
      const parts = codeAndName.split(/\u3000+/);
      const code = (parts[0] ?? "").trim().toUpperCase();
      const name = parts.slice(1).join(" ").trim();
      if (!code || !name) continue;

      const rawExchange = tds[3]?.trim() ?? "";
      const exchange =
        rawExchange === "上市" || rawExchange === "上櫃" || rawExchange === "興櫃"
          ? rawExchange
          : defaultExchange;
      const industry = tds[4]?.trim() ?? "";

      stocks.push({
        market: "TW",
        code,
        name,
        exchange,
        industry,
        stockType: currentStockType,
      });
    }
  }

  return stocks;
}

function parseNasdaqTraderTxt(text: string, isOtherListed: boolean): StockRecord[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split("|").map((h) => h.trim());
  const symbolCol = isOtherListed
    ? header.indexOf("ACT Symbol")
    : header.indexOf("Symbol");
  const nameCol = header.indexOf("Security Name");
  const testCol = header.indexOf("Test Issue");
  const etfCol = header.indexOf("ETF");

  if (symbolCol < 0 || nameCol < 0) return [];

  const stocks: StockRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("File Creation Time:")) continue;
    const cols = line.split("|");
    const code = (cols[symbolCol] ?? "").trim().toUpperCase();
    const name = (cols[nameCol] ?? "").trim();
    const isTest = testCol >= 0 && (cols[testCol] ?? "").trim().toUpperCase() === "Y";
    const isEtf = etfCol >= 0 && (cols[etfCol] ?? "").trim().toUpperCase() === "Y";

    if (!code || !name || isTest) continue;

    stocks.push({
      market: "US",
      code,
      name,
      exchange: "",
      industry: "",
      stockType: isEtf ? "ETF" : "",
    });
  }
  return stocks;
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
  } | null;
  const market = body?.market === "US" ? "US" : "TW";

  const syncedMap = new Map<string, StockRecord>();

  if (market === "TW") {
    const results = await Promise.all(
      TW_MODES.map(async ({ mode, defaultExchange }) => {
        const url = `https://isin.twse.com.tw/isin/C_public.jsp?strMode=${mode}`;
        const res = await fetchTextWithRetry(
          url,
          { headers: { "User-Agent": "Mozilla/5.0" } },
          { timeoutMs: 30_000, decodeBig5: true },
        );
        if (!res.ok) {
          return { ok: false as const, mode, stocks: [] as StockRecord[] };
        }
        const parsed = parseTwIsinHtml(res.text, defaultExchange);
        return {
          ok: parsed.length > 0,
          mode,
          stocks: parsed,
        };
      }),
    );

    const failed = results.find((r) => !r.ok);
    if (failed) {
      return errorResponse(
        `TW stock list sync aborted: board strMode=${failed.mode} failed or returned empty`,
        502,
        "TW_LIST_SYNC_ABORTED",
      );
    }

    for (const r of results) {
      for (const stock of r.stocks) {
        syncedMap.set(stock.code, stock);
      }
    }
  } else {
    const [nasdaqRes, otherRes] = await Promise.all([
      fetchTextWithRetry(
        "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
        { headers: US_MOBILE_HEADERS },
        { timeoutMs: 30_000 },
      ),
      fetchTextWithRetry(
        "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
        { headers: US_MOBILE_HEADERS },
        { timeoutMs: 30_000 },
      ),
    ]);

    const nasdaqStocks = nasdaqRes.ok
      ? parseNasdaqTraderTxt(nasdaqRes.text, false)
      : [];
    const otherStocks = otherRes.ok
      ? parseNasdaqTraderTxt(otherRes.text, true)
      : [];

    if (nasdaqStocks.length === 0 || otherStocks.length === 0) {
      return errorResponse(
        "US stock list sync aborted: nasdaqlisted or otherlisted failed or returned empty",
        502,
        "US_LIST_SYNC_ABORTED",
      );
    }

    for (const stock of [...nasdaqStocks, ...otherStocks]) {
      syncedMap.set(stock.code, stock);
    }
  }

  const stocks = [...syncedMap.values()];
  const serviceClient = createServiceRoleClient();
  if (serviceClient && stocks.length > 0) {
    const rows = stocks.map((s) => ({
      market: s.market,
      code: s.code,
      name: s.name,
      exchange: s.exchange,
      industry: s.industry,
      stock_type: s.stockType,
    }));
    for (const chunk of chunkArray(rows, 500)) {
      const { error } = await serviceClient
        .from("stocks")
        .upsert(chunk, { onConflict: "market,code" });
      if (error) {
        return errorResponse(
          `Failed to upsert stocks: ${error.message}`,
          500,
          "DB_UPSERT_FAILED",
        );
      }
    }
  }

  return jsonResponse({
    market,
    syncedCount: stocks.length,
    updatedAtMillis: Date.now(),
    stocks,
  });
});
