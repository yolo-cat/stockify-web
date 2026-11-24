import {
  HistoryRange,
  HomeDisplayMode,
  ReturnRateMode,
  TransactionType,
  type AccountFeeSettings,
  type CashFlow,
  type DailyPerformance,
  type LongPositionReplaySummary,
  type MonthlyPerformance,
  type PersonalHistoryPoint,
  type Stock,
  type StockHistoryPoint,
  type StockTransaction,
} from "@/types";
import {
  capitalReductionShareChange,
  compareTransactions,
  performanceCostBasis,
  performanceMarginCashBalance,
  POSITION_EPSILON,
  positionInvestmentBasis,
  resolveDividendIncome,
  splitShareChange,
  splitShareFactor,
} from "./holdings";
import {
  MarginHistoricalTimeline,
} from "./margin";
import {
  calculateTaiwanFee,
  calculateTaiwanTax,
  DEFAULT_TAIWAN_TAX_RATES,
  isUsMarket,
  resolveAccountFeeSettingsById,
  stockCacheKey,
  type TaiwanTaxRates,
} from "./market";
import {
  ShortSellingHistoricalTimeline,
  ShortSellingHistoricalXirrTimeline,
} from "./shortSelling";
import { calculateXirrPercentage } from "./xirr";

export const TAIWAN_TIME_ZONE = "Asia/Taipei";
export const US_TIME_ZONE = "America/New_York";
export const COMBINED_XIRR_TIME_ZONE = "UTC";

export function zoneIdForMarket(market: string): string {
  return isUsMarket(market) ? US_TIME_ZONE : TAIWAN_TIME_ZONE;
}

export function zoneIdForHomeXirr(displayMode: HomeDisplayMode | string): string {
  switch (displayMode) {
    case HomeDisplayMode.TW:
      return TAIWAN_TIME_ZONE;
    case HomeDisplayMode.US:
      return US_TIME_ZONE;
    default:
      return COMBINED_XIRR_TIME_ZONE;
  }
}

export function parseStrictIsoDate(
  dateStr: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function getZonedDateTimeParts(
  epochMillis: number,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
} {
  const d = new Date(epochMillis);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);

  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let weekdayStr = "Thu";

  for (const p of parts) {
    switch (p.type) {
      case "year":
        year = Number(p.value);
        break;
      case "month":
        month = Number(p.value);
        break;
      case "day":
        day = Number(p.value);
        break;
      case "hour":
        hour = Number(p.value) % 24;
        break;
      case "minute":
        minute = Number(p.value);
        break;
      case "second":
        second = Number(p.value);
        break;
      case "weekday":
        weekdayStr = p.value;
        break;
    }
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: weekdayMap[weekdayStr] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function zonedDateTimeToEpochMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let candidate = utcGuess;
  for (let i = 0; i < 2; i++) {
    const p = getZonedDateTimeParts(candidate, timeZone);
    const observedUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
      ms
    );
    const diff = observedUtc - utcGuess;
    candidate -= diff;
    if (diff === 0) break;
  }
  return candidate;
}

export function valuationDateEndMillis(
  date: string,
  market: string
): number | null {
  const parsed = parseStrictIsoDate(date);
  if (!parsed) return null;
  const isUs = isUsMarket(market);
  const tz = zoneIdForMarket(market);
  const closeHour = isUs ? 16 : 13;
  const closeMinute = isUs ? 0 : 30;
  return zonedDateTimeToEpochMillis(
    parsed.year,
    parsed.month,
    parsed.day,
    closeHour,
    closeMinute,
    0,
    0,
    tz
  );
}

function formatIsoDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveHistoryCutoffDate(
  nowMillis: number,
  market: string
): string {
  const isUs = isUsMarket(market);
  const tz = zoneIdForMarket(market);
  const parts = getZonedDateTimeParts(nowMillis, tz);
  const closeMinutes = isUs ? 16 * 60 : 13 * 60 + 30;
  const currentMinutes = parts.hour * 60 + parts.minute;

  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const isWeekend = parts.weekday === 0 || parts.weekday === 6;
  if (isWeekend || currentMinutes < closeMinutes) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return formatIsoDateUtc(cursor);
}

