import {
  TransactionType,
  type CashFlow,
  type MarginLotOption,
  type MarginLotSummary,
  type MarginSummary,
  type StockTransaction,
} from "@/types";
import { canonicalStockCode, normalizeMarket } from "./market";
import { calendarDaysBetween, getSystemTimeZone } from "./xirr";

const BALANCE_EPSILON = 1e-6;

function compareTransactions(a: StockTransaction, b: StockTransaction): number {
  if (a.date !== b.date) return a.date - b.date;
  if (a.recordTime !== b.recordTime) return a.recordTime - b.recordTime;
  return a.id - b.id;
}

function lotScopeKey(tx: Pick<StockTransaction, "market" | "stockCode" | "accountId">, lotId: string): string {
  return `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}:${lotId}`;
}

function resolveDividendIncomeLocal(tx: StockTransaction): number {
  return tx.dividendIncome !== 0.0 || tx.income === 0.0 ? tx.dividendIncome : tx.income;
}

interface MarginLotState {
  id: string;
  openedAt: number;
  annualRate: number;
  originalPrincipal: number;
  remainingPrincipal: number;
  accruedInterest: number;
  actualInterestPaid: number;
  lastAccrualDate: number;
}

export function totalMarginInterestExpense(summary: Pick<MarginSummary, "accruedInterest" | "actualInterestPaid">): number {
  return summary.accruedInterest + summary.actualInterestPaid;
}

export class MarginHistoricalTimeline {
  private readonly denominator: number;
  private readonly orderedTransactions: StockTransaction[];
  private readonly timeZone: string;
  private readonly lots = new Map<string, MarginLotState>();
  private nextIndex = 0;
  private lastValuationDate = -Infinity;
  private selfFundedCapital = 0.0;
  private cashBalance = 0.0;

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

