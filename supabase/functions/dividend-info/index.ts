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
  stripHtmlTags,
} from "../_shared/http.ts";

interface DividendResult {
  amount: number;
  date: string;
}

interface YahooDividendSummary {
  cashDividend: DividendResult | null;
  stockDividend: DividendResult | null;
}

function normalizeDate(raw: string): string | null {
  const cleaned = raw.trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  return cleaned;
}

function parseYahooDividendHtml(html: string): YahooDividendSummary {
  const tableBodyMatch = html.match(
    /<div[^>]*class=["'][^"']*table-body[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  );
  const scope = tableBodyMatch ? tableBodyMatch[1] : html;

  let cashDividend: DividendResult | null = null;
  let stockDividend: DividendResult | null = null;

  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liRegex.exec(scope)) !== null) {
    const divs = [...liMatch[1].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)].map(
      (m) => stripHtmlTags(m[1]),
    );
    if (divs.length < 9) continue;
    const period = divs[3];
    if (!period) continue;

    const cash = parseFiniteNumber(divs[4]);
    const stock = parseFiniteNumber(divs[5]);
    const date = normalizeDate(divs[8]);
    if (!date) continue;

    if (!cashDividend && cash !== null && cash > 0) {
      cashDividend = { amount: cash, date };
    }
    if (!stockDividend && stock !== null && stock > 0) {
      stockDividend = { amount: stock, date };
    }
    if (cashDividend && stockDividend) break;
  }

  return { cashDividend, stockDividend };
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
    stockCodes?: string[];
  } | null;
  const stockCodes = Array.isArray(body?.stockCodes)
    ? [...new Set(body.stockCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
    : [];

  const results: Record<string, YahooDividendSummary | null> = {};
  const errors: Record<string, string> = {};

  await Promise.all(
    stockCodes.map(async (code) => {
      const url = `https://tw.stock.yahoo.com/quote/${encodeURIComponent(code)}/dividend`;
      const res = await fetchTextWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) {
        results[code] = null;
        errors[code] = res.error ?? "Failed to fetch Yahoo dividend page";
        return;
      }
      results[code] = parseYahooDividendHtml(res.text);
    }),
  );

  return jsonResponse({
    results,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
});