export function targetHistoryMonths(
  rangeMonths: number,
  anchorYearMonth: string
): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(anchorYearMonth);
  if (!match) return [];
  const baseYear = Number(match[1]);
  const baseMonth = Number(match[2]);
  const baseTotal = baseYear * 12 + (baseMonth - 1);
  const result: string[] = [];
  for (let offset = rangeMonths; offset >= 0; offset--) {
    const total = baseTotal - offset;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    result.push(`${y}${String(m).padStart(2, "0")}`);
  }
  return result;
}

export function filterEmptyHistorySeries(
  allRawPoints: Record<string, StockHistoryPoint[]>
): Record<string, StockHistoryPoint[]> {
  const result: Record<string, StockHistoryPoint[]> = {};
  for (const [key, points] of Object.entries(allRawPoints)) {
    if (points.length > 0) {
      result[key] = points;
    }
  }
  return result;
}

export function hasHistoryCoverage(
  points: readonly StockHistoryPoint[],
  rangeMonths: number
): boolean {
  if (rangeMonths <= 0) {
    return points.some((p) => Number.isFinite(p.price) && p.price > 0.0);
  }
  let earliest = Infinity;
  let latest = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.price) || p.price <= 0.0 || p.date.length < 7) continue;
    const year = Number(p.date.slice(0, 4));
    const month = Number(p.date.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      continue;
    }
    const idx = year * 12 + month;
    if (idx < earliest) earliest = idx;
    if (idx > latest) latest = idx;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return false;
  return latest - earliest >= rangeMonths;
}

export function hasHistoryForAllStocks(
  stockKeys: readonly string[],
  allRawPoints: Record<string, readonly StockHistoryPoint[]>,
  rangeMonths: number | null = null
): boolean {
  const unique = Array.from(new Set(stockKeys));
  return unique.every((key) => {
    const points = allRawPoints[key] ?? [];
    if (rangeMonths === null) {
      return points.some((p) => Number.isFinite(p.price) && p.price > 0.0);
    }
    return hasHistoryCoverage(points, rangeMonths);
  });
}

export function priceAtOrBefore(
  points: readonly StockHistoryPoint[],
  date: string
): number | null {
  let bestDate = "";
  let bestPrice: number | null = null;
  for (const p of points) {
    if (
      p.date <= date &&
      Number.isFinite(p.price) &&
      p.price > 0.0 &&
      p.date >= bestDate
    ) {
      bestDate = p.date;
      bestPrice = p.price;
    }
  }
  return bestPrice;
}

export function hasHistoryAtOrBeforeForStocks(
  date: string,
  stockKeys: readonly string[],
  allRawPoints: Record<string, readonly StockHistoryPoint[]>
): boolean {
  return stockKeys.every(
    (key) => priceAtOrBefore(allRawPoints[key] ?? [], date) !== null
  );
}

interface AccountLongState {
  shares: number;
  buySharesTotal: number;
  sellSharesTotal: number;
}

export class HistoricalLongPositionTimeline {
  private readonly orderedTransactions: StockTransaction[];
  private nextIndex = 0;
  private readonly positions = new Map<number, AccountLongState>();
  private totalBuyExpense = 0.0;
  private totalSellIncome = 0.0;
  private totalSellNetIncome = 0.0;
  private sellAmountBeforeFee = 0.0;
  private totalDividendIncome = 0.0;
  private buyCostTotal = 0.0;

  shortIncome = 0.0;
  shortCoverExpense = 0.0;
  hasMarginPurchase = false;
  readonly hasMarginActivity: boolean;
  readonly hasShortActivity: boolean;

