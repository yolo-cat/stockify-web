import {
  TransactionType,
  type CashFlow,
  type ShortLotOption,
  type ShortLotSummary,
  type ShortSellingSummary,
  type StockTransaction,
} from "@/types";
import { isStrictlyBeforeCandidate, type LotCandidateScope } from "./margin";
import { canonicalStockCode, normalizeMarket } from "./market";
import { calendarDaysBetween, getSystemTimeZone } from "./xirr";

const BALANCE_EPSILON = 1e-6;

function compareTransactions(a: StockTransaction, b: StockTransaction): number {
  if (a.date !== b.date) return a.date - b.date;
  if (a.recordTime !== b.recordTime) return a.recordTime - b.recordTime;
  return a.id - b.id;
}

function shortLotScopeKey(
  tx: Pick<StockTransaction, "market" | "stockCode" | "accountId">,
  lotId: string
): string {
  return `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}:${lotId}`;
}

function scopePrefix(tx: Pick<StockTransaction, "market" | "stockCode" | "accountId">): string {
  return `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}:`;
}

export function splitShareFactorInternal(tx: StockTransaction): number {
  if (tx.sharesBeforeSplit > 0.0 && tx.sharesAfterSplit > 0.0) {
    return tx.sharesAfterSplit / tx.sharesBeforeSplit;
  }
  return tx.stockSplitRatio > 0.0 ? tx.stockSplitRatio : 1.0;
}

export function capitalReductionShareFactorInternal(tx: StockTransaction): number {
  if (tx.sharesBeforeReduction > 0.0 && tx.sharesAfterReduction > 0.0) {
    return tx.sharesAfterReduction / tx.sharesBeforeReduction;
  }
  if (tx.capitalReductionRatio >= 0.0 && tx.capitalReductionRatio <= 100.0) {
    return 1.0 - tx.capitalReductionRatio / 100.0;
  }
  return 1.0;
}

function shareAdjustmentFactor(tx: StockTransaction): number {
  if (tx.type === TransactionType.STOCK_SPLIT) return splitShareFactorInternal(tx);
  if (tx.type === TransactionType.CAPITAL_REDUCTION) return capitalReductionShareFactorInternal(tx);
  return 1.0;
}

interface ShortLotState {
  id: string;
  openedAt: number;
  annualRate: number;
  originalShares: number;
  originalPrincipal: number;
  remainingShares: number;
  accruedBorrowFee: number;
  lastAccrualDate: number;
}

interface XirrShortLotState {
  originalShares: number;
  remainingShares: number;
  originalPrincipal: number;
  openingIncome: number;
}

export class ShortSellingHistoricalTimeline {
  private readonly denominator: number;
  private readonly orderedTransactions: StockTransaction[];
  private readonly timeZone: string;
  private readonly lots = new Map<string, ShortLotState>();
  private nextIndex = 0;
  private lastValuationDate = -Infinity;
  private compensationExpense = 0.0;
  private cumulativeOpenedPrincipal = 0.0;

  constructor(
    transactions: readonly StockTransaction[],
    dayCount: number = 365,
    transactionsAreOrdered: boolean = false,
    timeZone: string = getSystemTimeZone()
  ) {
    this.denominator = dayCount === 360 ? 360 : 365;
    this.orderedTransactions = transactionsAreOrdered
      ? transactions.slice()
      : transactions.slice().sort(compareTransactions);
    this.timeZone = timeZone;
  }

