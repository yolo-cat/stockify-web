import {
  HomeDisplayMode,
  HomeHoldingsSortColumn,
  HomeHoldingsSortMode,
  ReturnRateMode,
  StockMarket,
  TransactionType,
  type AccountFeeSettings,
  type AssetOverviewUiState,
  type AssetStockValue,
  type BankDeposit,
  type CashFlow,
  type HoldingCalculationInputs,
  type HoldingInfo,
  type HoldingsUiState,
  type Loan,
  type LongPositionReplaySummary,
  type MarginSummary,
  type PositionInvestmentBasis,
  type ProfitLossBreakdown,
  type StockTransaction,
  type TransactionDateCashFlowTotal,
  type TransactionDateSection,
  type TransactionsUiState,
  type TransactionUiState,
  type TransactionWithStock,
} from "@/types";
import {
  calculateMarginSummary,
  MarginHistoricalXirrTimeline,
} from "./margin";
import {
  calculateTaiwanFee,
  calculateTaiwanTax,
  canonicalStockCode,
  DEFAULT_TAIWAN_TAX_RATES,
  isTwMarket,
  isUsMarket,
  normalizeMarket,
  resolveAccountFeeSettingsById,
  stockCacheKey,
  type TaiwanTaxRates,
} from "./market";
import {
  calculateShortSellingSummary,
  capitalReductionShareFactorInternal,
  ShortSellingHistoricalXirrTimeline,
  splitShareFactorInternal,
} from "./shortSelling";
import {
  calculateXirrPercentage,
  calendarDaysBetween,
  getSystemTimeZone,
} from "./xirr";

export const POSITION_EPSILON = 1e-6;

export function compareTransactions(a: StockTransaction, b: StockTransaction): number {
  if (a.date !== b.date) return a.date - b.date;
  if (a.recordTime !== b.recordTime) return a.recordTime - b.recordTime;
  return a.id - b.id;
}

export function transactionsAtOrBefore(
  transactions: readonly StockTransaction[],
  valuationDate: number
): StockTransaction[] {
  return transactions
    .filter((tx) => tx.date <= valuationDate)
    .slice()
    .sort(compareTransactions);
}

export function resolveDividendIncome(tx: StockTransaction): number {
  return tx.dividendIncome !== 0.0 || tx.income === 0.0
    ? tx.dividendIncome
    : tx.income;
}

export function splitShareChange(tx: StockTransaction, currentShares: number): number {
  const sharesBefore = tx.sharesBeforeSplit > 0.0 ? tx.sharesBeforeSplit : currentShares;
  const ratio = tx.stockSplitRatio > 0.0 ? tx.stockSplitRatio : 1.0;
  const sharesAfter =
    tx.sharesAfterSplit > 0.0 ? tx.sharesAfterSplit : sharesBefore * ratio;
  return sharesAfter - sharesBefore;
}

export function splitShareFactor(tx: StockTransaction): number {
  return splitShareFactorInternal(tx);
}

export function capitalReductionShareChange(
  tx: StockTransaction,
  currentShares: number
): number {
  const sharesBefore =
    tx.sharesBeforeReduction > 0.0 ? tx.sharesBeforeReduction : currentShares;
  const sharesAfter =
    tx.sharesAfterReduction > 0.0
      ? tx.sharesAfterReduction
      : sharesBefore * (1.0 - tx.capitalReductionRatio / 100.0);
  return sharesAfter - sharesBefore;
}

export function capitalReductionShareFactor(tx: StockTransaction): number {
  return capitalReductionShareFactorInternal(tx);
}

function positionScopeKey(tx: Pick<StockTransaction, "market" | "stockCode" | "accountId">): string {
  return `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}`;
}

interface AccountPositionState {
  accountId: number;
  shares: number;
  buySharesTotal: number;
  sellSharesTotal: number;
}

export function replayLongPosition(
  transactions: readonly StockTransaction[],
  valuationDate: number,
  transactionsAreOrdered: boolean = false
): LongPositionReplaySummary {
  const positions = new Map<string, AccountPositionState>();
  let totalBuyExpense = 0.0;
  let totalSellIncome = 0.0;
  let totalSellNetIncome = 0.0;
  let sellAmountBeforeFee = 0.0;
  let totalDividendIncome = 0.0;
  let buyCostTotal = 0.0;

  const ordered = transactionsAreOrdered
    ? transactions.filter((tx) => tx.date <= valuationDate)
    : transactionsAtOrBefore(transactions, valuationDate);

  for (const tx of ordered) {
    const key = positionScopeKey(tx);
    let pos = positions.get(key);
    if (!pos) {
      pos = { accountId: tx.accountId, shares: 0.0, buySharesTotal: 0.0, sellSharesTotal: 0.0 };
      positions.set(key, pos);
    }
    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.MARGIN_BUY:
        pos.shares += tx.buyShares;
        pos.buySharesTotal += tx.buyShares;
        totalBuyExpense += tx.expense;
        buyCostTotal += tx.expense;
        break;
      case TransactionType.SELL:
        pos.shares -= tx.sellShares;
        pos.sellSharesTotal += tx.sellShares;
        sellAmountBeforeFee += tx.sellPrice * tx.sellShares;
        totalSellIncome += tx.income;
        totalSellNetIncome += tx.income;
        break;
      case TransactionType.STOCK_DIVIDEND:
        pos.shares += tx.dividendShares;
        break;
      case TransactionType.CASH_DIVIDEND:
        totalDividendIncome += resolveDividendIncome(tx);
        break;
      case TransactionType.CAPITAL_REDUCTION:
        pos.shares += capitalReductionShareChange(tx, pos.shares);
        totalSellIncome += tx.cashReturned;
        break;
      case TransactionType.STOCK_SPLIT: {
        pos.shares += splitShareChange(tx, pos.shares);
        const factor = splitShareFactor(tx);
        pos.buySharesTotal *= factor;
        pos.sellSharesTotal *= factor;
        break;
      }
    }
  }

  let shares = 0.0;
  let sellSharesTotal = 0.0;
  let buySharesTotal = 0.0;
  for (const pos of positions.values()) {
    shares += pos.shares;
    sellSharesTotal += pos.sellSharesTotal;
    buySharesTotal += pos.buySharesTotal;
  }

  return {
    shares: Math.max(0.0, shares),
    totalBuyExpense,
    totalSellIncome,
    totalSellNetIncome,
    sellSharesTotal,
    sellAmountBeforeFee,
    totalDividendIncome,
    buySharesTotal,
    buyCostTotal,
  };
}

