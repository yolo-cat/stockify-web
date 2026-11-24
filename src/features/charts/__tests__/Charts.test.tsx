import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryChartSection } from "@/features/charts/HistoryChartSection";
import { PerformanceCalendarSection } from "@/features/charts/PerformanceCalendarSection";
import {
  DEFAULT_USER_SETTINGS,
  HomeDisplayMode,
  type PersonalHistoryPoint,
  StockMarket,
} from "@/types";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const SAMPLE_POINTS: PersonalHistoryPoint[] = [
  {
    date: "2026-10-30",
    price: 1000,
    shares: 1000,
    marketValue: 1_000_000,
    totalPL: 50_000,
    totalPLPercentage: 5.26,
  },
  {
    date: "2026-11-02",
    price: 1020,
    shares: 1000,
    marketValue: 1_020_000,
    totalPL: 70_000,
    totalPLPercentage: 7.37,
  },
  {
    date: "2026-11-03",
    price: 1010,
    shares: 1000,
    marketValue: 1_010_000,
    totalPL: 60_000,
    totalPLPercentage: 6.32,
  },
];

describe("PerformanceCalendarSection & HistoryChartSection", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders PerformanceCalendarSection derived from PersonalHistoryPoint[]", () => {
    render(
      <PerformanceCalendarSection
        points={SAMPLE_POINTS}
        displayMode={HomeDisplayMode.TW}
      />,
    );

    expect(screen.getByText("2026/11")).toBeInTheDocument();
    expect(screen.getByText("2026/11 報酬")).toBeInTheDocument();
    for (const day of ["日", "一", "二", "三", "四", "五", "六"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
    expect(screen.getByText("+20.0K")).toBeInTheDocument();
    expect(screen.getByText("-10.0K")).toBeInTheDocument();
  });

  it("renders HistoryChartSection controls and toggles between curve and calendar", async () => {
    const updateSettings = vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS);

    render(
      <HistoryChartSection
        mode="portfolio"
        stocks={[
          {
            code: "2330",
            name: "台積電",
            market: StockMarket.TW,
            exchange: "上市",
            industry: "半導體業",
            stockType: "股票",
          },
        ]}
        transactions={[]}
        displayMode={HomeDisplayMode.COMBINED}
        usdToTwdRate={32}
        settings={DEFAULT_USER_SETTINGS}
        feeSettingsByAccount={{}}
        sharedFeeSettings={{
          feeDiscount: 0.28,
          minFeeRegular: 1,
          minFeeOddLot: 1,
        }}
        updateSettings={updateSettings}
      />,
    );

    expect(screen.getByText("歷史走勢與報酬")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "報酬曲線" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "報酬日曆" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1Y" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "報酬日曆" }));
    expect(
      await screen.findByText("目前模式尚無持股交易紀錄"),
    ).toBeInTheDocument();
  });
});