  advanceTo(valuationDate: number): ShortSellingSummary {
    if (valuationDate < this.lastValuationDate) {
      throw new Error("融券歷史回放日期必須遞增");
    }
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      this.apply(this.orderedTransactions[this.nextIndex]);
      this.nextIndex++;
    }
    for (const lot of this.lots.values()) {
      this.accrue(lot, valuationDate);
    }
    this.lastValuationDate = valuationDate;
    return this.summary();
  }

  private apply(tx: StockTransaction): void {
    for (const lot of this.lots.values()) {
      this.accrue(lot, tx.date);
    }
    switch (tx.type) {
      case TransactionType.SHORT_SELL: {
        const shares = Math.max(0.0, tx.sellShares);
        const principal =
          tx.shortBorrowPrincipal > 0.0 ? tx.shortBorrowPrincipal : tx.sellPrice * shares;
        if (shares > 0.0) {
          const id = tx.shortLotId.trim() ? tx.shortLotId : `legacy-short-${tx.id}`;
          this.lots.set(shortLotScopeKey(tx, id), {
            id,
            openedAt: tx.date,
            annualRate: tx.shortBorrowAnnualRate,
            originalShares: shares,
            originalPrincipal: principal,
            remainingShares: shares,
            accruedBorrowFee: 0.0,
            lastAccrualDate: tx.date,
          });
          this.cumulativeOpenedPrincipal += principal;
        }
        break;
      }
      case TransactionType.SHORT_COVER: {
        if (tx.shortCoverLotId.trim() && tx.shortCoverShares > 0.0) {
          const lot = this.lots.get(shortLotScopeKey(tx, tx.shortCoverLotId));
          if (lot) {
            lot.remainingShares = Math.max(0.0, lot.remainingShares - tx.shortCoverShares);
            lot.lastAccrualDate = tx.date;
          }
        }
        break;
      }
      case TransactionType.SHORT_COMPENSATION: {
        this.compensationExpense += Math.max(0.0, tx.shortCompensation);
        break;
      }
      case TransactionType.STOCK_SPLIT:
      case TransactionType.CAPITAL_REDUCTION: {
        const factor = shareAdjustmentFactor(tx);
        if (factor > 0.0 && factor !== 1.0) {
          const prefix = scopePrefix(tx);
          for (const [key, lot] of this.lots.entries()) {
            if (key.startsWith(prefix)) {
              lot.originalShares *= factor;
              lot.remainingShares *= factor;
            }
          }
        }
        break;
      }
    }
  }

  private accrue(lot: ShortLotState, date: number): void {
    if (date <= lot.lastAccrualDate || lot.remainingShares <= 0.0 || lot.originalShares <= 0.0) {
      return;
    }
    const days = Math.max(0, calendarDaysBetween(lot.lastAccrualDate, date, this.timeZone));
    const principal = (lot.originalPrincipal * lot.remainingShares) / lot.originalShares;
    lot.accruedBorrowFee +=
      (principal * (lot.annualRate / 100.0) * days) / this.denominator;
    lot.lastAccrualDate = date;
  }

  private summary(): ShortSellingSummary {
    let outstandingShares = 0.0;
    let accruedBorrowFee = 0.0;
    let openedPrincipal = 0.0;
    const activeLots: ShortLotSummary[] = [];

    for (const lot of this.lots.values()) {
      outstandingShares += lot.remainingShares;
      accruedBorrowFee += lot.accruedBorrowFee;
      if (lot.remainingShares > 0.0) {
        openedPrincipal +=
          lot.originalShares > 0.0
            ? lot.originalPrincipal * (lot.remainingShares / lot.originalShares)
            : 0.0;
        activeLots.push({
          lotId: lot.id,
          openedAt: lot.openedAt,
          annualRate: lot.annualRate,
          originalShares: lot.originalShares,
          remainingShares: lot.remainingShares,
          originalPrincipal: lot.originalPrincipal,
          accruedBorrowFee: lot.accruedBorrowFee,
        });
      }
    }

    return {
      outstandingShares,
      accruedBorrowFee,
      compensationExpense: this.compensationExpense,
      lots: activeLots,
      openedPrincipal,
      cumulativeOpenedPrincipal: this.cumulativeOpenedPrincipal,
    };
  }
}

export class ShortSellingHistoricalXirrTimeline {
  private readonly orderedTransactions: StockTransaction[];
  private readonly transactionDateMapper: (date: number) => number;
  private readonly lots = new Map<string, XirrShortLotState>();
  private readonly cashFlows: CashFlow[] = [];
  private nextIndex = 0;
  private lastValuationDate = -Infinity;

