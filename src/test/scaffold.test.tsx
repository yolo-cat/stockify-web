import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "@/App";
import {
  isSupabaseConfigured,
  SUPABASE_CONFIG_WARNING,
} from "@/integrations/supabase/client";
import {
  createAddTransactionRoute,
  createStockDetailRoute,
  createTransactionDetailRoute,
} from "@/lib/routes";
import {
  CalculationRoundingMode,
  DEFAULT_USER_SETTINGS,
  EDGE_FUNCTIONS,
  HomeDisplayMode,
  ReturnRateMode,
  StockExchange,
  StockMarket,
  TransactionType,
} from "@/types";

describe("Phase 2 Step 0 scaffold & frozen contracts", () => {
  it("exports frozen domain enums and Android default settings", () => {
    expect(StockMarket.TW).toBe("TW");
    expect(StockMarket.US).toBe("US");
    expect(StockExchange.LISTED).toBe("上市");
    expect(StockExchange.OTC).toBe("上櫃");
    expect(StockExchange.EMERGING).toBe("興櫃");
    expect(TransactionType.BUY).toBe("買進");
    expect(TransactionType.MARGIN_BUY).toBe("融資買進");
    expect(TransactionType.SHORT_COVER).toBe("買券還券");
    expect(HomeDisplayMode.COMBINED).toBe("COMBINED");
    expect(ReturnRateMode.REMAINING_POSITION).toBe("REMAINING_POSITION");
    expect(CalculationRoundingMode.ROUND).toBe("ROUND");
    expect(DEFAULT_USER_SETTINGS.usdToTwdRate).toBe(32.0);
    expect(DEFAULT_USER_SETTINGS.marginDayCount).toBe(365);
    expect(DEFAULT_USER_SETTINGS.feeDiscount).toBe(0.28);
    expect(EDGE_FUNCTIONS.MARKET_QUOTES).toBe("market-quotes");
  });

  it("encodes route parameters safely for US dotted tickers and TW codes", () => {
    expect(createStockDetailRoute("US", "BRK.B")).toBe("/stocks/US/BRK.B");
    expect(createStockDetailRoute("tw", " 00981a ")).toBe("/stocks/TW/00981A");
    expect(createTransactionDetailRoute(42)).toBe("/transactions/42");
    expect(
      createAddTransactionRoute({
        market: "US",
        stockCode: "AAPL",
        date: 1700000000000,
      }),
    ).toBe("/transactions/new?stockCode=AAPL&market=US&date=1700000000000");
  });

  it("initializes Supabase client safely when env vars are unconfigured", () => {
    expect(isSupabaseConfigured).toBe(false);
    expect(SUPABASE_CONFIG_WARNING).toBeTruthy();
  });

  it("renders Google OAuth login gate when unauthenticated", async () => {
    window.history.pushState({}, "", "/holdings");
    render(<App />);
    expect(await screen.findByText("韭菜記帳本")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /使用 Google 帳號登入/i }),
    ).toBeInTheDocument();
  });

  it("includes valid bundled stock and Taiwan holiday assets under public/data", () => {
    const publicDataDir = path.resolve(process.cwd(), "public/data");
    const twStocks = JSON.parse(
      fs.readFileSync(path.join(publicDataDir, "stocks.json"), "utf8"),
    ) as unknown[];
    const usStocks = JSON.parse(
      fs.readFileSync(path.join(publicDataDir, "us_stocks.json"), "utf8"),
    ) as unknown[];
    const cal2026 = JSON.parse(
      fs.readFileSync(
        path.join(publicDataDir, "taiwan_calendar/2026.json"),
        "utf8",
      ),
    ) as { calendarVersion: number; items: unknown[] };

    expect(twStocks.length).toBeGreaterThan(100);
    expect(usStocks.length).toBeGreaterThan(100);
    expect(cal2026.calendarVersion).toBe(1);
    expect(cal2026.items.length).toBe(365);
  });
});