  advanceTo(valuationDate: number): MarginSummary {
    if (valuationDate < this.lastValuationDate) {
      throw new Error("融資歷史回放日期必須遞增");
    }
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      this.apply(this.orderedTransactions[this.nextIndex]);
      this.nextIndex++;
    }
    for (const lot of this.lots.values()) {
      this.accrueUntil(lot, valuationDate);
    }
    this.lastValuationDate = valuationDate;
    return this.summary();
  }

  private apply(tx: StockTransaction): void {
    for (const lot of this.lots.values()) {
      this.accrueUntil(lot, tx.date);
    }
    switch (tx.type) {
      case TransactionType.MARGIN_BUY: {
        const id = tx.marginLotId.trim() ? tx.marginLotId : `legacy-${tx.id}`;
        const principal = Math.max(0.0, tx.marginPrincipal);
        if (principal > 0.0) {
          this.lots.set(lotScopeKey(tx, id), {
            id,
            openedAt: tx.date,
            annualRate: tx.marginAnnualRate,
            originalPrincipal: principal,
            remainingPrincipal: principal,
            accruedInterest: 0.0,
            actualInterestPaid: 0.0,
            lastAccrualDate: tx.date,
          });
        }
        const selfFunded = tx.marginSelfFundedOverridden
          ? tx.marginSelfFunded
          : tx.expense - principal;
        this.cashBalance -= selfFunded;
        this.selfFundedCapital += Math.max(0.0, selfFunded);
        break;
      }
      case TransactionType.BUY: {
        this.cashBalance -= tx.expense;
        this.selfFundedCapital += tx.expense;
        break;
      }
      case TransactionType.SELL: {
        this.cashBalance +=
          tx.income -
          Math.max(0.0, tx.marginRepayment) -
          Math.max(0.0, tx.marginActualInterest);
        break;
      }
      case TransactionType.CASH_DIVIDEND: {
        this.cashBalance += resolveDividendIncomeLocal(tx);
        break;
      }
      case TransactionType.CAPITAL_REDUCTION: {
        this.cashBalance += tx.cashReturned;
        break;
      }
    }

    const isMarginRepayment =
      tx.marginRepaymentLotId.trim().length > 0 &&
      (tx.marginRepayment > 0.0 || tx.marginActualInterest > 0.0);

    if (isMarginRepayment) {
      const lot = this.lots.get(lotScopeKey(tx, tx.marginRepaymentLotId));
      if (lot) {
        this.accrueUntil(lot, tx.date);
        const principalBeforeRepayment = lot.remainingPrincipal;
        if (tx.marginActualInterest > 0.0) {
          lot.actualInterestPaid += tx.marginActualInterest;
          if (tx.marginRepayment <= 0.0) {
            lot.accruedInterest = 0.0;
          } else if (principalBeforeRepayment > 0.0) {
            const repaidRatio = Math.min(
              1.0,
              Math.max(0.0, tx.marginRepayment / principalBeforeRepayment)
            );
            lot.accruedInterest = lot.accruedInterest * (1.0 - repaidRatio);
          }
        }
        if (tx.marginRepayment > 0.0) {
          lot.remainingPrincipal = Math.max(0.0, lot.remainingPrincipal - tx.marginRepayment);
        }
        lot.lastAccrualDate = tx.date;
      }
      if (tx.type === TransactionType.MARGIN_REPAYMENT) {
        this.cashBalance -= tx.marginRepayment + tx.marginActualInterest;
      }
    } else if (tx.marginActualInterest > 0.0 && tx.type !== TransactionType.SELL) {
      this.cashBalance -= tx.marginActualInterest;
    }
  }

  private accrueUntil(lot: MarginLotState, date: number): void {
    if (date <= lot.lastAccrualDate || lot.remainingPrincipal <= 0.0) return;
    const days = Math.max(0, calendarDaysBetween(lot.lastAccrualDate, date, this.timeZone));
    lot.accruedInterest +=
      (lot.remainingPrincipal * (lot.annualRate / 100.0) * days) / this.denominator;
    lot.lastAccrualDate = date;
  }

  private summary(): MarginSummary {
    let outstandingPrincipal = 0.0;
    let accruedInterest = 0.0;
    let actualInterestPaid = 0.0;
    const activeLots: MarginLotSummary[] = [];

    for (const lot of this.lots.values()) {
      outstandingPrincipal += lot.remainingPrincipal;
      accruedInterest += lot.accruedInterest;
      actualInterestPaid += lot.actualInterestPaid;
      if (lot.remainingPrincipal > 0.0 || lot.accruedInterest > 0.0) {
        activeLots.push({
          lotId: lot.id,
          openedAt: lot.openedAt,
          annualRate: lot.annualRate,
          originalPrincipal: lot.originalPrincipal,
          remainingPrincipal: lot.remainingPrincipal,
          accruedInterest: lot.accruedInterest,
        });
      }
    }

    return {
      outstandingPrincipal,
      accruedInterest,
      lots: activeLots,
      selfFundedCapital: this.selfFundedCapital,
      cashBalance: this.cashBalance,
      actualInterestPaid,
      totalInterestExpense: accruedInterest + actualInterestPaid,
    };
  }
}

export class MarginHistoricalXirrTimeline {
  private readonly orderedTransactions: StockTransaction[];
  private readonly currencyRate: number;
  private readonly transactionDateMapper: (date: number) => number;
  private readonly includeDividendIncome: boolean;
  private readonly cashFlows: CashFlow[] = [];
  private nextIndex = 0;
  private lastValuationDate = -Infinity;

  constructor(
    transactions: readonly StockTransaction[],
    currencyRate: number = 1.0,
    transactionDateMapper: (date: number) => number = (d) => d,
    transactionsAreOrdered: boolean = false,
    includeDividendIncome: boolean = true
  ) {
    this.orderedTransactions = transactionsAreOrdered
      ? transactions.slice()
      : transactions.slice().sort(compareTransactions);
    this.currencyRate = currencyRate;
    this.transactionDateMapper = transactionDateMapper;
    this.includeDividendIncome = includeDividendIncome;
  }

  cashFlowsAt(
    valuationDate: number,
    terminalMarketValue: number,
    marginSummary: MarginSummary,
    terminalDate: number = valuationDate
  ): CashFlow[] {
    if (valuationDate < this.lastValuationDate) {
      throw new Error("歷史 XIRR 現金流日期必須遞增");
    }
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      const tx = this.orderedTransactions[this.nextIndex];
      const flow = this.toCashFlow(tx);
      if (flow !== null) {
        this.cashFlows.push(flow);
      }
      this.nextIndex++;
    }
    this.lastValuationDate = valuationDate;