  constructor(
    transactions: readonly StockTransaction[],
    transactionDateMapper: (date: number) => number = (d) => d,
    transactionsAreOrdered: boolean = false
  ) {
    this.orderedTransactions = transactionsAreOrdered
      ? transactions.slice()
      : transactions.slice().sort(compareTransactions);
    this.transactionDateMapper = transactionDateMapper;
  }

  cashFlowsAt(
    valuationDate: number,
    currentPrice: number,
    shortSummary: ShortSellingSummary,
    terminalDate: number = valuationDate
  ): CashFlow[] {
    if (valuationDate < this.lastValuationDate) {
      throw new Error("歷史 XIRR 現金流日期必須遞增");
    }
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      this.apply(this.orderedTransactions[this.nextIndex]);
      this.nextIndex++;
    }

    const result = this.cashFlows.slice();
    if (currentPrice > 0.0) {
      for (const lot of this.lots.values()) {
        if (lot.remainingShares > 0.0 && lot.originalShares > 0.0) {
          const remainingRatio = lot.remainingShares / lot.originalShares;
          result.push({
            dateMillis: terminalDate,
            amount:
              lot.originalPrincipal * remainingRatio +
              lot.openingIncome * remainingRatio -
              currentPrice * lot.remainingShares,
          });
        }
      }
    }
    if (shortSummary.accruedBorrowFee > 0.0) {
      result.push({
        dateMillis: terminalDate,
        amount: -shortSummary.accruedBorrowFee,
      });
    }
    this.lastValuationDate = valuationDate;
    return result;
  }

  private apply(tx: StockTransaction): void {
    switch (tx.type) {
      case TransactionType.SHORT_SELL: {
        const shares = Math.max(0.0, tx.sellShares);
        if (shares > 0.0) {
          const principal =
            tx.shortBorrowPrincipal > 0.0 ? tx.shortBorrowPrincipal : tx.sellPrice * shares;
          const lotId = tx.shortLotId.trim() ? tx.shortLotId : `legacy-short-${tx.id}`;
          this.lots.set(shortLotScopeKey(tx, lotId), {
            originalShares: shares,
            remainingShares: shares,
            originalPrincipal: principal,
            openingIncome: tx.income,
          });
          this.cashFlows.push({
            dateMillis: this.transactionDateMapper(tx.date),
            amount: -principal,
          });
        }
        break;
      }
      case TransactionType.SHORT_COVER: {
        const requestedShares = Math.max(0.0, tx.shortCoverShares);
        const lot = this.lots.get(shortLotScopeKey(tx, tx.shortCoverLotId));
        if (lot && requestedShares > 0.0 && lot.remainingShares > 0.0) {
          const coveredShares = Math.min(requestedShares, lot.remainingShares);
          const coveredRatio = coveredShares / lot.originalShares;
          const allocatedCoverExpense = tx.expense * (coveredShares / requestedShares);
          const returnedAmount =
            lot.originalPrincipal * coveredRatio +
            lot.openingIncome * coveredRatio -
            allocatedCoverExpense;
          this.cashFlows.push({
            dateMillis: this.transactionDateMapper(tx.date),
            amount: returnedAmount,
          });
          lot.remainingShares -= coveredShares;
        } else if (tx.expense > 0.0) {
          this.cashFlows.push({
            dateMillis: this.transactionDateMapper(tx.date),
            amount: -tx.expense,
          });
        }
        break;
      }
      case TransactionType.SHORT_COMPENSATION: {
        if (tx.shortCompensation > 0.0) {
          this.cashFlows.push({
            dateMillis: this.transactionDateMapper(tx.date),
            amount: -tx.shortCompensation,
          });
        }
        break;
      }
      case TransactionType.STOCK_SPLIT:
      case TransactionType.CAPITAL_REDUCTION: {
        const factor = shareAdjustmentFactor(tx);
        if (factor > 0.0 && factor !== 1.0) {
          const prefix = scopePrefix(tx);
          for (const [key, lot] of this.lots.entries()) {
            if (key.startsWith(prefix)) {
              lot.originalShares *= factor;
              lot.remainingShares *= factor;
            }
          }
        }
        break;
      }
    }
  }
}