export function performanceCostBasis(
  totalBuyExpense: number,
  totalSellIncome: number,
  totalDividendIncome: number,
  excludeDividendIncome: boolean = false
): number {
  return (
    totalBuyExpense -
    totalSellIncome -
    (excludeDividendIncome ? 0.0 : totalDividendIncome)
  );
}

export function performanceMarginCashBalance(
  cashBalance: number,
  totalDividendIncome: number,
  excludeDividendIncome: boolean = false
): number {
  return cashBalance - (excludeDividendIncome ? totalDividendIncome : 0.0);
}

export function remainingPositionDenominator(
  shares: number,
  costBasis: number,
  totalInvestment: number
): number {
  return shares > 0.0 && costBasis > 0.0 ? costBasis : totalInvestment;
}

export function positionInvestmentBasis(params: {
  shares: number;
  costBasis: number;
  longInvestment: number;
  financedRemainingInvestment: number | null;
  marginDebt: number;
  shortOutstandingShares: number;
  shortRemainingInvestment: number;
  shortCumulativeInvestment: number;
}): PositionInvestmentBasis {
  const {
    shares,
    costBasis,
    longInvestment,
    financedRemainingInvestment,
    marginDebt,
    shortOutstandingShares,
    shortRemainingInvestment,
    shortCumulativeInvestment,
  } = params;

  const cumulative = longInvestment + shortCumulativeInvestment;
  const hasOpenPosition =
    shares > POSITION_EPSILON ||
    marginDebt > POSITION_EPSILON ||
    shortOutstandingShares > POSITION_EPSILON;

  if (!hasOpenPosition) {
    return { remaining: cumulative, cumulative };
  }

  let longRemaining = 0.0;
  if (
    financedRemainingInvestment !== null &&
    (shares > POSITION_EPSILON || marginDebt > POSITION_EPSILON)
  ) {
    longRemaining =
      financedRemainingInvestment > POSITION_EPSILON
        ? financedRemainingInvestment
        : longInvestment;
  } else if (shares > POSITION_EPSILON && costBasis > 0.0) {
    longRemaining = costBasis;
  } else if (shares > POSITION_EPSILON || marginDebt > POSITION_EPSILON) {
    longRemaining = longInvestment;
  }

  return {
    remaining: longRemaining + shortRemainingInvestment,
    cumulative,
  };
}

export function isOpenPosition(
  longShares: number,
  marginSummary: Pick<MarginSummary, "outstandingPrincipal" | "accruedInterest">,
  shortOutstandingShares: number
): boolean {
  return (
    longShares > POSITION_EPSILON ||
    marginSummary.outstandingPrincipal > POSITION_EPSILON ||
    marginSummary.accruedInterest > POSITION_EPSILON ||
    shortOutstandingShares > POSITION_EPSILON
  );
}

interface BreakdownLongState {
  shares: number;
  cost: number;
}

interface BreakdownShortLotState {
  market: StockMarket;
  stockCode: string;
  accountId: number;
  originalShares: number;
  remainingShares: number;
  originalPrincipal: number;
  openingIncome: number;
  openingGross: number;
  annualRate: number;
  accruedFee: number;
  lastAccrualDate: number;
}

