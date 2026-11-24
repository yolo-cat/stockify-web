import { describe, expect, it } from "vitest";
import {
  buildPortfolioHistorySeries,
  buildStockHistorySeries,
  calculateDailyPerformance,
  calculateMonthlyPerformance,
  compoundReturns,
  hasHistoryCoverage,
  HistoricalLongPositionTimeline,
  HistoricalTransactionCashFlowTimeline,
  priceAtOrBefore,
  resolveHistoryCutoffDate,
  targetHistoryMonths,
  valuationDateEndMillis,
  zoneIdForHomeXirr,
} from "@/domain";
import {
  HomeDisplayMode,
  ReturnRateMode,
  StockMarket,
  TransactionType,
  type PersonalHistoryPoint,
  type Stock,
  type StockTransaction,
} from "@/types";

const TW_2330: Stock = {
  name: "台積電",
  code: "2330",
  market: StockMarket.TW,
  exchange: "上市",
  industry: "半導體",
  stockType: "股票",
};

function makeTx(overrides: Partial<StockTransaction>): StockTransaction {
  return {
    id: 1,
    stockCode: "2330",
    market: StockMarket.TW,
    accountId: 1,
    date: 0,
    recordTime: 0,
    type: TransactionType.BUY,
    buyPrice: 0,
    buyShares: 0,
    sellPrice: 0,
    sellShares: 0,
    fee: 0,
    tax: 0,
    income: 0,
    expense: 0,
    cashDividend: 0,
    exDividendShares: 0,
    dividendIncome: 0,
    supplementaryHealthInsurancePremium: 0,
    stockDividend: 0,
    dividendShares: 0,
    exRightsShares: 0,
    note: "",
    capitalReductionRatio: 0,
    sharesBeforeReduction: 0,
    sharesAfterReduction: 0,
    cashReturned: 0,
    stockSplitRatio: 0,
    sharesBeforeSplit: 0,
    sharesAfterSplit: 0,
    marginPrincipal: 0,
    marginAnnualRate: 0,
    marginLotId: "",
    marginRepaymentLotId: "",
    marginRepayment: 0,
    marginSelfFunded: 0,
    marginSelfFundedOverridden: false,
    marginActualInterest: 0,
    shortBorrowPrincipal: 0,
    shortBorrowAnnualRate: 0,
    shortLotId: "",
    shortCoverLotId: "",
    shortCoverShares: 0,
    shortCompensationLotId: "",
    shortCompensation: 0,
    ...overrides,
  };
}

