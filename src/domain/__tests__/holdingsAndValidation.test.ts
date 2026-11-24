import { describe, expect, it } from "vitest";
import {
  aggregateHoldingsUiState,
  buildAssetOverviewUiState,
  buildTransactionsUiState,
  calculateHoldingInfo,
  calculateMarginSummary,
  calculateProfitLossBreakdown,
  canDeleteTransaction,
  filterTransactionDateSections,
  HoldingCalculationCache,
  positionInvestmentBasis,
  replayLongPosition,
  sortHoldings,
  transactionCashFlowAmount,
  validateEditTransactionScopes,
  validateLongPositionBalances,
  validateSingleTransaction,
  validateTransactionSequence,
} from "@/domain";
import {
  HomeDisplayMode,
  HomeHoldingsSortColumn,
  HomeHoldingsSortMode,
  LimitState,
  ReturnRateMode,
  StockMarket,
  TransactionType,
  type HoldingCalculationInputs,
  type Stock,
  type StockTransaction,
} from "@/types";

const DAY_MS = 86_400_000;

const TW_2330: Stock = {
  name: "台積電",
  code: "2330",
  market: StockMarket.TW,
  exchange: "上市",
  industry: "半導體",
  stockType: "股票",
};

const US_AAPL: Stock = {
  name: "Apple",
  code: "AAPL",
  market: StockMarket.US,
  exchange: "",
  industry: "Tech",
  stockType: "Stock",
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

describe("Holdings, P&L Breakdown, Cache, Aggregation & Validation", () => {
  it("holding_replay_ordinary_trades_01", () => {
    const txs = [
      makeTx({ id: 1, date: 1, recordTime: 1, type: TransactionType.BUY, buyPrice: 100, buyShares: 1000, expense: 100100 }),
      makeTx({ id: 2, date: 2, recordTime: 2, type: TransactionType.SELL, sellPrice: 120, sellShares: 400, income: 47700 }),
      makeTx({ id: 3, date: 3, recordTime: 3, type: TransactionType.CASH_DIVIDEND, dividendIncome: 1000 }),
    ];
    const summary = replayLongPosition(txs, 3);
    expect(summary.shares).toBe(600);
    expect(summary.totalBuyExpense).toBe(100100);
    expect(summary.totalSellIncome).toBe(47700);
    expect(summary.sellAmountBeforeFee).toBe(48000);
    expect(summary.totalDividendIncome).toBe(1000);
  });

  it("holding_validate_oversell_rejected_01 & company_action_mismatch_01", () => {
    expect(
      validateLongPositionBalances([
        makeTx({ id: 1, date: 1, recordTime: 1, type: TransactionType.BUY, buyShares: 100 }),
        makeTx({ id: 2, date: 2, recordTime: 2, type: TransactionType.SELL, sellShares: 101 }),
      ])
    ).not.toBeNull();

    expect(
      validateLongPositionBalances([
        makeTx({ id: 1, date: 1, recordTime: 1, type: TransactionType.BUY, buyShares: 100 }),
        makeTx({
          id: 2,
          date: 2,
          recordTime: 2,
          type: TransactionType.CAPITAL_REDUCTION,
          capitalReductionRatio: 20,
          sharesBeforeReduction: 100,
          sharesAfterReduction: 70,
        }),
      ])
    ).not.toBeNull();
  });

  it("holding_position_investment_basis_financed_01", () => {
    const basis = positionInvestmentBasis({
      shares: 1000,
      costBasis: 100000,
      longInvestment: 40000,
      financedRemainingInvestment: 40000,
      marginDebt: 60000,
      shortOutstandingShares: 0,
      shortRemainingInvestment: 0,
      shortCumulativeInvestment: 0,
    });
    expect(basis.remaining).toBe(40000);
    expect(basis.cumulative).toBe(40000);
  });

  it("pl_breakdown_moving_average_partial_sale_01 & loss_reduction_no_cash_01 & partial_short_cover_01", () => {
    const partialSaleTxs = [
      makeTx({ id: 1, date: 1, recordTime: 1, type: TransactionType.BUY, buyPrice: 100, buyShares: 100, expense: 10000 }),
      makeTx({ id: 2, date: 2, recordTime: 2, type: TransactionType.BUY, buyPrice: 200, buyShares: 100, expense: 20000 }),
      makeTx({ id: 3, date: 3, recordTime: 3, type: TransactionType.SELL, sellPrice: 250, sellShares: 100, income: 25000 }),
    ];
    const bd1 = calculateProfitLossBreakdown(
      partialSaleTxs,
      3,
      15000,
      calculateMarginSummary([], 3),
      365
    );
    expect(bd1.realizedProfitLoss).toBe(10000);
    expect(bd1.unrealizedProfitLoss).toBe(5000);
    expect(bd1.realizedCost).toBe(15000);
    expect(bd1.unrealizedCost).toBe(15000);
    expect(bd1.soldShares).toBe(100);

    const lossRedTxs = [
      makeTx({ id: 1, date: 1, recordTime: 1, type: TransactionType.BUY, buyPrice: 100, buyShares: 100, expense: 10000 }),
      makeTx({
        id: 2,
        date: 2,
        recordTime: 2,
        type: TransactionType.CAPITAL_REDUCTION,
        sharesBeforeReduction: 100,
        sharesAfterReduction: 80,
        capitalReductionRatio: 20,
        cashReturned: 0,
      }),
    ];
    const bd2 = calculateProfitLossBreakdown(
      lossRedTxs,
      2,
      0,
      calculateMarginSummary([], 2),
      365
    );
    expect(bd2.realizedProfitLoss).toBe(0);
    expect(bd2.unrealizedCost).toBe(10000);
    expect(bd2.unrealizedAverageCost).toBe(125);
    expect(bd2.hasRealizedActivity).toBe(false);

    const shortTxs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.SHORT_SELL,
        sellPrice: 100,
        sellShares: 1000,
        income: 100000,
        shortBorrowPrincipal: 100000,
        shortBorrowAnnualRate: 3.65,
        shortLotId: "short-1",
      }),
      makeTx({
        id: 2,
        date: 10 * DAY_MS,
        recordTime: 1,
        type: TransactionType.SHORT_COVER,
        buyPrice: 90,
        buyShares: 400,
        expense: 36000,
        shortCoverLotId: "short-1",
        shortCoverShares: 400,
      }),
    ];
    // 100,000 - 36,000 - (600 * 80) - 160 = 15,840
    const bd3 = calculateProfitLossBreakdown(
      shortTxs,
      20 * DAY_MS,
      15840,
      calculateMarginSummary([], 20 * DAY_MS),
      365,
      true,
      "UTC"
    );
    expect(bd3.realizedProfitLoss).toBeCloseTo(3960.0, 6);
    expect(bd3.unrealizedProfitLoss).toBeCloseTo(11880.0, 6);
    expect(bd3.coveredShortShares).toBe(400);
    expect(bd3.realizedCost).toBe(40000);
    expect(bd3.unrealizedCost).toBe(60000);
  });

  it("transaction_validation_isolation_and_legacy_split_01", () => {
    expect(
      validateSingleTransaction(
        makeTx({
          type: TransactionType.BUY,
          buyPrice: 100,
          buyShares: 10,
          expense: 1000,
          sellPrice: 100,
          sellShares: 1,
        })
      )
    ).not.toBeNull();

    expect(
      validateSingleTransaction(
        makeTx({
          type: TransactionType.BUY,
          buyPrice: 100,
          buyShares: 10,
          expense: 1000,
          shortBorrowPrincipal: 100,
        })
      )
    ).not.toBeNull();

    expect(
      validateSingleTransaction(
        makeTx({
          stockCode: "0050",
          date: 7,
          recordTime: 1,
          type: TransactionType.STOCK_SPLIT,
          fee: 250,
          stockSplitRatio: 4,
          sharesBeforeSplit: 3300,
          sharesAfterSplit: 13200,
        })
      )
    ).toBeNull();
  });

  it("calculateHoldingInfo, HoldingCalculationCache invalidation, aggregation & sorting", () => {
    const txs = [
      makeTx({ id: 1, date: 0, recordTime: 1, type: TransactionType.BUY, buyPrice: 100, buyShares: 1000, expense: 100000 }),
      makeTx({ id: 2, date: DAY_MS, recordTime: 2, type: TransactionType.CASH_DIVIDEND, dividendIncome: 5000 }),
    ];
    const baseInputs: HoldingCalculationInputs = {
      stock: TW_2330,
      transactions: txs,
      currentPrice: 110,
      dailyChange: 2,
      dailyChangePercentage: 1.85,
      limitState: LimitState.NONE,
      preDeductSellFees: false,
      feeSettingsByAccount: {},
      sharedFeeSettings: { feeDiscount: 0.28, minFeeRegular: 1, minFeeOddLot: 1 },
      returnRateMode: ReturnRateMode.REMAINING_POSITION,
      currentDateMillis: 2 * DAY_MS,
      marginDayCount: 365,
      includeProfitLossBreakdown: true,
      excludeDividendIncomeFromReturns: false,
    };

    const cache = new HoldingCalculationCache();
    let computeCalls = 0;
    const h1 = cache.getOrCompute(baseInputs, (inp) => {
      computeCalls++;
      return calculateHoldingInfo(inp);
    });
    expect(h1.totalPL).toBe(15000);
    expect(h1.dividendIncome).toBe(5000);
    expect(h1.isRealizedSlice).toBe(false);

    // Same inputs -> cache hit
    cache.getOrCompute({ ...baseInputs }, (inp) => {
      computeCalls++;
      return calculateHoldingInfo(inp);
    });
    expect(computeCalls).toBe(1);

    // Toggle excludeDividendIncomeFromReturns -> cache miss & excludes dividend from totalPL
    const h2 = cache.getOrCompute(
      { ...baseInputs, excludeDividendIncomeFromReturns: true },
      (inp) => {
        computeCalls++;
        return calculateHoldingInfo(inp);
      }
    );
    expect(computeCalls).toBe(2);
    expect(h2.totalPL).toBe(10000);
    expect(h2.dividendIncome).toBe(5000);

    // Aggregation in COMBINED vs US mode
    const usHolding = calculateHoldingInfo({
      ...baseInputs,
      stock: US_AAPL,
      transactions: [
        makeTx({
          id: 3,
          stockCode: "AAPL",
          market: StockMarket.US,
          date: 0,
          recordTime: 1,
          type: TransactionType.BUY,
          buyPrice: 100,
          buyShares: 10,
          expense: 1000,
        }),
      ],
      currentPrice: 120,
      dailyChange: 5,
    });
    const combined = aggregateHoldingsUiState([h1, usHolding], HomeDisplayMode.COMBINED, 32);
    expect(combined.taiwanMarketValue).toBe(110000);
    expect(combined.usMarketValue).toBe(1200);
    expect(combined.marketValue).toBe(110000 + 1200 * 32);
    expect(combined.dailyPL).toBe(1000 * 2 + 10 * 5 * 32);

    const sortedByMv = sortHoldings([h1, usHolding], {
      sortMode: HomeHoldingsSortMode.COLUMN,
      sortColumn: HomeHoldingsSortColumn.MARKET_VALUE,
      ascending: true,
      manualOrder: [],
      displayMode: HomeDisplayMode.COMBINED,
      usdToTwdRate: 32,
    });
    expect(sortedByMv.map((h) => h.stock.code)).toEqual(["AAPL", "2330"]);

    const assets = buildAssetOverviewUiState({
      taiwanStockValue: 110000,
      usStockValue: 38400,
      stockValues: combined.assetStockValues,
      bankDeposits: [{ id: 1, name: "銀行", amount: 50000 }],
      loans: [{ id: 1, name: "貸款", amount: 20000 }],
    });
    expect(assets.grossAssets).toBe(198400);
    expect(assets.netAssets).toBe(178400);
  });

  it("canDeleteTransaction blocks referenced margin/short opening lots and validateEditTransactionScopes checks both scopes", () => {
    const open = makeTx({
      id: 1,
      date: 0,
      recordTime: 0,
      type: TransactionType.MARGIN_BUY,
      buyPrice: 100,
      buyShares: 1000,
      expense: 100000,
      marginPrincipal: 60000,
      marginLotId: "m-1",
    });
    const repay = makeTx({
      id: 2,
      date: DAY_MS,
      recordTime: 1,
      type: TransactionType.MARGIN_REPAYMENT,
      marginRepaymentLotId: "m-1",
      marginRepayment: 60000,
      expense: 60000,
    });
    expect(canDeleteTransaction(open, [open, repay])).toBe(false);
    expect(canDeleteTransaction(repay, [open, repay])).toBe(true);

    // Moving `open` to account 2 leaves `repay` orphaned in account 1 -> rejected
    const moveRes = validateEditTransactionScopes([open, repay], open, {
      ...open,
      accountId: 2,
    });
    expect(moveRes.valid).toBe(false);
    expect(validateTransactionSequence([open, repay]).valid).toBe(true);
  });

  it("transactions_vm_cashflow_totals_by_market_08 & search_filtering_09 & tx_form_sell_margin_over_income_cashflow_06", () => {
    const overIncomeSell = makeTx({
      type: TransactionType.SELL,
      income: 50000,
      marginRepaymentLotId: "lot-1",
      marginRepayment: 55000,
      marginActualInterest: 500,
    });
    expect(transactionCashFlowAmount(overIncomeSell)).toBe(-5500);

    const ui = buildTransactionsUiState({
      transactionsWithStock: [
        {
          transaction: makeTx({ id: 1, stockCode: "2330", market: StockMarket.TW, date: DAY_MS, recordTime: 3, type: TransactionType.BUY, expense: 1000 }),
          stock: TW_2330,
        },
        {
          transaction: makeTx({ id: 2, stockCode: "AAPL", market: StockMarket.US, date: DAY_MS, recordTime: 2, type: TransactionType.BUY, expense: 500, note: "定期定額" }),
          stock: US_AAPL,
        },
        {
          transaction: makeTx({ id: 3, stockCode: "AAPL", market: StockMarket.US, date: 0, recordTime: 1, type: TransactionType.CASH_DIVIDEND, income: 12.5 }),
          stock: US_AAPL,
        },
      ],
      accountId: 1,
      query: "",
      timeZone: "UTC",
    });

    expect(ui.totalCount).toBe(3);
    expect(ui.sections[0].cashFlowTotals).toEqual([
      { market: StockMarket.TW, income: 0, expense: 1000 },
      { market: StockMarket.US, income: 0, expense: 500 },
    ]);

    expect(
      filterTransactionDateSections(ui.sections, " aApL ").flatMap((s) =>
        s.transactions.map((t) => t.transaction.id)
      )
    ).toEqual([2, 3]);
    expect(
      filterTransactionDateSections(ui.sections, "Apple 配息").flatMap((s) =>
        s.transactions.map((t) => t.transaction.id)
      )
    ).toEqual([3]);
    expect(
      filterTransactionDateSections(ui.sections, "1970/01/02").flatMap((s) =>
        s.transactions.map((t) => t.transaction.id)
      )
    ).toEqual([1, 2]);
    expect(filterTransactionDateSections(ui.sections, "2330 配息")).toEqual([]);
  });
});