export function calculateProfitLossBreakdown(
  transactions: readonly StockTransaction[],
  valuationDate: number,
  legacyTotalProfitLoss: number,
  marginSummary: MarginSummary,
  marginDayCount: number,
  includeDividendIncome: boolean = true,
  timeZone: string = getSystemTimeZone()
): ProfitLossBreakdown {
  const ordered = transactionsAtOrBefore(transactions, valuationDate);
  const longStates = new Map<string, BreakdownLongState>();
  const shortLots = new Map<string, BreakdownShortLotState>();
  const denominator = marginDayCount === 360 ? 360 : 365;

  let realizedProfitLoss = 0.0;
  let realizedCost = 0.0;
  let soldShares = 0.0;
  let coveredShortShares = 0.0;
  let realizedBuyAmount = 0.0;
  let realizedSellAmount = 0.0;
  let hasRealizedActivity = false;

  const accrueShortFee = (lot: BreakdownShortLotState, date: number): void => {
    if (
      date <= lot.lastAccrualDate ||
      lot.remainingShares <= POSITION_EPSILON ||
      lot.originalShares <= POSITION_EPSILON
    ) {
      return;
    }
    const days = Math.max(0, calendarDaysBetween(lot.lastAccrualDate, date, timeZone));
    const remainingPrincipal =
      (lot.originalPrincipal * lot.remainingShares) / lot.originalShares;
    lot.accruedFee +=
      (remainingPrincipal * (lot.annualRate / 100.0) * days) / denominator;
    lot.lastAccrualDate = date;
  };

  const shortLotKey = (tx: StockTransaction, lotId: string): string =>
    `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}:${lotId}`;

  for (const tx of ordered) {
    for (const lot of shortLots.values()) {
      accrueShortFee(lot, tx.date);
    }

    const posKey = positionScopeKey(tx);
    let longState = longStates.get(posKey);
    if (!longState) {
      longState = { shares: 0.0, cost: 0.0 };
      longStates.set(posKey, longState);
    }

    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.MARGIN_BUY: {
        longState.shares += Math.max(0.0, tx.buyShares);
        longState.cost += tx.expense;
        break;
      }
      case TransactionType.SELL: {
        const requestedShares = Math.max(0.0, tx.sellShares);
        const disposedShares = Math.min(requestedShares, Math.max(0.0, longState.shares));
        const averageCost =
          longState.shares > POSITION_EPSILON ? longState.cost / longState.shares : 0.0;
        const disposedCost = averageCost * disposedShares;
        const allocatedIncome =
          requestedShares > POSITION_EPSILON
            ? (tx.income * disposedShares) / requestedShares
            : 0.0;
        const allocatedGross = tx.sellPrice * disposedShares;

        realizedProfitLoss += allocatedIncome - disposedCost;
        realizedCost += disposedCost;
        realizedBuyAmount += disposedCost;
        realizedSellAmount += allocatedGross;
        soldShares += disposedShares;
        longState.shares = Math.max(0.0, longState.shares - disposedShares);
        longState.cost = Math.max(0.0, longState.cost - disposedCost);
        hasRealizedActivity =
          hasRealizedActivity ||
          requestedShares > POSITION_EPSILON ||
          Math.abs(tx.income) > POSITION_EPSILON;
        break;
      }
      case TransactionType.STOCK_DIVIDEND: {
        longState.shares += tx.dividendShares;
        break;
      }
      case TransactionType.CASH_DIVIDEND: {
        if (includeDividendIncome) {
          const divIncome = resolveDividendIncome(tx);
          realizedProfitLoss += divIncome;
          hasRealizedActivity =
            hasRealizedActivity || Math.abs(divIncome) > POSITION_EPSILON;
        }
        break;
      }
      case TransactionType.STOCK_SPLIT:
      case TransactionType.CAPITAL_REDUCTION: {
        const shareChange =
          tx.type === TransactionType.STOCK_SPLIT
            ? splitShareChange(tx, longState.shares)
            : capitalReductionShareChange(tx, longState.shares);

        if (
          tx.type === TransactionType.CAPITAL_REDUCTION &&
          tx.cashReturned > POSITION_EPSILON &&
          shareChange < -POSITION_EPSILON
        ) {
          const removedShares = Math.min(-shareChange, longState.shares);
          const averageCost =
            longState.shares > POSITION_EPSILON ? longState.cost / longState.shares : 0.0;
          const removedCost = averageCost * removedShares;
          realizedProfitLoss += tx.cashReturned - removedCost;
          realizedCost += removedCost;
          longState.cost = Math.max(0.0, longState.cost - removedCost);
          hasRealizedActivity = true;
        } else if (
          tx.type === TransactionType.CAPITAL_REDUCTION &&
          tx.cashReturned > POSITION_EPSILON
        ) {
          realizedProfitLoss += tx.cashReturned;
          hasRealizedActivity = true;
        }
        longState.shares = Math.max(0.0, longState.shares + shareChange);

        const factor =
          tx.type === TransactionType.STOCK_SPLIT
            ? splitShareFactor(tx)
            : capitalReductionShareFactor(tx);
        if (factor > 0.0 && factor !== 1.0) {
          const txMarket = normalizeMarket(tx.market);
          const txCode = canonicalStockCode(tx.stockCode);
          for (const lot of shortLots.values()) {
            if (
              lot.market === txMarket &&
              lot.stockCode === txCode &&
              lot.accountId === tx.accountId
            ) {
              lot.originalShares *= factor;
              lot.remainingShares *= factor;
            }
          }
        }
        break;
      }
      case TransactionType.SHORT_SELL: {
        const shares = Math.max(0.0, tx.sellShares);
        if (shares > POSITION_EPSILON) {
          const lotId = tx.shortLotId.trim() ? tx.shortLotId : `legacy-short-${tx.id}`;
          shortLots.set(shortLotKey(tx, lotId), {
            market: normalizeMarket(tx.market),
            stockCode: canonicalStockCode(tx.stockCode),
            accountId: tx.accountId,
            originalShares: shares,
            remainingShares: shares,
            originalPrincipal:
              tx.shortBorrowPrincipal > 0.0 ? tx.shortBorrowPrincipal : tx.sellPrice * shares,
            openingIncome: tx.income,
            openingGross: tx.sellPrice * shares,
            annualRate: tx.shortBorrowAnnualRate,
            accruedFee: 0.0,
            lastAccrualDate: tx.date,
          });
        }
        break;
      }
      case TransactionType.SHORT_COVER: {
        const requestedShares = Math.max(0.0, tx.shortCoverShares);
        const lot = shortLots.get(shortLotKey(tx, tx.shortCoverLotId));
        if (lot && requestedShares > POSITION_EPSILON && lot.remainingShares > POSITION_EPSILON) {
          const remainingBefore = lot.remainingShares;
          const coveredShares = Math.min(requestedShares, remainingBefore);
          const originalRatio = coveredShares / lot.originalShares;
          const requestRatio = coveredShares / requestedShares;
          const feeAllocation = (lot.accruedFee * coveredShares) / remainingBefore;
          const openingIncome = lot.openingIncome * originalRatio;
          const openingGross = lot.openingGross * originalRatio;
          const coverExpense = tx.expense * requestRatio;
          const coveredPrincipal = lot.originalPrincipal * originalRatio;

          realizedProfitLoss += openingIncome - coverExpense - feeAllocation;
          realizedCost += coveredPrincipal;
          realizedBuyAmount += coverExpense;
          realizedSellAmount += openingGross;
          coveredShortShares += coveredShares;
          lot.remainingShares = Math.max(0.0, remainingBefore - coveredShares);
          lot.accruedFee = Math.max(0.0, lot.accruedFee - feeAllocation);
          lot.lastAccrualDate = tx.date;
          hasRealizedActivity = true;
        }
        break;
      }
      case TransactionType.SHORT_COMPENSATION: {
        if (tx.shortCompensation > 0.0) {
          realizedProfitLoss -= tx.shortCompensation;
          hasRealizedActivity = true;
        }
        break;
      }
    }
  }

  for (const lot of shortLots.values()) {
    accrueShortFee(lot, valuationDate);
  }
  if (marginSummary.actualInterestPaid > POSITION_EPSILON) {
    realizedProfitLoss -= marginSummary.actualInterestPaid;
    hasRealizedActivity = true;
  }

  let remainingLongCost = 0.0;
  let remainingLongShares = 0.0;
  for (const state of longStates.values()) {
    remainingLongCost += Math.max(0.0, state.cost);
    remainingLongShares += Math.max(0.0, state.shares);
  }

  let remainingShortPrincipal = 0.0;
  for (const lot of shortLots.values()) {
    if (lot.originalShares > POSITION_EPSILON) {
      remainingShortPrincipal +=
        (lot.originalPrincipal * lot.remainingShares) / lot.originalShares;
    }
  }

  const unrealizedCost = remainingLongCost + remainingShortPrincipal;
  const totalRealizedShares = soldShares + coveredShortShares;
  const unrealizedProfitLoss = legacyTotalProfitLoss - realizedProfitLoss;

  return {
    realizedProfitLoss,
    unrealizedProfitLoss,
    realizedCost,
    unrealizedCost,
    soldShares,
    coveredShortShares,
    realizedBuyAverage:
      totalRealizedShares > POSITION_EPSILON ? realizedBuyAmount / totalRealizedShares : 0.0,
    realizedSellAverage:
      totalRealizedShares > POSITION_EPSILON ? realizedSellAmount / totalRealizedShares : 0.0,
    unrealizedAverageCost:
      remainingLongShares > POSITION_EPSILON ? remainingLongCost / remainingLongShares : 0.0,
    hasRealizedActivity,
    realizedPercentage:
      realizedCost > POSITION_EPSILON ? (realizedProfitLoss / realizedCost) * 100.0 : 0.0,
    unrealizedPercentage:
      unrealizedCost > POSITION_EPSILON
        ? (unrealizedProfitLoss / unrealizedCost) * 100.0
        : 0.0,
  };
}