  constructor(
    transactions: readonly StockTransaction[],
    transactionsAreOrdered: boolean = false
  ) {
    this.orderedTransactions = transactionsAreOrdered
      ? transactions.slice()
      : transactions.slice().sort(compareTransactions);

    this.hasMarginActivity = this.orderedTransactions.some(
      (tx) =>
        tx.type === TransactionType.MARGIN_BUY ||
        tx.marginRepaymentLotId.trim().length > 0 ||
        tx.marginRepayment > 0.0 ||
        tx.marginActualInterest > 0.0
    );
    this.hasShortActivity = this.orderedTransactions.some(
      (tx) =>
        tx.type === TransactionType.SHORT_SELL ||
        tx.type === TransactionType.SHORT_COVER ||
        tx.type === TransactionType.SHORT_COMPENSATION
    );
  }

  advanceTo(valuationDate: number): LongPositionReplaySummary {
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      this.apply(this.orderedTransactions[this.nextIndex]);
      this.nextIndex++;
    }

    let shares = 0.0;
    let buySharesTotal = 0.0;
    let sellSharesTotal = 0.0;
    for (const pos of this.positions.values()) {
      shares += pos.shares;
      buySharesTotal += pos.buySharesTotal;
      sellSharesTotal += pos.sellSharesTotal;
    }

    return {
      shares: Math.max(0.0, shares),
      totalBuyExpense: this.totalBuyExpense,
      totalSellIncome: this.totalSellIncome,
      totalSellNetIncome: this.totalSellNetIncome,
      sellSharesTotal,
      sellAmountBeforeFee: this.sellAmountBeforeFee,
      totalDividendIncome: this.totalDividendIncome,
      buySharesTotal,
      buyCostTotal: this.buyCostTotal,
    };
  }

  transactionsAtCurrentDate(): StockTransaction[] {
    return this.orderedTransactions.slice(0, this.nextIndex);
  }

  accountSharesMap(): Map<number, number> {
    const result = new Map<number, number>();
    for (const [acctId, pos] of this.positions.entries()) {
      result.set(acctId, pos.shares);
    }
    return result;
  }

  private apply(tx: StockTransaction): void {
    let pos = this.positions.get(tx.accountId);
    if (!pos) {
      pos = { shares: 0.0, buySharesTotal: 0.0, sellSharesTotal: 0.0 };
      this.positions.set(tx.accountId, pos);
    }
    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.MARGIN_BUY:
        pos.shares += tx.buyShares;
        pos.buySharesTotal += tx.buyShares;
        this.totalBuyExpense += tx.expense;
        this.buyCostTotal += tx.expense;
        if (tx.type === TransactionType.MARGIN_BUY) {
          this.hasMarginPurchase = true;
        }
        break;
      case TransactionType.SELL:
        pos.shares -= tx.sellShares;
        pos.sellSharesTotal += tx.sellShares;
        this.sellAmountBeforeFee += tx.sellPrice * tx.sellShares;
        this.totalSellIncome += tx.income;
        this.totalSellNetIncome += tx.income;
        break;
      case TransactionType.STOCK_DIVIDEND:
        pos.shares += tx.dividendShares;
        break;
      case TransactionType.CASH_DIVIDEND:
        this.totalDividendIncome += resolveDividendIncome(tx);
        break;
      case TransactionType.CAPITAL_REDUCTION:
        pos.shares += capitalReductionShareChange(tx, pos.shares);
        this.totalSellIncome += tx.cashReturned;
        break;
      case TransactionType.STOCK_SPLIT: {
        pos.shares += splitShareChange(tx, pos.shares);
        const factor = splitShareFactor(tx);
        pos.buySharesTotal *= factor;
        pos.sellSharesTotal *= factor;
        break;
      }
      case TransactionType.SHORT_SELL:
        this.shortIncome += tx.income;
        break;
      case TransactionType.SHORT_COVER:
        this.shortCoverExpense += tx.expense;
        break;
    }
  }
}

export class HistoricalTransactionCashFlowTimeline {
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