    const result = this.cashFlows.slice();
    const terminalNet =
      (terminalMarketValue -
        marginSummary.outstandingPrincipal -
        marginSummary.accruedInterest) *
      this.currencyRate;
    if (Math.abs(terminalNet) > 1e-10) {
      result.push({ dateMillis: terminalDate, amount: terminalNet });
    }
    return result;
  }

  private toCashFlow(tx: StockTransaction): CashFlow | null {
    let amount: number;
    switch (tx.type) {
      case TransactionType.BUY:
        amount = -tx.expense * this.currencyRate;
        break;
      case TransactionType.MARGIN_BUY:
        amount =
          -(tx.marginSelfFundedOverridden
            ? tx.marginSelfFunded
            : tx.expense - tx.marginPrincipal) * this.currencyRate;
        break;
      case TransactionType.SELL:
        amount =
          (tx.income - tx.marginRepayment - tx.marginActualInterest) * this.currencyRate;
        break;
      case TransactionType.MARGIN_REPAYMENT:
        amount = -(tx.marginRepayment + tx.marginActualInterest) * this.currencyRate;
        break;
      case TransactionType.CASH_DIVIDEND:
        if (!this.includeDividendIncome) return null;
        amount = resolveDividendIncomeLocal(tx) * this.currencyRate;
        break;
      case TransactionType.CAPITAL_REDUCTION:
        amount = tx.cashReturned * this.currencyRate;
        break;
      default:
        return null;
    }
    return {
      dateMillis: this.transactionDateMapper(tx.date),
      amount,
    };
  }
}

export function calculateMarginSummary(
  transactions: readonly StockTransaction[],
  valuationDate: number,
  dayCount: number = 365,
  transactionsAreOrdered: boolean = false,
  timeZone: string = getSystemTimeZone()
): MarginSummary {
  return new MarginHistoricalTimeline(
    transactions,
    dayCount,
    transactionsAreOrdered,
    timeZone
  ).advanceTo(valuationDate);
}

export function hasValidRepaymentBalances(
  transactions: readonly StockTransaction[]
): boolean {
  const remainingByLot = new Map<string, number>();
  const ordered = transactions.slice().sort(compareTransactions);

  for (const tx of ordered) {
    if (tx.type === TransactionType.MARGIN_BUY) {
      const lotId = tx.marginLotId.trim() ? tx.marginLotId : `legacy-${tx.id}`;
      remainingByLot.set(lotScopeKey(tx, lotId), Math.max(0.0, tx.marginPrincipal));
    }

    const hasMarginPayment = tx.marginRepayment > 0.0 || tx.marginActualInterest > 0.0;
    if (hasMarginPayment) {
      const key = lotScopeKey(tx, tx.marginRepaymentLotId);
      const remaining = remainingByLot.get(key);
      if (remaining === undefined) return false;
      if (tx.marginRepayment > remaining + BALANCE_EPSILON) return false;
      if (tx.marginRepayment > 0.0) {
        remainingByLot.set(key, Math.max(0.0, remaining - tx.marginRepayment));
      }
    }
  }
  return true;
}

export interface LotCandidateScope {
  id: number;
  date: number;
  recordTime: number;
  accountId: number;
  stockCode: string;
  market: string;
}

export function isStrictlyBeforeCandidate(
  tx: Pick<StockTransaction, "id" | "date" | "recordTime">,
  candidate: Pick<LotCandidateScope, "id" | "date" | "recordTime">
): boolean {
  if (tx.date !== candidate.date) return tx.date < candidate.date;
  if (tx.recordTime !== candidate.recordTime) return tx.recordTime < candidate.recordTime;
  if (candidate.id <= 0) return true;
  return tx.id < candidate.id;
}

export function getAvailableMarginLots(
  transactions: readonly StockTransaction[],
  candidate: LotCandidateScope,
  dayCount: number = 365,
  timeZone: string = getSystemTimeZone()
): MarginLotOption[] {
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
  const summary = calculateMarginSummary(prior, candidate.date, dayCount, false, timeZone);
  return summary.lots
    .filter((lot) => lot.remainingPrincipal > BALANCE_EPSILON)
    .map((lot) => ({
      lotId: lot.lotId,
      label: `${lot.lotId}（未償 ${Math.round(lot.remainingPrincipal).toLocaleString("en-US")}）`,
      remainingPrincipal: lot.remainingPrincipal,
    }));
}