function replayAccountShares(orderedTxs: readonly StockTransaction[]): Map<number, number> {
  const byAccount = new Map<number, number>();
  for (const tx of orderedTxs) {
    const current = byAccount.get(tx.accountId) ?? 0.0;
    let next = current;
    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.MARGIN_BUY:
        next = current + tx.buyShares;
        break;
      case TransactionType.SELL:
        next = current - tx.sellShares;
        break;
      case TransactionType.STOCK_DIVIDEND:
        next = current + tx.dividendShares;
        break;
      case TransactionType.CAPITAL_REDUCTION:
        next = current + capitalReductionShareChange(tx, current);
        break;
      case TransactionType.STOCK_SPLIT:
        next = current + splitShareChange(tx, current);
        break;
    }
    byAccount.set(tx.accountId, next);
  }
  return byAccount;
}

export function calculateHoldingInfo(
  inputs: HoldingCalculationInputs,
  taxRates: TaiwanTaxRates = DEFAULT_TAIWAN_TAX_RATES,
  timeZone: string = getSystemTimeZone()
): HoldingInfo {
  const orderedTxs = transactionsAtOrBefore(inputs.transactions, inputs.currentDateMillis);
  const longSummary = replayLongPosition(orderedTxs, inputs.currentDateMillis, true);
  const marginSummary = calculateMarginSummary(
    orderedTxs,
    inputs.currentDateMillis,
    inputs.marginDayCount,
    true,
    timeZone
  );
  const shortSummary = calculateShortSellingSummary(
    orderedTxs,
    inputs.currentDateMillis,
    inputs.marginDayCount,
    true,
    timeZone
  );

  const isUs = isUsMarket(inputs.stock.market);
  const shares = longSummary.shares;
  const marketValue = shares * inputs.currentPrice;
  const shortMarketLiability = shortSummary.outstandingShares * inputs.currentPrice;
  const marginNetEquity =
    marketValue - marginSummary.outstandingPrincipal - marginSummary.accruedInterest;

  let shortIncome = 0.0;
  let shortCoverExpense = 0.0;
  let hasMarginPurchase = false;
  let hasShortActivity = false;
  for (const tx of orderedTxs) {
    if (tx.type === TransactionType.MARGIN_BUY) hasMarginPurchase = true;
    if (tx.type === TransactionType.SHORT_SELL) {
      shortIncome += tx.income;
      hasShortActivity = true;
    } else if (tx.type === TransactionType.SHORT_COVER) {
      shortCoverExpense += tx.expense;
      hasShortActivity = true;
    } else if (tx.type === TransactionType.SHORT_COMPENSATION) {
      hasShortActivity = true;
    }
  }

  const excludeDiv = inputs.excludeDividendIncomeFromReturns ?? false;
  const costBasis = performanceCostBasis(
    longSummary.totalBuyExpense,
    longSummary.totalSellIncome,
    longSummary.totalDividendIncome,
    excludeDiv
  );

  const longInvestment = hasMarginPurchase
    ? marginSummary.selfFundedCapital
    : longSummary.totalBuyExpense;
  const financedRemainingInvestment = hasMarginPurchase
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
    financedRemainingInvestment,
    marginDebt: marginSummary.outstandingPrincipal + marginSummary.accruedInterest,
    shortOutstandingShares: shortSummary.outstandingShares,
    shortRemainingInvestment: shortSummary.openedPrincipal,
    shortCumulativeInvestment: shortSummary.cumulativeOpenedPrincipal,
  });

  let exitCost = 0.0;
  if (inputs.preDeductSellFees && marketValue > 0.0 && !isUs) {
    const accountShares = replayAccountShares(orderedTxs);
    for (const [accountId, acctShares] of accountShares.entries()) {
      if (acctShares > POSITION_EPSILON) {
        const feeSettings = resolveAccountFeeSettingsById(
          accountId,
          inputs.feeSettingsByAccount,
          inputs.sharedFeeSettings
        );
        exitCost += calculateTaiwanFee(
          inputs.currentPrice,
          acctShares,
          feeSettings.feeDiscount,
          feeSettings.minFeeRegular,
          feeSettings.minFeeOddLot
        );
        exitCost += calculateTaiwanTax(
          inputs.currentPrice,
          acctShares,
          inputs.stock.stockType,
          false,
          taxRates
        );
      }
    }
  }

  const longPL = marketValue - costBasis - marginSummary.totalInterestExpense;
  const shortPL =
    shortIncome -
    shortCoverExpense -
    shortMarketLiability -
    shortSummary.accruedBorrowFee -
    shortSummary.compensationExpense;
  const totalPL = longPL + shortPL - exitCost;

  let totalPLPercentage = 0.0;
  if (inputs.returnRateMode === ReturnRateMode.XIRR) {
    const marginFlows = new MarginHistoricalXirrTimeline(
      orderedTxs,
      1.0,
      (d) => d,
      true,
      !excludeDiv
    ).cashFlowsAt(inputs.currentDateMillis, marketValue, marginSummary, inputs.currentDateMillis);

    const shortFlows: CashFlow[] = hasShortActivity
      ? new ShortSellingHistoricalXirrTimeline(orderedTxs, (d) => d, true).cashFlowsAt(
          inputs.currentDateMillis,
          inputs.currentPrice,
          shortSummary,
          inputs.currentDateMillis
        )
      : [];

    totalPLPercentage =
      calculateXirrPercentage([...marginFlows, ...shortFlows], 0.1, timeZone) ?? 0.0;
  } else if (inputs.returnRateMode === ReturnRateMode.CUMULATIVE_INVESTMENT) {
    totalPLPercentage =
      basis.cumulative > POSITION_EPSILON ? (totalPL / basis.cumulative) * 100.0 : 0.0;
  } else {
    const denom =
      basis.remaining > POSITION_EPSILON ? basis.remaining : basis.cumulative;
    totalPLPercentage = denom > POSITION_EPSILON ? (totalPL / denom) * 100.0 : 0.0;
  }

  const averageCost = shares > POSITION_EPSILON ? costBasis / shares : 0.0;
  const buyAverage =
    longSummary.buySharesTotal > POSITION_EPSILON
      ? longSummary.buyCostTotal / longSummary.buySharesTotal
      : 0.0;
  const sellAverage =
    longSummary.sellSharesTotal > POSITION_EPSILON
      ? longSummary.sellAmountBeforeFee / longSummary.sellSharesTotal
      : 0.0;

  const isRealizedSlice = !isOpenPosition(
    shares,
    marginSummary,
    shortSummary.outstandingShares
  );

  const profitLossBreakdown = inputs.includeProfitLossBreakdown
    ? calculateProfitLossBreakdown(
        orderedTxs,
        inputs.currentDateMillis,
        totalPL,
        marginSummary,
        inputs.marginDayCount,
        !excludeDiv,
        timeZone
      )
    : null;

  return {
    stock: inputs.stock,
    shares,
    currentPrice: inputs.currentPrice,
    averageCost,
    buyAverage,
    totalInvestment: basis.cumulative,
    remainingPositionInvestment: basis.remaining,
    sellAverage,
    totalPL,
    totalPLPercentage,
    dailyChange: inputs.dailyChange,
    dailyChangePercentage: inputs.dailyChangePercentage,
    dividendIncome: longSummary.totalDividendIncome,
    marketValue,
    limitState: inputs.limitState,
    marginOutstandingPrincipal: marginSummary.outstandingPrincipal,
    marginAccruedInterest: marginSummary.accruedInterest,
    marginNetEquity,
    shortOutstandingShares: shortSummary.outstandingShares,
    shortMarketLiability,
    shortAccruedBorrowFee: shortSummary.accruedBorrowFee,
    shortCompensationExpense: shortSummary.compensationExpense,
    profitLossBreakdown,
    isRealizedSlice,
  };
}