  cashFlowsAt(valuationDate: number): CashFlow[] {
    if (valuationDate < this.lastValuationDate) {
      throw new Error("歷史 XIRR 現金流日期必須遞增");
    }
    while (
      this.nextIndex < this.orderedTransactions.length &&
      this.orderedTransactions[this.nextIndex].date <= valuationDate
    ) {
      const cf = this.transactionCashFlow(this.orderedTransactions[this.nextIndex]);
      if (cf !== null) {
        this.cashFlows.push(cf);
      }
      this.nextIndex++;
    }
    this.lastValuationDate = valuationDate;
    return this.cashFlows.slice();
  }

  private transactionCashFlow(tx: StockTransaction): CashFlow | null {
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
        amount = resolveDividendIncome(tx) * this.currencyRate;
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

export function rangeToMonths(range: HistoryRange | string): number {
  switch (range) {
    case HistoryRange.ONE_MONTH:
      return 1;
    case HistoryRange.SIX_MONTHS:
      return 6;
    case HistoryRange.ONE_YEAR:
    default:
      return 12;
  }
}

export interface StockHistorySeriesInput {
  stock: Stock;
  transactions: readonly StockTransaction[];
  historyPoints: readonly StockHistoryPoint[];
  returnRateMode: ReturnRateMode | string;
  preDeductSellFees: boolean;
  feeSettingsByAccount: Record<number, AccountFeeSettings>;
  sharedFeeSettings: AccountFeeSettings;
  marginDayCount: number;
  excludeDividendIncomeFromReturns?: boolean;
  taxRates?: TaiwanTaxRates;
  cutoffDate?: string;
}

export function buildStockHistorySeries(
  input: StockHistorySeriesInput
): PersonalHistoryPoint[] {
  const orderedTxs = input.transactions.slice().sort(compareTransactions);
  if (orderedTxs.length === 0) return [];

  const firstTxDate = orderedTxs[0].date;
  const tz = zoneIdForMarket(input.stock.market);
  const isUs = isUsMarket(input.stock.market);
  const taxRates = input.taxRates ?? DEFAULT_TAIWAN_TAX_RATES;
  const excludeDiv = input.excludeDividendIncomeFromReturns ?? false;

  const sortedPrices = input.historyPoints
    .filter((p) => Number.isFinite(p.price) && p.price > 0.0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const longTimeline = new HistoricalLongPositionTimeline(orderedTxs, true);
  const marginTimeline = new MarginHistoricalTimeline(
    orderedTxs,
    input.marginDayCount,
    true,
    tz
  );
  const shortTimeline = new ShortSellingHistoricalTimeline(
    orderedTxs,
    input.marginDayCount,
    true,
    tz
  );
  const cashFlowTimeline = new HistoricalTransactionCashFlowTimeline(
    orderedTxs,
    1.0,
    (d) => d,
    true,
    !excludeDiv
  );
  const shortXirrTimeline = new ShortSellingHistoricalXirrTimeline(
    orderedTxs,
    (d) => d,
    true
  );

  let previousXirrGuess = 0.1;
  const result: PersonalHistoryPoint[] = [];

  for (const pt of sortedPrices) {
    if (input.cutoffDate && pt.date > input.cutoffDate) break;
    const endMillis = valuationDateEndMillis(pt.date, input.stock.market);
    if (endMillis === null || endMillis < firstTxDate) continue;

    const longSummary = longTimeline.advanceTo(endMillis);
    const marginSummary = marginTimeline.advanceTo(endMillis);
    const shortSummary = shortTimeline.advanceTo(endMillis);

    const shares = longSummary.shares;
    const marketValue = shares * pt.price;
    const shortLiability = shortSummary.outstandingShares * pt.price;
    const costBasis = performanceCostBasis(
      longSummary.totalBuyExpense,
      longSummary.totalSellIncome,
      longSummary.totalDividendIncome,
      excludeDiv
    );

    let exitCost = 0.0;
    if (input.preDeductSellFees && marketValue > 0.0 && !isUs) {
      for (const [acctId, acctShares] of longTimeline.accountSharesMap().entries()) {
        if (acctShares > POSITION_EPSILON) {
          const feeSettings = resolveAccountFeeSettingsById(
            acctId,
            input.feeSettingsByAccount,
            input.sharedFeeSettings
          );
          exitCost += calculateTaiwanFee(
            pt.price,
            acctShares,
            feeSettings.feeDiscount,
            feeSettings.minFeeRegular,
            feeSettings.minFeeOddLot
          );
          exitCost += calculateTaiwanTax(
            pt.price,
            acctShares,
            input.stock.stockType,
            false,
            taxRates
          );
        }
      }
    }

    const longPL = marketValue - costBasis - marginSummary.totalInterestExpense;
    const shortPL =
      longTimeline.shortIncome -
      longTimeline.shortCoverExpense -
      shortLiability -
      shortSummary.accruedBorrowFee -
      shortSummary.compensationExpense;
    const totalPL = longPL + shortPL - exitCost;

    const longInvestment = longTimeline.hasMarginPurchase
      ? marginSummary.selfFundedCapital
      : longSummary.totalBuyExpense;
    const financedRemaining = longTimeline.hasMarginPurchase
      ? Math.max(
          0.0,
          -performanceMarginCashBalance(
            marginSummary.cashBalance,
            longSummary.totalDividendIncome,
            excludeDiv
          )
        )
      : null;
    const basis = positionInvestmentBasis({
      shares,
      costBasis,
      longInvestment,
      financedRemainingInvestment: financedRemaining,
      marginDebt: marginSummary.outstandingPrincipal + marginSummary.accruedInterest,
      shortOutstandingShares: shortSummary.outstandingShares,
      shortRemainingInvestment: shortSummary.openedPrincipal,
      shortCumulativeInvestment: shortSummary.cumulativeOpenedPrincipal,
    });

    let totalPLPercentage = 0.0;
    if (input.returnRateMode === ReturnRateMode.XIRR) {
      const flows: CashFlow[] = [...cashFlowTimeline.cashFlowsAt(endMillis)];
      const terminalLong =
        marketValue - marginSummary.outstandingPrincipal - marginSummary.accruedInterest;
      if (Math.abs(terminalLong) > 1e-10) {
        flows.push({ dateMillis: endMillis, amount: terminalLong });
      }
      if (longTimeline.hasShortActivity) {
        flows.push(
          ...shortXirrTimeline.cashFlowsAt(endMillis, pt.price, shortSummary, endMillis)
        );
      }
      const xirr = calculateXirrPercentage(flows, previousXirrGuess, tz);
      if (xirr !== null && Number.isFinite(xirr)) {
        previousXirrGuess = xirr / 100.0;
        totalPLPercentage = xirr;
      }
    } else if (input.returnRateMode === ReturnRateMode.CUMULATIVE_INVESTMENT) {
      totalPLPercentage =
        basis.cumulative > POSITION_EPSILON ? (totalPL / basis.cumulative) * 100.0 : 0.0;
    } else {
      const denom =
        basis.remaining > POSITION_EPSILON ? basis.remaining : basis.cumulative;
      totalPLPercentage = denom > POSITION_EPSILON ? (totalPL / denom) * 100.0 : 0.0;
    }

    result.push({
      date: pt.date,
      price: pt.price,
      shares,
      marketValue,
      totalPL,
      totalPLPercentage,
    });
  }

  return result;
}

export interface PortfolioHistorySeriesInput {
  stocks: readonly Stock[];
  transactionsByStockKey: Record<string, readonly StockTransaction[]>;
  historyByStockKey: Record<string, readonly StockHistoryPoint[]>;
  displayMode: HomeDisplayMode | string;
  usdToTwdRate: number;
  returnRateMode: ReturnRateMode | string;
  preDeductSellFees: boolean;
  feeSettingsByAccount: Record<number, AccountFeeSettings>;
  sharedFeeSettings: AccountFeeSettings;
  marginDayCount: number;
  excludeDividendIncomeFromReturns?: boolean;
  taxRates?: TaiwanTaxRates;
  cutoffDate?: string;
}

export function buildPortfolioHistorySeries(
  input: PortfolioHistorySeriesInput
): PersonalHistoryPoint[] {
  const effectiveFx =
    Number.isFinite(input.usdToTwdRate) && input.usdToTwdRate > 0.0
      ? input.usdToTwdRate
      : 1.0;
  const taxRates = input.taxRates ?? DEFAULT_TAIWAN_TAX_RATES;
  const excludeDiv = input.excludeDividendIncomeFromReturns ?? false;
  const homeTz = zoneIdForHomeXirr(input.displayMode);

  const scopedStocks = input.stocks.filter((s) => {
    if (input.displayMode === HomeDisplayMode.TW) return !isUsMarket(s.market);
    if (input.displayMode === HomeDisplayMode.US) return isUsMarket(s.market);
    return true;
  });

  const activeEntries = scopedStocks
    .map((stock) => {
      const key = stockCacheKey(stock.market, stock.code);
      const txs = (input.transactionsByStockKey[key] ?? [])
        .slice()
        .sort(compareTransactions);
      return {
        key,
        stock,
        txs,
        firstTxDate: txs.length > 0 ? txs[0].date : Infinity,
        longTimeline: new HistoricalLongPositionTimeline(txs, true),
        marginTimeline: new MarginHistoricalTimeline(
          txs,
          input.marginDayCount,
          true,
          zoneIdForMarket(stock.market)
        ),
        shortTimeline: new ShortSellingHistoricalTimeline(
          txs,
          input.marginDayCount,
          true,
          zoneIdForMarket(stock.market)
        ),
        cashFlowTimeline: new HistoricalTransactionCashFlowTimeline(
          txs,
          input.displayMode === HomeDisplayMode.COMBINED && isUsMarket(stock.market)
            ? effectiveFx
            : 1.0,
          (d) => d,
          true,
          !excludeDiv
        ),
        shortXirrTimeline: new ShortSellingHistoricalXirrTimeline(txs, (d) => d, true),
      };
    })
    .filter((e) => e.txs.length > 0);

  if (activeEntries.length === 0) return [];

  const allDatesSet = new Set<string>();
  for (const entry of activeEntries) {
    for (const p of input.historyByStockKey[entry.key] ?? []) {
      if (Number.isFinite(p.price) && p.price > 0.0) {
        if (!input.cutoffDate || p.date <= input.cutoffDate) {
          allDatesSet.add(p.date);
        }
      }
    }
  }
  const allDates = Array.from(allDatesSet).sort();
  if (allDates.length === 0) return [];

  let previousXirrGuess = 0.1;
  const result: PersonalHistoryPoint[] = [];

  for (const date of allDates) {
    const activeAtDate = activeEntries.filter((e) => {
      const endMs = valuationDateEndMillis(date, e.stock.market);
      return endMs !== null && endMs >= e.firstTxDate;
    });
    if (activeAtDate.length === 0) continue;

    if (
      !hasHistoryAtOrBeforeForStocks(
        date,
        activeAtDate.map((e) => e.key),
        input.historyByStockKey
      )
    ) {
      continue;
    }

    let totalMarketValue = 0.0;
    let totalPL = 0.0;
    let totalRemainingInv = 0.0;
    let totalCumulativeInv = 0.0;
    const allFlows: CashFlow[] = [];

    for (const entry of activeAtDate) {
      const ptPrice = priceAtOrBefore(input.historyByStockKey[entry.key] ?? [], date);
      if (ptPrice === null) continue;
      const endMs = valuationDateEndMillis(date, entry.stock.market)!;
      const isUs = isUsMarket(entry.stock.market);
      const rate =
        input.displayMode === HomeDisplayMode.COMBINED && isUs ? effectiveFx : 1.0;

      const longSummary = entry.longTimeline.advanceTo(endMs);
      const marginSummary = entry.marginTimeline.advanceTo(endMs);
      const shortSummary = entry.shortTimeline.advanceTo(endMs);

      const shares = longSummary.shares;
      const mv = shares * ptPrice;
      const shortLiability = shortSummary.outstandingShares * ptPrice;
      const costBasis = performanceCostBasis(
        longSummary.totalBuyExpense,
        longSummary.totalSellIncome,
        longSummary.totalDividendIncome,
        excludeDiv
      );

      let exitCost = 0.0;
      if (input.preDeductSellFees && mv > 0.0 && !isUs) {
        for (const [acctId, acctShares] of entry.longTimeline
          .accountSharesMap()
          .entries()) {
          if (acctShares > POSITION_EPSILON) {
            const feeSettings = resolveAccountFeeSettingsById(
              acctId,
              input.feeSettingsByAccount,
              input.sharedFeeSettings
            );
            exitCost += calculateTaiwanFee(
              ptPrice,
              acctShares,
              feeSettings.feeDiscount,
              feeSettings.minFeeRegular,
              feeSettings.minFeeOddLot
            );
            exitCost += calculateTaiwanTax(
              ptPrice,
              acctShares,
              entry.stock.stockType,
              false,
              taxRates
            );
          }
        }
      }

      const longPL = mv - costBasis - marginSummary.totalInterestExpense;
      const shortPL =
        entry.longTimeline.shortIncome -
        entry.longTimeline.shortCoverExpense -
        shortLiability -
        shortSummary.accruedBorrowFee -
        shortSummary.compensationExpense;

      totalMarketValue += mv * rate;
      totalPL += (longPL + shortPL - exitCost) * rate;

      const longInv = entry.longTimeline.hasMarginPurchase
        ? marginSummary.selfFundedCapital
        : longSummary.totalBuyExpense;
      const financedRem = entry.longTimeline.hasMarginPurchase
        ? Math.max(
            0.0,
            -performanceMarginCashBalance(
              marginSummary.cashBalance,
              longSummary.totalDividendIncome,
              excludeDiv
            )
          )
        : null;
      const basis = positionInvestmentBasis({
        shares,
        costBasis,
        longInvestment: longInv,
        financedRemainingInvestment: financedRem,
        marginDebt: marginSummary.outstandingPrincipal + marginSummary.accruedInterest,
        shortOutstandingShares: shortSummary.outstandingShares,
        shortRemainingInvestment: shortSummary.openedPrincipal,
        shortCumulativeInvestment: shortSummary.cumulativeOpenedPrincipal,
      });
      totalRemainingInv += basis.remaining * rate;
      totalCumulativeInv += basis.cumulative * rate;

      if (input.returnRateMode === ReturnRateMode.XIRR) {
        allFlows.push(...entry.cashFlowTimeline.cashFlowsAt(endMs));
        const terminalLong =
          (mv - marginSummary.outstandingPrincipal - marginSummary.accruedInterest) * rate;
        if (Math.abs(terminalLong) > 1e-10) {
          allFlows.push({ dateMillis: endMs, amount: terminalLong });
        }
        if (entry.longTimeline.hasShortActivity) {
          const shortFlows = entry.shortXirrTimeline.cashFlowsAt(
            endMs,
            ptPrice,
            shortSummary,
            endMs
          );
          for (const sf of shortFlows) {
            allFlows.push({
              dateMillis: sf.dateMillis,
              amount: sf.amount * rate,
            });
          }
        }
      }
    }

    let totalPLPercentage = 0.0;
    if (input.returnRateMode === ReturnRateMode.XIRR) {
      const xirr = calculateXirrPercentage(allFlows, previousXirrGuess, homeTz);
      if (xirr !== null && Number.isFinite(xirr)) {
        previousXirrGuess = xirr / 100.0;
        totalPLPercentage = xirr;
      }
    } else if (input.returnRateMode === ReturnRateMode.CUMULATIVE_INVESTMENT) {
      totalPLPercentage =
        totalCumulativeInv > POSITION_EPSILON
          ? (totalPL / totalCumulativeInv) * 100.0
          : 0.0;
    } else {
      const denom =
        totalRemainingInv > POSITION_EPSILON ? totalRemainingInv : totalCumulativeInv;
      totalPLPercentage = denom > POSITION_EPSILON ? (totalPL / denom) * 100.0 : 0.0;
    }

    result.push({
      date,
      price: 0.0,
      shares: 0.0,
      marketValue: totalMarketValue,
      totalPL,
      totalPLPercentage,
    });
  }

  return result;
}

function finiteOrZero(val: number): number {
  return Number.isFinite(val) ? val : 0.0;
}

export function compoundReturns(returnPercentages: Iterable<number>): number {
  let factor = 1.0;
  for (const pct of returnPercentages) {
    if (Number.isFinite(pct)) {
      factor *= 1.0 + pct / 100.0;
    }
  }
  return finiteOrZero((factor - 1.0) * 100.0);
}

export function calculateDailyPerformance(
  points: readonly PersonalHistoryPoint[]
): DailyPerformance[] {
  const ordered = points
    .filter((p) => p.date.length >= 10)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const result: DailyPerformance[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const today = ordered[i];
    const previousBase =
      Number.isFinite(previous.marketValue) && previous.marketValue > 0.0
        ? previous.marketValue
        : 0.0;
    const pl = finiteOrZero(today.totalPL - previous.totalPL);
    const pct =
      previousBase > 0.0 ? finiteOrZero((pl / previousBase) * 100.0) : 0.0;

    result.push({
      date: today.date,
      profitLoss: pl,
      returnPercentage: pct,
      portfolioValue: finiteOrZero(today.marketValue),
      previousPortfolioValue: previousBase,
      externalCashFlow: 0.0,
    });
  }
  return result;
}

export function calculateMonthlyPerformance(
  points: readonly PersonalHistoryPoint[],
  yearMonth: string
): MonthlyPerformance | null {
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!ymMatch) return null;
  const monthNum = Number(ymMatch[2]);
  if (monthNum < 1 || monthNum > 12) return null;
  const normalizedMonth = `${ymMatch[1]}-${ymMatch[2]}`;

  const ordered = points
    .filter((p) => p.date.length >= 10)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const prefix = `${normalizedMonth}-`;
  const firstIndex = ordered.findIndex((p) => p.date.startsWith(prefix));
  if (firstIndex < 0) return null;

  let lastIndex = firstIndex;
  for (let i = ordered.length - 1; i >= firstIndex; i--) {
    if (ordered[i].date.startsWith(prefix)) {
      lastIndex = i;
      break;
    }
  }

  const previous = firstIndex > 0 ? ordered[firstIndex - 1] : null;
  const first = ordered[firstIndex];
  const last = ordered[lastIndex];
  const dailyItems = calculateDailyPerformance(ordered).filter((d) =>
    d.date.startsWith(prefix)
  );

  return {
    yearMonth: normalizedMonth,
    profitLoss: finiteOrZero(last.totalPL - (previous ? previous.totalPL : first.totalPL)),
    returnPercentage: compoundReturns(dailyItems.map((d) => d.returnPercentage)),
    dailyItems,
  };
}

export function calculatePerformanceCalendar(
  points: readonly PersonalHistoryPoint[]
): {
  daily: DailyPerformance[];
  monthly: MonthlyPerformance[];
} {
  const daily = calculateDailyPerformance(points);
  const months = Array.from(
    new Set(
      points
        .filter((p) => p.date.length >= 7)
        .map((p) => p.date.slice(0, 7))
    )
  ).sort();
  const monthly: MonthlyPerformance[] = [];
  for (const ym of months) {
    const m = calculateMonthlyPerformance(points, ym);
    if (m) monthly.push(m);
  }
  return { daily, monthly };
}
