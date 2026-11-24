import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextAlignedDelayMs,
  consumeCertificateToastMessage,
  consumeFallbackToastMessage,
  isNewYorkMarketOpen,
  isTaipeiMarketOpen,
  RealtimePollingController,
  resetSessionToastFlags,
  shouldSyncStockList,
} from "@/services";
import { StockMarket } from "@/types";

describe("edgeMarketService & realtimePollingService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSessionToastFlags();
  });

  it("emits fallback and certificate toast messages at most once unless repeated enabled", () => {
    expect(consumeFallbackToastMessage(false, false)).toBeNull();
    expect(consumeFallbackToastMessage(true, false)).toBeTruthy();
    expect(consumeFallbackToastMessage(true, false)).toBeNull();
    expect(consumeFallbackToastMessage(true, true)).toBeTruthy();

    expect(consumeCertificateToastMessage(false)).toBeNull();
    expect(consumeCertificateToastMessage(true)).toBe("抓取報價憑證失效");
    expect(consumeCertificateToastMessage(true)).toBeNull();
  });

  it("enforces 7-day stock list sync guard", () => {
    expect(shouldSyncStockList(StockMarket.TW)).toBe(true);
    window.localStorage.setItem(
      `stockify_stock_list_sync_v1_${StockMarket.TW}`,
      String(Date.now()),
    );
    expect(shouldSyncStockList(StockMarket.TW)).toBe(false);
  });

  it("evaluates Taipei and New York market hours accurately", () => {
    // 2025-05-05 10:00:00+08:00 (Monday morning in Taipei) -> 02:00 UTC
    const taipeiOpen = new Date("2025-05-05T02:00:00.000Z");
    expect(isTaipeiMarketOpen(taipeiOpen)).toBe(true);
    expect(
      isTaipeiMarketOpen(taipeiOpen, {
        year: 2025,
        calendarVersion: 1,
        updatedAtEpochMillis: Date.now(),
        holidays: { "2025-05-05": true },
        source: "test",
      }),
    ).toBe(false);

    // 2025-05-05 10:00:00-04:00 (Monday morning EDT in New York) -> 14:00 UTC
    const nyOpen = new Date("2025-05-05T14:00:00.000Z");
    expect(isNewYorkMarketOpen(nyOpen)).toBe(true);

    // Saturday
    const weekend = new Date("2025-05-03T14:00:00.000Z");
    expect(isTaipeiMarketOpen(weekend)).toBe(false);
    expect(isNewYorkMarketOpen(weekend)).toBe(false);
  });

  it("computes aligned polling delay and runs startup + manual polls", async () => {
    expect(computeNextAlignedDelayMs(10, 10_000)).toBe(10_000);
    expect(computeNextAlignedDelayMs(10, 13_000)).toBe(7_000);

    const reasons: string[] = [];
    const controller = new RealtimePollingController({
      getIntervalSeconds: () => 10,
      onPoll: ({ reason }) => {
        reasons.push(reason);
      },
    });

    controller.start();
    await vi.waitFor(() => expect(reasons).toContain("startup"));
    await controller.triggerManualRefresh();
    expect(reasons).toEqual(["startup", "manual"]);
    controller.stop();
  });
});