function feeSettingsEqual(a: AccountFeeSettings, b: AccountFeeSettings): boolean {
  return (
    a.feeDiscount === b.feeDiscount &&
    a.minFeeRegular === b.minFeeRegular &&
    a.minFeeOddLot === b.minFeeOddLot
  );
}

function feeSettingsMapEqual(
  a: Record<number, AccountFeeSettings>,
  b: Record<number, AccountFeeSettings>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const numKey = Number(key);
    const valA = a[numKey];
    const valB = b[numKey];
    if (!valA || !valB || !feeSettingsEqual(valA, valB)) return false;
  }
  return true;
}

function transactionsEqual(
  a: readonly StockTransaction[],
  b: readonly StockTransaction[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function inputsEqual(a: HoldingCalculationInputs, b: HoldingCalculationInputs): boolean {
  return (
    a.stock.code === b.stock.code &&
    a.stock.name === b.stock.name &&
    a.stock.market === b.stock.market &&
    a.stock.exchange === b.stock.exchange &&
    a.stock.industry === b.stock.industry &&
    a.stock.stockType === b.stock.stockType &&
    transactionsEqual(a.transactions, b.transactions) &&
    a.currentPrice === b.currentPrice &&
    a.dailyChange === b.dailyChange &&
    a.dailyChangePercentage === b.dailyChangePercentage &&
    a.limitState === b.limitState &&
    a.preDeductSellFees === b.preDeductSellFees &&
    feeSettingsMapEqual(a.feeSettingsByAccount, b.feeSettingsByAccount) &&
    feeSettingsEqual(a.sharedFeeSettings, b.sharedFeeSettings) &&
    a.returnRateMode === b.returnRateMode &&
    a.currentDateMillis === b.currentDateMillis &&
    a.marginDayCount === b.marginDayCount &&
    (a.includeProfitLossBreakdown ?? false) === (b.includeProfitLossBreakdown ?? false) &&
    (a.excludeDividendIncomeFromReturns ?? false) ===
      (b.excludeDividendIncomeFromReturns ?? false)
  );
}

export class HoldingCalculationCache {
  private readonly entries = new Map<
    string,
    { inputs: HoldingCalculationInputs; result: HoldingInfo }
  >();

  getOrCompute(
    inputs: HoldingCalculationInputs,
    compute: (inp: HoldingCalculationInputs) => HoldingInfo = (inp) =>
      calculateHoldingInfo(inp)
  ): HoldingInfo {
    const key = stockCacheKey(inputs.stock.market, inputs.stock.code);
    const existing = this.entries.get(key);
    if (existing && inputsEqual(existing.inputs, inputs)) {
      return existing.result;
    }
    const result = compute(inputs);
    this.entries.set(key, { inputs, result });
    return result;
  }

  retainStocks(keys: Iterable<string>): void {
    const allowed = new Set(keys);
    for (const key of this.entries.keys()) {
      if (!allowed.has(key)) {
        this.entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function aggregateHoldingsUiState(
  holdings: readonly HoldingInfo[],
  displayMode: HomeDisplayMode | string,
  usdToTwdRate: number
): HoldingsUiState {
  const effectiveFx = Number.isFinite(usdToTwdRate) && usdToTwdRate > 0.0 ? usdToTwdRate : 1.0;
  const usMultiplier = displayMode === HomeDisplayMode.COMBINED ? effectiveFx : 1.0;

  let cumulativePL = 0.0;
  let dailyPL = 0.0;
  let taiwanMarketValue = 0.0;
  let usMarketValue = 0.0;
  let totalCost = 0.0;
  let dividendIncome = 0.0;
  let sellAverageWeighted = 0.0;
  let sellWeight = 0.0;
  const assetStockValues: AssetStockValue[] = [];

  for (const h of holdings) {
    const isUs = isUsMarket(h.stock.market);
    const rate = isUs ? usMultiplier : 1.0;
    const twdRate = isUs ? effectiveFx : 1.0;

    if (isUs) {
      usMarketValue += h.marketValue;
    } else {
      taiwanMarketValue += h.marketValue;
    }

    cumulativePL += h.totalPL * rate;
    dailyPL += (h.shares - h.shortOutstandingShares) * h.dailyChange * rate;
    totalCost += h.totalInvestment * rate;
    dividendIncome += h.dividendIncome * rate;

    if (h.marketValue > POSITION_EPSILON) {
      assetStockValues.push({
        stock: h.stock,
        marketValue: h.marketValue * twdRate,
      });
    }

    if (h.sellAverage > 0.0) {
      sellAverageWeighted += h.sellAverage * rate;
      sellWeight += 1.0;
    }
  }

  const marketValue = taiwanMarketValue + usMarketValue * usMultiplier;
  const cumulativePLPercentage =
    totalCost > POSITION_EPSILON ? (cumulativePL / totalCost) * 100.0 : 0.0;

  return {
    cumulativePL,
    cumulativePLPercentage,
    dailyPL,
    marketValue,
    taiwanMarketValue,
    usMarketValue,
    totalCost,
    dividendIncome,
    holdings: holdings.slice(),
    assetStockValues,
    sellAverage: sellWeight > 0.0 ? sellAverageWeighted / sellWeight : 0.0,
  };
}

export interface SortHoldingsOptions {
  sortMode: HomeHoldingsSortMode | string;
  sortColumn: HomeHoldingsSortColumn | string;
  ascending: boolean;
  manualOrder: readonly string[];
  displayMode: HomeDisplayMode | string;
  usdToTwdRate: number;
}

export function sortHoldings(
  holdings: readonly HoldingInfo[],
  options: SortHoldingsOptions
): HoldingInfo[] {
  if (
    options.sortMode === HomeHoldingsSortMode.MANUAL ||
    options.sortColumn === HomeHoldingsSortColumn.NONE
  ) {
    const orderMap = new Map<string, number>();
    options.manualOrder.forEach((key, idx) => orderMap.set(key, idx));
    return holdings.slice().sort((a, b) => {
      const keyA = stockCacheKey(a.stock.market, a.stock.code);
      const keyB = stockCacheKey(b.stock.market, b.stock.code);
      const idxA = orderMap.get(keyA) ?? Number.MAX_SAFE_INTEGER;
      const idxB = orderMap.get(keyB) ?? Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return keyA.localeCompare(keyB);
    });
  }

  const effectiveFx =
    Number.isFinite(options.usdToTwdRate) && options.usdToTwdRate > 0.0
      ? options.usdToTwdRate
      : 1.0;
  const toSortableAmount = (value: number, market: string): number =>
    options.displayMode === HomeDisplayMode.COMBINED && isUsMarket(market)
      ? value * effectiveFx
      : value;

  const metric = (h: HoldingInfo): number => {
    switch (options.sortColumn) {
      case HomeHoldingsSortColumn.MARKET_VALUE:
        return toSortableAmount(h.marketValue, h.stock.market);
      case HomeHoldingsSortColumn.DAILY_PL:
        return toSortableAmount(
          (h.shares - h.shortOutstandingShares) * h.dailyChange,
          h.stock.market
        );
      case HomeHoldingsSortColumn.TOTAL_PL:
        return toSortableAmount(h.totalPL, h.stock.market);
      case HomeHoldingsSortColumn.RETURN_RATE:
        return h.totalPLPercentage;
      default:
        return 0.0;
    }
  };

  return holdings.slice().sort((a, b) => {
    const diff = metric(a) - metric(b);
    if (diff !== 0.0) {
      return options.ascending ? diff : -diff;
    }
    return stockCacheKey(a.stock.market, a.stock.code).localeCompare(
      stockCacheKey(b.stock.market, b.stock.code)
    );
  });
}

export function buildAssetOverviewUiState(params: {
  taiwanStockValue: number;
  usStockValue: number;
  stockValues: readonly AssetStockValue[];
  bankDeposits: readonly BankDeposit[];
  loans: readonly Loan[];
}): AssetOverviewUiState {
  const totalBankDeposit = params.bankDeposits.reduce((sum, d) => sum + d.amount, 0.0);
  const totalLoan = params.loans.reduce((sum, l) => sum + l.amount, 0.0);
  const grossAssets = params.taiwanStockValue + params.usStockValue + totalBankDeposit;
  const netAssets = grossAssets - totalLoan;

  return {
    taiwanStockValue: params.taiwanStockValue,
    usStockValue: params.usStockValue,
    stockValues: params.stockValues.slice(),
    bankDeposits: params.bankDeposits.slice(),
    loans: params.loans.slice(),
    totalBankDeposit,
    totalLoan,
    grossAssets,
    netAssets,
  };
}

export function transactionCashFlowAmount(tx: StockTransaction): number | null {
  switch (tx.type) {
    case TransactionType.BUY:
      return -tx.expense;
    case TransactionType.MARGIN_BUY:
      return -(tx.marginSelfFundedOverridden
        ? tx.marginSelfFunded
        : tx.expense - tx.marginPrincipal);
    case TransactionType.SELL:
      return tx.income - tx.marginRepayment - tx.marginActualInterest;
    case TransactionType.MARGIN_REPAYMENT:
      return -(tx.marginRepayment + tx.marginActualInterest);
    case TransactionType.SHORT_SELL:
      return tx.income;
    case TransactionType.SHORT_COVER:
      return -tx.expense;
    case TransactionType.SHORT_COMPENSATION:
      return -tx.shortCompensation;
    case TransactionType.CASH_DIVIDEND:
      return resolveDividendIncome(tx);
    case TransactionType.CAPITAL_REDUCTION:
      return tx.cashReturned;
    case TransactionType.STOCK_DIVIDEND:
      return 0.0;
    default:
      return null;
  }
}

function formatTransactionSectionDate(
  dateMillis: number,
  timeZone: string = getSystemTimeZone()
): string {
  const dateObj = new Date(dateMillis);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateObj);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(dateObj);
  return `${ymd.replace(/-/g, "/")} (${weekday})`;
}

function computeCashFlowTotals(
  items: readonly TransactionUiState[]
): TransactionDateCashFlowTotal[] {
  const byMarket = new Map<StockMarket, { income: number; expense: number }>();
  for (const item of items) {
    const market = normalizeMarket(item.market || item.transaction.market);
    const tx = item.transaction;
    const cf = transactionCashFlowAmount(tx);
    if (cf === null || Math.abs(cf) < POSITION_EPSILON) continue;
    const entry = byMarket.get(market) ?? { income: 0.0, expense: 0.0 };
    if (cf > 0.0) {
      entry.income += cf;
    } else {
      entry.expense += -cf;
    }
    byMarket.set(market, entry);
  }

  const result: TransactionDateCashFlowTotal[] = [];
  for (const market of [StockMarket.TW, StockMarket.US]) {
    const entry = byMarket.get(market);
    if (entry && (entry.income > POSITION_EPSILON || entry.expense > POSITION_EPSILON)) {
      result.push({
        market,
        income: entry.income,
        expense: entry.expense,
      });
    }
  }
  return result;
}

export function filterTransactionDateSections(
  sections: readonly TransactionDateSection[],
  query: string
): TransactionDateSection[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return sections.slice();

  const filtered: TransactionDateSection[] = [];
  for (const section of sections) {
    const sectionDateLower = section.date.toLowerCase();
    const matchingTxs = section.transactions.filter((item) => {
      const code = item.transaction.stockCode.toLowerCase();
      const name = item.stockName.toLowerCase();
      const type = item.transaction.type.toLowerCase();
      const note = item.transaction.note.toLowerCase();
      return terms.every(
        (term) =>
          code.includes(term) ||
          name.includes(term) ||
          type.includes(term) ||
          note.includes(term) ||
          sectionDateLower.includes(term)
      );
    });
    if (matchingTxs.length > 0) {
      filtered.push({
        date: section.date,
        transactions: matchingTxs,
        cashFlowTotals: computeCashFlowTotals(matchingTxs),
      });
    }
  }
  return filtered;
}

export function buildTransactionsUiState(params: {
  transactionsWithStock: readonly TransactionWithStock[];
  accountId: number;
  query: string;
  isLoading?: boolean;
  timeZone?: string;
}): TransactionsUiState {
  const timeZone = params.timeZone ?? getSystemTimeZone();
  const scoped =
    params.accountId === 0
      ? params.transactionsWithStock
      : params.transactionsWithStock.filter(
          (item) => item.transaction.accountId === params.accountId
        );

  const sortedDesc = scoped.slice().sort((a, b) => compareTransactions(b.transaction, a.transaction));

  const sectionMap = new Map<string, TransactionUiState[]>();
  for (const item of sortedDesc) {
    const dateLabel = formatTransactionSectionDate(item.transaction.date, timeZone);
    let list = sectionMap.get(dateLabel);
    if (!list) {
      list = [];
      sectionMap.set(dateLabel, list);
    }
    list.push({
      transaction: item.transaction,
      stockName: item.stock?.name || "Unknown",
      market: item.stock ? normalizeMarket(item.stock.market) : "",
    });
  }

  const allSections: TransactionDateSection[] = [];
  for (const [date, items] of sectionMap.entries()) {
    allSections.push({
      date,
      transactions: items,
      cashFlowTotals: computeCashFlowTotals(items),
    });
  }

  const filteredSections = filterTransactionDateSections(allSections, params.query);
  const resultCount = filteredSections.reduce(
    (sum, section) => sum + section.transactions.length,
    0
  );

  return {
    accountId: params.accountId,
    query: params.query,
    isLoading: params.isLoading ?? false,
    sections: filteredSections,
    totalCount: scoped.length,
    resultCount,
  };
}

export function isTaiwanStockRefIncluded(
  tx: StockTransaction,
  accountId: number,
  valuationDateMillis: number
): boolean {
  return (
    isTwMarket(tx.market) &&
    (accountId === 0 || tx.accountId === accountId) &&
    tx.date <= valuationDateMillis
  );
}