describe("History chart & performance calendar golden vectors", () => {
  it("historical_cashflow_incremental_prefix_01, date_mapper_02, dividend_toggle_03", () => {
    const txs = [
      makeTx({ id: 1, date: 0, recordTime: 0, type: TransactionType.BUY, expense: 10000 }),
      makeTx({ id: 2, date: 172800000, recordTime: 172800000, type: TransactionType.CASH_DIVIDEND, dividendIncome: 180 }),
      makeTx({ id: 3, date: 345600000, recordTime: 345600000, type: TransactionType.SELL, income: 11000 }),
    ];
    const timeline = new HistoricalTransactionCashFlowTimeline(txs);
    expect(timeline.cashFlowsAt(86400000)).toEqual([{ dateMillis: 0, amount: -10000 }]);
    expect(timeline.cashFlowsAt(345600000)).toEqual([
      { dateMillis: 0, amount: -10000 },
      { dateMillis: 172800000, amount: 180 },
      { dateMillis: 345600000, amount: 11000 },
    ]);

    const mapped = new HistoricalTransactionCashFlowTimeline(
      [makeTx({ date: 1000, recordTime: 1000, type: TransactionType.BUY, expense: 100 })],
      1.0,
      (d) => d + 5000
    );
    expect(mapped.cashFlowsAt(1000)).toEqual([{ dateMillis: 6000, amount: -100 }]);

    const legacyDiv = makeTx({
      date: 2000,
      recordTime: 2000,
      type: TransactionType.CASH_DIVIDEND,
      dividendIncome: 0,
      income: 250,
    });
    expect(
      new HistoricalTransactionCashFlowTimeline([legacyDiv], 1.0, (d) => d, false, true).cashFlowsAt(2000)
    ).toEqual([{ dateMillis: 2000, amount: 250 }]);
    expect(
      new HistoricalTransactionCashFlowTimeline([legacyDiv], 1.0, (d) => d, false, false).cashFlowsAt(2000)
    ).toEqual([]);
  });

  it("historical_long_position_company_actions_04 & account_isolation_05", () => {
    const txs = [
      makeTx({ id: 4, date: 4000, recordTime: 1, type: TransactionType.SELL, sellPrice: 15, sellShares: 4, income: 59 }),
      makeTx({ id: 1, date: 1000, recordTime: 1, type: TransactionType.BUY, buyShares: 10, expense: 100 }),
      makeTx({ id: 3, date: 3000, recordTime: 1, type: TransactionType.STOCK_SPLIT, stockSplitRatio: 2, sharesBeforeSplit: 10, sharesAfterSplit: 20 }),
      makeTx({ id: 5, date: 5000, recordTime: 1, type: TransactionType.CAPITAL_REDUCTION, capitalReductionRatio: 10, sharesBeforeReduction: 16, sharesAfterReduction: 14.4, cashReturned: 12 }),
      makeTx({ id: 2, date: 2000, recordTime: 1, type: TransactionType.CASH_DIVIDEND, dividendIncome: 5 }),
    ];
    const timeline = new HistoricalLongPositionTimeline(txs);
    expect(timeline.advanceTo(500).shares).toBe(0);
    expect(timeline.advanceTo(1000).shares).toBe(10);
    expect(timeline.advanceTo(2000).totalDividendIncome).toBe(5);
    const at3000 = timeline.advanceTo(3000);
    expect(at3000.shares).toBe(20);
    expect(at3000.buySharesTotal).toBe(20);
    const at4000 = timeline.advanceTo(4000);
    expect(at4000.shares).toBe(16);
    expect(at4000.sellSharesTotal).toBe(4);
    expect(at4000.sellAmountBeforeFee).toBe(60);
    const at5000 = timeline.advanceTo(5000);
    expect(at5000.shares).toBeCloseTo(14.4, 6);
    expect(at5000.totalSellIncome).toBe(71);
    expect(at5000.totalSellNetIncome).toBe(59);

    const isolated = new HistoricalLongPositionTimeline([
      makeTx({ id: 1, accountId: 1, date: 1000, recordTime: 1, type: TransactionType.BUY, buyShares: 10, expense: 100 }),
      makeTx({ id: 2, accountId: 2, date: 1000, recordTime: 2, type: TransactionType.BUY, buyShares: 10, expense: 100 }),
      makeTx({ id: 3, accountId: 1, date: 2000, recordTime: 1, type: TransactionType.STOCK_SPLIT, stockSplitRatio: 2, sharesBeforeSplit: 10, sharesAfterSplit: 20 }),
      makeTx({ id: 4, accountId: 1, date: 3000, recordTime: 1, type: TransactionType.CAPITAL_REDUCTION, capitalReductionRatio: 10, sharesBeforeReduction: 20, sharesAfterReduction: 18, cashReturned: 10 }),
    ]);
    expect(isolated.advanceTo(1000).shares).toBe(20);
    expect(isolated.advanceTo(2000).shares).toBe(30);
    const at3000Iso = isolated.advanceTo(3000);
    expect(at3000Iso.shares).toBe(28);
    expect(at3000Iso.totalSellIncome).toBe(10);
  });

  it("history_chart_zones_and_close_millis_06, coverage_and_price_lookup_07, and cutoff dates", () => {
    expect(zoneIdForHomeXirr(HomeDisplayMode.TW)).toBe("Asia/Taipei");
    expect(zoneIdForHomeXirr(HomeDisplayMode.US)).toBe("America/New_York");
    expect(zoneIdForHomeXirr(HomeDisplayMode.COMBINED)).toBe("UTC");

    expect(new Date(valuationDateEndMillis("2026-07-01", StockMarket.TW)!).toISOString()).toBe(
      "2026-07-01T05:30:00.000Z"
    );
    expect(new Date(valuationDateEndMillis("2026-07-01", StockMarket.US)!).toISOString()).toBe(
      "2026-07-01T20:00:00.000Z"
    );
    expect(valuationDateEndMillis("2026-02-30", StockMarket.TW)).toBeNull();

    expect(
      resolveHistoryCutoffDate(new Date("2026-08-23T02:00:00Z").getTime(), StockMarket.TW)
    ).toBe("2026-08-21");
    expect(
      resolveHistoryCutoffDate(new Date("2026-08-24T02:00:00Z").getTime(), StockMarket.TW)
    ).toBe("2026-08-21");
    expect(
      resolveHistoryCutoffDate(new Date("2026-08-24T06:00:00Z").getTime(), StockMarket.TW)
    ).toBe("2026-08-24");

    expect(targetHistoryMonths(1, "2026-08")).toEqual(["202607", "202608"]);
    expect(targetHistoryMonths(1, "2026-09")).toEqual(["202608", "202609"]);

    const covPts = [
      { date: "2026-07-01", price: 100 },
      { date: "2026-08-01", price: 110 },
    ];
    expect(hasHistoryCoverage(covPts, 1)).toBe(true);
    expect(hasHistoryCoverage(covPts, 6)).toBe(false);

    expect(priceAtOrBefore([{ date: "2026-07-20", price: 120 }], "2026-07-19")).toBeNull();
    expect(priceAtOrBefore([{ date: "2026-07-20", price: 120 }], "2026-07-20")).toBe(120);
  });

  it("buildStockHistorySeries & buildPortfolioHistorySeries replay chronologically without back-propagating splits", () => {
    const txs = [
      makeTx({
        id: 1,
        date: Date.UTC(2026, 6, 1),
        recordTime: 1,
        type: TransactionType.BUY,
        buyPrice: 100,
        buyShares: 10,
        expense: 1000,
      }),
      makeTx({
        id: 2,
        date: Date.UTC(2026, 6, 3),
        recordTime: 1,
        type: TransactionType.STOCK_SPLIT,
        stockSplitRatio: 2,
        sharesBeforeSplit: 10,
        sharesAfterSplit: 20,
      }),
    ];
    const history = [
      { date: "2026-07-01", price: 100 },
      { date: "2026-07-02", price: 110 },
      { date: "2026-07-03", price: 55 },
    ];
    const series = buildStockHistorySeries({
      stock: TW_2330,
      transactions: txs,
      historyPoints: history,
      returnRateMode: ReturnRateMode.REMAINING_POSITION,
      preDeductSellFees: false,
      feeSettingsByAccount: {},
      sharedFeeSettings: { feeDiscount: 0.28, minFeeRegular: 1, minFeeOddLot: 1 },
      marginDayCount: 365,
    });
    expect(series.map((p) => p.shares)).toEqual([10, 10, 20]);
    expect(series.map((p) => p.marketValue)).toEqual([1000, 1100, 1100]);

    const portfolio = buildPortfolioHistorySeries({
      stocks: [TW_2330],
      transactionsByStockKey: { "TW:2330": txs },
      historyByStockKey: { "TW:2330": history },
      displayMode: HomeDisplayMode.TW,
      usdToTwdRate: 32,
      returnRateMode: ReturnRateMode.REMAINING_POSITION,
      preDeductSellFees: false,
      feeSettingsByAccount: {},
      sharedFeeSettings: { feeDiscount: 0.28, minFeeRegular: 1, minFeeOddLot: 1 },
      marginDayCount: 365,
    });
    expect(portfolio.map((p) => p.marketValue)).toEqual([1000, 1100, 1100]);
  });

  it("performance_calendar_daily_monthly_08", () => {
    const pt = (date: string, marketValue: number, totalPL: number): PersonalHistoryPoint => ({
      date,
      price: 0,
      shares: 0,
      marketValue,
      totalPL,
      totalPLPercentage: 0,
    });

    const d1 = calculateDailyPerformance([pt("2026-08-03", 100000, 0), pt("2026-08-04", 100000, 1000)]);
    expect(d1[0].profitLoss).toBe(1000);
    expect(d1[0].returnPercentage).toBeCloseTo(1.0, 6);

    const dZero = calculateDailyPerformance([pt("2026-08-03", 0, 0), pt("2026-08-04", 100, 100)]);
    expect(dZero[0].returnPercentage).toBe(0);

    expect(compoundReturns([1.0, 1.0])).toBeCloseTo(2.01, 6);

    const aug = calculateMonthlyPerformance(
      [pt("2026-07-31", 100000, 1000), pt("2026-08-03", 101000, 2000)],
      "2026-08"
    );
    expect(aug).not.toBeNull();
    expect(aug!.profitLoss).toBe(1000);
    expect(aug!.returnPercentage).toBeCloseTo(1.0, 6);
  });
});
