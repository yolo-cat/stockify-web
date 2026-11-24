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

const FALLBACK_USD_TWD_RATE = 32.0;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const authErr = requireAuthHeader(req);
  if (authErr) return authErr;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  const res = await fetchTextWithRetry("https://open.er-api.com/v6/latest/USD", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (res.ok) {
    const payload = safeJsonParse<{
      result?: string;
      rates?: Record<string, unknown>;
    }>(res.text);
    const rate =
      payload?.result === "success"
        ? parseFiniteNumber(payload.rates?.TWD)
        : null;

    if (rate !== null && rate > 0) {
      return jsonResponse({
        exchangeRate: {
          rate,
          updatedAtMillis: Date.now(),
          source: "open.er-api.com",
        },
      });
    }
  }

  return jsonResponse({
    exchangeRate: {
      rate: FALLBACK_USD_TWD_RATE,
      updatedAtMillis: Date.now(),
      source: "fallback",
    },
  });
});
