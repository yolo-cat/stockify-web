import { describe, expect, it } from "vitest";
import {
  calculateMarginSummary,
  calculateShortSellingSummary,
  calculateXirrPercentage,
  getAvailableMarginLots,
  getAvailableShortLots,
  hasValidCoverBalances,
  hasValidRepaymentBalances,
  ShortSellingHistoricalXirrTimeline,
  validateFinancingMarket,
  validateTransactionSequence,
} from "@/domain";
import { StockMarket, TransactionType, type StockTransaction } from "@/types";

const DAY_MS = 86_400_000;

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

describe("Margin & Short Selling golden vectors", () => {
  it("margin_interest_purchase_to_repayment_01: 3 days on 80,000 at 36.5% / 365 = 240.0", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.MARGIN_BUY,
        expense: 100000,
        buyPrice: 100,
        buyShares: 1000,
        marginPrincipal: 80000,
        marginAnnualRate: 36.5,
        marginLotId: "lot-1",
      }),
      makeTx({
        id: 2,
        date: 3 * DAY_MS,
        recordTime: 3 * DAY_MS,
        type: TransactionType.MARGIN_REPAYMENT,
        marginRepaymentLotId: "lot-1",
        marginRepayment: 80000,
        expense: 80000,
      }),
    ];
    const summary = calculateMarginSummary(txs, 3 * DAY_MS, 365, false, "UTC");
    expect(summary.outstandingPrincipal).toBe(0);
    expect(summary.accruedInterest).toBeCloseTo(240.0, 6);
  });

  it("margin_partial_repayment_actual_interest_02: proportional interest replacement", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.MARGIN_BUY,
        expense: 100000,
        buyPrice: 100,
        buyShares: 1000,
        marginPrincipal: 100000,
        marginAnnualRate: 36.5,
        marginLotId: "lot-1",
      }),
      makeTx({
        id: 2,
        date: 10 * DAY_MS,
        recordTime: 10 * DAY_MS,
        type: TransactionType.MARGIN_REPAYMENT,
        marginRepaymentLotId: "lot-1",
        marginRepayment: 40000,
        marginActualInterest: 450,
        expense: 40450,
      }),
    ];
    const summary = calculateMarginSummary(txs, 10 * DAY_MS, 365, false, "UTC");
    expect(summary.outstandingPrincipal).toBe(60000);
    expect(summary.accruedInterest).toBeCloseTo(600.0, 6);
    expect(summary.actualInterestPaid).toBe(450);
    expect(summary.totalInterestExpense).toBeCloseTo(1050.0, 6);
  });

  it("margin_interest_only_payment_03: clears accrued interest while leaving principal untouched", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.MARGIN_BUY,
        expense: 100000,
        buyPrice: 100,
        buyShares: 1000,
        marginPrincipal: 100000,
        marginAnnualRate: 36.5,
        marginLotId: "lot-1",
      }),
      makeTx({
        id: 2,
        date: 10 * DAY_MS,
        recordTime: 10 * DAY_MS,
        type: TransactionType.MARGIN_REPAYMENT,
        marginRepaymentLotId: "lot-1",
        marginRepayment: 0,
        marginActualInterest: 1050,
        expense: 1050,
      }),
    ];
    const summary = calculateMarginSummary(txs, 10 * DAY_MS, 365, false, "UTC");
    expect(summary.outstandingPrincipal).toBe(100000);
    expect(summary.accruedInterest).toBe(0);
    expect(summary.actualInterestPaid).toBe(1050);
  });

  it("margin_explicit_zero_self_funded_override_04: preserves explicit 0.0 override", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.MARGIN_BUY,
        expense: 100000,
        buyPrice: 100,
        buyShares: 1000,
        marginPrincipal: 60000,
        marginAnnualRate: 3.65,
        marginLotId: "lot-zero",
        marginSelfFunded: 0,
        marginSelfFundedOverridden: true,
      }),
    ];
    const summary = calculateMarginSummary(txs, 0, 365, false, "UTC");
    expect(summary.selfFundedCapital).toBe(0);
  });

  it("margin_backdated_repayment_overpay_05: rejects overpayment", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.MARGIN_BUY,
        expense: 100000,
        buyPrice: 100,
        buyShares: 1000,
        marginPrincipal: 100000,
        marginAnnualRate: 3.65,
        marginLotId: "lot-1",
      }),
      makeTx({
        id: 2,
        date: 1 * DAY_MS,
        recordTime: 1 * DAY_MS,
        type: TransactionType.MARGIN_REPAYMENT,
        marginRepaymentLotId: "lot-1",
        marginRepayment: 100000,
      }),
      makeTx({
        id: 3,
        date: 2 * DAY_MS,
        recordTime: 2 * DAY_MS,
        type: TransactionType.MARGIN_REPAYMENT,
        marginRepaymentLotId: "lot-1",
        marginRepayment: 60000,
      }),
    ];
    expect(hasValidRepaymentBalances(txs)).toBe(false);
  });

  it("short_partial_cover_borrow_fee_06: accrues borrow fee on remaining principal", () => {
    const txs = [
      makeTx({
        id: 1,
        date: 0,
        recordTime: 0,
        type: TransactionType.SHORT_SELL,
        sellPrice: 100,
        sellShares: 1000,
        shortBorrowPrincipal: 100000,
        shortBorrowAnnualRate: 3.65,
        shortLotId: "short-1",
      }),
      makeTx({
        id: 2,
        date: 10 * DAY_MS,
        recordTime: 1,
        type: TransactionType.SHORT_COVER,
        shortCoverLotId: "short-1",
        shortCoverShares: 400,
      }),
    ];
    const summary = calculateShortSellingSummary(txs, 20 * DAY_MS, 365, false, "UTC");
    expect(summary.outstandingShares).toBe(600);
    expect(summary.accruedBorrowFee).toBeCloseTo(160.0, 6);
    expect(summary.openedPrincipal).toBeCloseTo(60000.0, 6);
  });

  it("short_stock_split_adjusts_shares_and_cover_07: 10x split scales short shares", () => {
    const open = makeTx({
      id: 1,
      date: 0,
      recordTime: 0,
      type: TransactionType.SHORT_SELL,
      sellPrice: 100,
      sellShares: 1000,
      shortBorrowPrincipal: 100000,
      shortLotId: "short-1",
    });
    const split = makeTx({
      id: 2,
      date: DAY_MS,
      recordTime: DAY_MS,
      type: TransactionType.STOCK_SPLIT,
      stockSplitRatio: 10,
      sharesBeforeSplit: 1000,
      sharesAfterSplit: 10000,
    });
    const cover = makeTx({
      id: 3,
      date: 2 * DAY_MS,
      recordTime: 2 * DAY_MS,
      type: TransactionType.SHORT_COVER,
      shortCoverLotId: "short-1",
      shortCoverShares: 10000,
    });

    expect(hasValidCoverBalances([open, split, cover])).toBe(true);
    expect(hasValidCoverBalances([open, cover])).toBe(false);
    expect(
      calculateShortSellingSummary([open, split], DAY_MS, 365, false, "UTC")
        .outstandingShares
    ).toBe(10000);
    expect(
      calculateShortSellingSummary([open, split, cover], 2 * DAY_MS, 365, false, "UTC")
        .outstandingShares
    ).toBe(0);
  });

  it("short_fully_covered_xirr_includes_borrow_fee_08: yields ~6.35% XIRR", () => {
    const txs = [
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
        date: 365 * DAY_MS,
        recordTime: 365 * DAY_MS,
        type: TransactionType.SHORT_COVER,
        expense: 90000,
        shortCoverLotId: "short-1",
        shortCoverShares: 1000,
      }),
    ];
    const summary = calculateShortSellingSummary(txs, 365 * DAY_MS, 365, false, "UTC");
    const flows = new ShortSellingHistoricalXirrTimeline(txs).cashFlowsAt(
      365 * DAY_MS,
      0,
      summary
    );
    const xirr = calculateXirrPercentage(flows, 0.1, "UTC");
    expect(xirr).not.toBeNull();
    expect(xirr!).toBeCloseTo(6.35, 1);
  });

  it("financing_validation_expense_mismatch_09 & financing_validation_rejects_us_ticker_10", () => {
    const invalidRepayment = makeTx({
      date: 2,
      recordTime: 2,
      type: TransactionType.MARGIN_REPAYMENT,
      marginRepaymentLotId: "margin-1",
      marginRepayment: 10000,
      marginActualInterest: 100,
      expense: 10000,
    });
    expect(validateTransactionSequence([invalidRepayment]).valid).toBe(false);

    const invalidComp = makeTx({
      date: 4,
      recordTime: 4,
      type: TransactionType.SHORT_COMPENSATION,
      shortCompensationLotId: "short-1",
      shortCompensation: 500,
      expense: 0,
    });
    expect(validateTransactionSequence([invalidComp]).valid).toBe(false);

    const usTicker = makeTx({
      stockCode: "AAPL",
      market: StockMarket.TW,
      type: TransactionType.SHORT_SELL,
    });
    expect(validateFinancingMarket(usTicker, StockMarket.TW)).toBe("融資融券僅支援台股");
    expect(
      validateFinancingMarket(makeTx({ stockCode: "2330", type: TransactionType.SHORT_SELL }), StockMarket.TW)
    ).toBeNull();
  });

  it("add_tx_equal_timestamp_provisional_id_11 & add_tx_lot_selection_excludes_later_tx_12", () => {
    const opening = makeTx({
      id: 10,
      date: 1000,
      recordTime: 2000,
      type: TransactionType.MARGIN_BUY,
      buyPrice: 100,
      buyShares: 1000,
      expense: 100000,
      marginPrincipal: 100000,
      marginLotId: "margin-lot",
    });
    const candidate = makeTx({
      id: 0,
      date: 1000,
      recordTime: 2000,
      type: TransactionType.MARGIN_REPAYMENT,
      marginRepaymentLotId: "margin-lot",
      marginRepayment: 20000,
      expense: 20000,
    });
    const lotsForNew = getAvailableMarginLots(
      [opening],
      { id: candidate.id, date: candidate.date, recordTime: candidate.recordTime, accountId: 1, stockCode: "2330", market: StockMarket.TW },
      365,
      "UTC"
    );
    expect(lotsForNew).toHaveLength(1);
    expect(lotsForNew[0].remainingPrincipal).toBe(100000);

    // Editing intermediate tx excludes self and later tx
    const laterRepayment = makeTx({
      id: 3,
      date: 1000,
      recordTime: 3000,
      type: TransactionType.MARGIN_REPAYMENT,
      marginRepaymentLotId: "margin-lot",
      marginRepayment: 100000,
    });
    const lotsForEdit = getAvailableMarginLots(
      [{ ...opening, id: 1, recordTime: 1000 }, laterRepayment],
      { id: 2, date: 1000, recordTime: 2000, accountId: 1, stockCode: "2330", market: StockMarket.TW },
      365,
      "UTC"
    );
    expect(lotsForEdit).toHaveLength(1);
    expect(lotsForEdit[0].remainingPrincipal).toBe(100000);

    expect(
      getAvailableShortLots([], { id: 0, date: 1000, recordTime: 1000, accountId: 1, stockCode: "2330", market: StockMarket.TW })
    ).toEqual([]);
  });
});