export function calculateShortSellingSummary(
  transactions: readonly StockTransaction[],
  valuationDate: number,
  dayCount: number = 365,
  transactionsAreOrdered: boolean = false,
  timeZone: string = getSystemTimeZone()
): ShortSellingSummary {
  return new ShortSellingHistoricalTimeline(
    transactions,
    dayCount,
    transactionsAreOrdered,
    timeZone
  ).advanceTo(valuationDate);
}

export function buildShortXirrCashFlows(
  transactions: readonly StockTransaction[],
  valuationDate: number,
  currentPrice: number,
  dayCount: number = 365,
  shortSummary: ShortSellingSummary | null = null,
  transactionDateMapper: (date: number) => number = (d) => d,
  transactionsAreOrdered: boolean = false,
  timeZone: string = getSystemTimeZone()
): CashFlow[] {
  const summary =
    shortSummary ??
    calculateShortSellingSummary(
      transactions,
      valuationDate,
      dayCount,
      transactionsAreOrdered,
      timeZone
    );
  return new ShortSellingHistoricalXirrTimeline(
    transactions,
    transactionDateMapper,
    transactionsAreOrdered
  ).cashFlowsAt(valuationDate, currentPrice, summary);
}

export function hasValidCoverBalances(
  transactions: readonly StockTransaction[]
): boolean {
  const remainingByLot = new Map<string, number>();
  const ordered = transactions.slice().sort(compareTransactions);

  for (const tx of ordered) {
    if (tx.type === TransactionType.SHORT_SELL) {
      const lotId = tx.shortLotId.trim() ? tx.shortLotId : `legacy-short-${tx.id}`;
      remainingByLot.set(shortLotScopeKey(tx, lotId), Math.max(0.0, tx.sellShares));
    }

    if (tx.shortCoverShares > 0.0) {
      const key = shortLotScopeKey(tx, tx.shortCoverLotId);
      const remaining = remainingByLot.get(key);
      if (remaining === undefined) return false;
      if (tx.shortCoverShares > remaining + BALANCE_EPSILON) return false;
      remainingByLot.set(key, Math.max(0.0, remaining - tx.shortCoverShares));
    }

    if (tx.type === TransactionType.SHORT_COMPENSATION) {
      const remaining = remainingByLot.get(shortLotScopeKey(tx, tx.shortCompensationLotId));
      if (remaining === undefined || remaining <= BALANCE_EPSILON) return false;
    }

    if (
      tx.type === TransactionType.STOCK_SPLIT ||
      tx.type === TransactionType.CAPITAL_REDUCTION
    ) {
      const factor = shareAdjustmentFactor(tx);
      if (factor > 0.0 && factor !== 1.0) {
        const prefix = scopePrefix(tx);
        for (const [key, remaining] of remainingByLot.entries()) {
          if (key.startsWith(prefix)) {
            remainingByLot.set(key, remaining * factor);
          }
        }
      }
    }
  }

  return true;
}

export function getAvailableShortLots(
  transactions: readonly StockTransaction[],
  candidate: LotCandidateScope,
  dayCount: number = 365,
  timeZone: string = getSystemTimeZone()
): ShortLotOption[] {
  const targetMarket = normalizeMarket(candidate.market);
  const targetCode = canonicalStockCode(candidate.stockCode);
  const prior = transactions.filter(
    (tx) =>
      tx.id !== candidate.id &&
      tx.accountId === candidate.accountId &&
      normalizeMarket(tx.market) === targetMarket &&
      canonicalStockCode(tx.stockCode) === targetCode &&
      isStrictlyBeforeCandidate(tx, candidate)
  );
  const summary = calculateShortSellingSummary(
    prior,
    candidate.date,
    dayCount,
    false,
    timeZone
  );
  return summary.lots
    .filter((lot) => lot.remainingShares > BALANCE_EPSILON)
    .map((lot) => ({
      lotId: lot.lotId,
      label: `${lot.lotId}（未還 ${lot.remainingShares.toLocaleString("en-US")} 股）`,
      remainingShares: lot.remainingShares,
    }));
}
