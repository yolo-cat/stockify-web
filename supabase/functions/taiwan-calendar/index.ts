import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  errorResponse,
  handleCors,
  jsonResponse,
  requireAuthHeader,
} from "../_shared/cors.ts";
import { fetchTextWithRetry, safeJsonParse } from "../_shared/http.ts";

interface TaiwanHolidayItem {
  date: string;
  week: string;
  isHoliday: boolean;
  description: string;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const authErr = requireAuthHeader(req);
  if (authErr) return authErr;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405, "METHOD_NOT_ALLOWED");
  }

  const body = (await req.json().catch(() => null)) as { year?: number } | null;
  const year = Number(body?.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return errorResponse("Invalid year parameter", 400, "INVALID_YEAR");
  }

  const url = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
  const res = await fetchTextWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    return errorResponse(
      `Failed to fetch Taiwan calendar for ${year}`,
      502,
      "CALENDAR_FETCH_FAILED",
      res.error,
    );
  }

  const rawItems = safeJsonParse<unknown[]>(res.text);
  if (!Array.isArray(rawItems) || rawItems.length < 360) {
    return errorResponse(
      `Incomplete Taiwan calendar payload for ${year}`,
      502,
      "CALENDAR_INVALID",
    );
  }

  const yearPrefix = String(year);
  const items: TaiwanHolidayItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const date = typeof obj.date === "string" ? obj.date.trim() : "";
    if (!date.startsWith(yearPrefix) || date.length !== 8) continue;
    items.push({
      date,
      week: typeof obj.week === "string" ? obj.week : "",
      isHoliday: Boolean(obj.isHoliday),
      description: typeof obj.description === "string" ? obj.description : "",
    });
  }

  if (items.length < 360) {
    return errorResponse(
      `Validated Taiwan calendar for ${year} is incomplete (${items.length} days)`,
      502,
      "CALENDAR_INCOMPLETE",
    );
  }

  return jsonResponse({
    year,
    calendar: {
      calendarVersion: 1,
      source: "cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar",
      items,
    },
  });
});
