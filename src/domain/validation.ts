import {
  TransactionType,
  type StockTransaction,
  type ValidationResult,
} from "@/types";
import {
  capitalReductionShareChange,
  compareTransactions,
  POSITION_EPSILON,
  splitShareChange,
} from "./holdings";
import { hasValidRepaymentBalances } from "./margin";
import {
  canonicalStockCode,
  inferMarketFromCode,
  isTwMarket,
  normalizeMarket,
} from "./market";
import { hasValidCoverBalances } from "./shortSelling";

const FINANCING_TYPES = new Set<string>([
  TransactionType.MARGIN_BUY,
  TransactionType.MARGIN_REPAYMENT,
  TransactionType.SHORT_SELL,
  TransactionType.SHORT_COVER,
  TransactionType.SHORT_COMPENSATION,
]);

const AMOUNT_EPSILON = 1e-6;

function approximatelyEqual(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const tolerance = Math.max(1e-6, Math.max(Math.abs(left), Math.abs(right)) * 1e-9);
  return Math.abs(left - right) <= tolerance;
}

function approxAmountEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= AMOUNT_EPSILON;
}

function hasMarginOpeningFields(tx: StockTransaction): boolean {
  return (
    tx.marginLotId.trim().length > 0 ||
    tx.marginPrincipal !== 0.0 ||
    tx.marginAnnualRate !== 0.0 ||
    tx.marginSelfFunded !== 0.0 ||
    tx.marginSelfFundedOverridden
  );
}

function hasMarginPayment(tx: StockTransaction): boolean {
  return (
    tx.marginRepaymentLotId.trim().length > 0 ||
    tx.marginRepayment !== 0.0 ||
    tx.marginActualInterest !== 0.0
  );
}

function hasAnyMarginFields(tx: StockTransaction): boolean {
  return hasMarginOpeningFields(tx) || hasMarginPayment(tx);
}

function hasShortOpeningFields(tx: StockTransaction): boolean {
  return (
    tx.shortLotId.trim().length > 0 ||
    tx.shortBorrowPrincipal !== 0.0 ||
    tx.shortBorrowAnnualRate !== 0.0
  );
}

function hasShortCoverFields(tx: StockTransaction): boolean {
  return tx.shortCoverLotId.trim().length > 0 || tx.shortCoverShares !== 0.0;
}

function hasShortCompensationFields(tx: StockTransaction): boolean {
  return tx.shortCompensationLotId.trim().length > 0 || tx.shortCompensation !== 0.0;
}

function hasAnyShortFields(tx: StockTransaction): boolean {
  return (
    hasShortOpeningFields(tx) ||
    hasShortCoverFields(tx) ||
    hasShortCompensationFields(tx)
  );
}

function hasDividendOrCorporateActionFields(tx: StockTransaction): boolean {
  return (
    tx.cashDividend !== 0.0 ||
    tx.exDividendShares !== 0.0 ||
    tx.stockDividend !== 0.0 ||
    tx.dividendShares !== 0.0 ||
    tx.exRightsShares !== 0.0 ||
    tx.dividendIncome !== 0.0 ||
    tx.supplementaryHealthInsurancePremium !== 0.0 ||
    tx.capitalReductionRatio !== 0.0 ||
    tx.sharesBeforeReduction !== 0.0 ||
    tx.sharesAfterReduction !== 0.0 ||
    tx.cashReturned !== 0.0 ||
    tx.stockSplitRatio !== 0.0 ||
    tx.sharesBeforeSplit !== 0.0 ||
    tx.sharesAfterSplit !== 0.0
  );
}

export function usesFinancing(tx: StockTransaction): boolean {
  return (
    FINANCING_TYPES.has(tx.type) ||
    hasAnyMarginFields(tx) ||
    hasAnyShortFields(tx)
  );
}

export function validateFinancingMarket(
  tx: StockTransaction,
  market: string
): string | null {
  if (!usesFinancing(tx)) return null;
  if (
    !isTwMarket(market) ||
    !isTwMarket(tx.market) ||
    !isTwMarket(inferMarketFromCode(tx.stockCode))
  ) {
    return "融資融券僅支援台股";
  }
  return null;
}

export function validateSingleTransaction(tx: StockTransaction): string | null {
  if (!tx.stockCode.trim()) return "股號不可空白";
  if (tx.accountId <= 0) return "帳戶 ID 必須大於 0";

  const numericValues = [
    tx.buyPrice,
    tx.buyShares,
    tx.sellPrice,
    tx.sellShares,
    tx.fee,
    tx.tax,
    tx.income,
    tx.expense,
    tx.cashDividend,
    tx.exDividendShares,
    tx.dividendIncome,
    tx.supplementaryHealthInsurancePremium,
    tx.stockDividend,
    tx.dividendShares,
    tx.exRightsShares,
    tx.capitalReductionRatio,
    tx.sharesBeforeReduction,
    tx.sharesAfterReduction,
    tx.cashReturned,
    tx.stockSplitRatio,
    tx.sharesBeforeSplit,
    tx.sharesAfterSplit,
    tx.marginPrincipal,
    tx.marginAnnualRate,
    tx.marginRepayment,
    tx.marginSelfFunded,
    tx.marginActualInterest,
    tx.shortBorrowPrincipal,
    tx.shortBorrowAnnualRate,
    tx.shortCoverShares,
    tx.shortCompensation,
  ];
  if (numericValues.some((v) => !Number.isFinite(v))) {
    return "交易欄位包含無效數值";
  }
  if (numericValues.some((v) => v < 0.0)) {
    return "交易金額、股數、費率與費用不可為負數";
  }

  switch (tx.type) {
    case TransactionType.BUY: {
      if (tx.buyPrice <= 0.0 || tx.buyShares <= 0.0 || tx.expense <= 0.0) {
        return "買進的價格、股數與支出必須大於 0";
      }
      if (
        tx.sellPrice !== 0.0 ||
        tx.sellShares !== 0.0 ||
        tx.tax !== 0.0 ||
        tx.income !== 0.0 ||
        hasDividendOrCorporateActionFields(tx) ||
        hasAnyMarginFields(tx) ||
        hasAnyShortFields(tx)
      ) {
        return "買進包含不適用的賣出、稅額、收入、公司行動或融資融券欄位";
      }
      return null;
    }
    case TransactionType.SELL: {
      if (tx.sellPrice <= 0.0 || tx.sellShares <= 0.0 || tx.income <= 0.0) {
        return "賣出的價格、股數與收入必須大於 0";
      }
      if (
        tx.buyPrice !== 0.0 ||
        tx.buyShares !== 0.0 ||
        tx.expense !== 0.0 ||
        hasDividendOrCorporateActionFields(tx) ||
        hasAnyShortFields(tx) ||
        hasMarginOpeningFields(tx)
      ) {
        return "賣出包含不適用的買進、支出、公司行動或融資融券欄位";
      }
      return null;
    }
    case TransactionType.CASH_DIVIDEND: {
      if (
        tx.buyPrice !== 0.0 ||
        tx.buyShares !== 0.0 ||
        tx.sellPrice !== 0.0 ||
        tx.sellShares !== 0.0 ||
        tx.tax !== 0.0 ||
        tx.expense !== 0.0 ||
        tx.stockDividend !== 0.0 ||
        tx.dividendShares !== 0.0 ||
        tx.exRightsShares !== 0.0 ||
        hasAnyMarginFields(tx) ||
        hasAnyShortFields(tx) ||
        tx.capitalReductionRatio !== 0.0 ||
        tx.stockSplitRatio !== 0.0
      ) {
        return "配息包含不適用的買賣、稅額、支出、公司行動或融資融券欄位";
      }
      return null;
    }
    case TransactionType.STOCK_DIVIDEND: {
      if (tx.dividendShares <= 0.0) return "配股股數必須大於 0";
      if (
        tx.buyPrice !== 0.0 ||
        tx.buyShares !== 0.0 ||
        tx.sellPrice !== 0.0 ||
        tx.sellShares !== 0.0 ||
        tx.fee !== 0.0 ||
        tx.tax !== 0.0 ||
        tx.income !== 0.0 ||
        tx.expense !== 0.0 ||
        tx.cashDividend !== 0.0 ||
        tx.exDividendShares !== 0.0 ||
        tx.dividendIncome !== 0.0 ||
        tx.supplementaryHealthInsurancePremium !== 0.0 ||
        hasAnyMarginFields(tx) ||
        hasAnyShortFields(tx) ||
        tx.capitalReductionRatio !== 0.0 ||
        tx.sharesBeforeReduction !== 0.0 ||
        tx.sharesAfterReduction !== 0.0 ||
        tx.cashReturned !== 0.0 ||
        tx.stockSplitRatio !== 0.0 ||
        tx.sharesBeforeSplit !== 0.0 ||
        tx.sharesAfterSplit !== 0.0
      ) {
        return "配股包含不適用的買賣、費稅、金額、公司行動或融資融券欄位";
      }
      return null;
    }
    case TransactionType.CAPITAL_REDUCTION: {
      if (tx.capitalReductionRatio <= 0.0 || tx.capitalReductionRatio >= 100.0) {
        return "減資比例必須大於 0 且小於 100";
      }
      if (
        tx.buyPrice !== 0.0 ||
        tx.buyShares !== 0.0 ||
        tx.sellPrice !== 0.0 ||
        tx.sellShares !== 0.0 ||
        tx.fee !== 0.0 ||
        tx.tax !== 0.0 ||
        tx.expense !== 0.0 ||
        tx.cashDividend !== 0.0 ||
        tx.exDividendShares !== 0.0 ||
        tx.dividendIncome !== 0.0 ||
        tx.supplementaryHealthInsurancePremium !== 0.0 ||
        tx.stockDividend !== 0.0 ||
        tx.dividendShares !== 0.0 ||
        tx.exRightsShares !== 0.0 ||
        hasAnyMarginFields(tx) ||
        hasAnyShortFields(tx) ||
        tx.stockSplitRatio !== 0.0 ||
        tx.sharesBeforeSplit !== 0.0 ||
        tx.sharesAfterSplit !== 0.0
      ) {
        return "減資包含不適用的買賣、費用或融資融券欄位";
      }
      return null;
    }
    case TransactionType.STOCK_SPLIT: {
      if (tx.stockSplitRatio <= 0.0) return "分割比例必須大於 0";
      if (
        tx.buyPrice !== 0.0 ||
        tx.buyShares !== 0.0 ||
        tx.sellPrice !== 0.0 ||
        tx.sellShares !== 0.0 ||
        tx.tax !== 0.0 ||
        tx.income !== 0.0 ||
        tx.expense !== 0.0 ||
        tx.cashDividend !== 0.0 ||
        tx.exDividendShares !== 0.0 ||
        tx.dividendIncome !== 0.0 ||
        tx.supplementaryHealthInsurancePremium !== 0.0 ||
        tx.stockDividend !== 0.0 ||
        tx.dividendShares !== 0.0 ||
        tx.exRightsShares !== 0.0 ||
        hasAnyMarginFields(tx) ||
        hasAnyShortFields(tx) ||
        tx.capitalReductionRatio !== 0.0 ||
        tx.sharesBeforeReduction !== 0.0 ||
        tx.sharesAfterReduction !== 0.0 ||
        tx.cashReturned !== 0.0
      ) {
        return "分割包含不適用的買賣、稅、金額或融資融券欄位";
      }
      return null;
    }
    case TransactionType.MARGIN_BUY:
    case TransactionType.MARGIN_REPAYMENT:
    case TransactionType.SHORT_SELL:
    case TransactionType.SHORT_COVER:
    case TransactionType.SHORT_COMPENSATION:
      return null;
    default:
      return "不支援的交易類型";
  }
}

export function validateFinancingTransaction(
  transactions: readonly StockTransaction[]
): string | null {
  const marginLotIds = new Set<string>();
  const shortLotIds = new Set<string>();

  for (const tx of transactions) {
    if (tx.type === TransactionType.CAPITAL_REDUCTION) {
      if (
        !Number.isFinite(tx.capitalReductionRatio) ||
        !Number.isFinite(tx.sharesBeforeReduction) ||
        !Number.isFinite(tx.sharesAfterReduction) ||
        !Number.isFinite(tx.cashReturned)
      ) {
        return "減資欄位包含無效數值";
      }
      if (tx.capitalReductionRatio <= 0.0 || tx.capitalReductionRatio >= 100.0) {
        return "減資比例必須大於 0 且小於 100";
      }
      if (tx.sharesBeforeReduction < 0.0 || tx.sharesAfterReduction < 0.0) {
        return "減資前後股數不可為負數";
      }
      if (tx.cashReturned < 0.0) return "減資返還現金不可為負數";
    } else if (tx.type === TransactionType.STOCK_SPLIT) {
      if (
        !Number.isFinite(tx.stockSplitRatio) ||
        !Number.isFinite(tx.sharesBeforeSplit) ||
        !Number.isFinite(tx.sharesAfterSplit)
      ) {
        return "分割欄位包含無效數值";
      }
      if (tx.stockSplitRatio <= 0.0) return "分割比例必須大於 0";
      if (tx.sharesBeforeSplit < 0.0 || tx.sharesAfterSplit < 0.0) {
        return "分割前後股數不可為負數";
      }
    }

    if (
      !Number.isFinite(tx.supplementaryHealthInsurancePremium) ||
      tx.supplementaryHealthInsurancePremium < 0.0
    ) {
      return "補充保費必須是非負的有效數字";
    }
    if (
      tx.type !== TransactionType.CASH_DIVIDEND &&
      tx.supplementaryHealthInsurancePremium !== 0.0
    ) {
      return "只有配息交易可以包含補充保費";
    }

    if (!usesFinancing(tx)) continue;

    const marketError = validateFinancingMarket(tx, tx.market);
    if (marketError) return marketError;

    const financingNumbers = [
      tx.buyPrice,
      tx.buyShares,
      tx.sellPrice,
      tx.sellShares,
      tx.fee,
      tx.tax,
      tx.income,
      tx.expense,
      tx.supplementaryHealthInsurancePremium,
      tx.marginPrincipal,
      tx.marginAnnualRate,
      tx.marginRepayment,
      tx.marginSelfFunded,
      tx.marginActualInterest,
      tx.shortBorrowPrincipal,
      tx.shortBorrowAnnualRate,
      tx.shortCoverShares,
      tx.shortCompensation,
    ];
    if (financingNumbers.some((v) => !Number.isFinite(v))) {
      return "融資融券欄位包含無效數值";
    }
    if (financingNumbers.some((v) => v < 0.0)) {
      return "融資融券的金額、股數、費率與費用不可為負數";
    }

    const scopeKey = (lotId: string): string =>
      `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}:${lotId}`;

    switch (tx.type) {
      case TransactionType.MARGIN_BUY: {
        if (hasMarginPayment(tx) || hasAnyShortFields(tx)) {
          return "融資買進不可同時包含還款或融券欄位";
        }
        if (
          tx.sellPrice !== 0.0 ||
          tx.sellShares !== 0.0 ||
          tx.tax !== 0.0 ||
          tx.income !== 0.0 ||
          hasDividendOrCorporateActionFields(tx)
        ) {
          return "融資買進包含不適用的賣出、稅額、收入或公司行動欄位";
        }
        if (tx.buyPrice <= 0.0 || tx.buyShares <= 0.0 || tx.expense <= 0.0) {
          return "融資買進的價格、股數與支出必須大於 0";
        }
        if (tx.marginPrincipal <= 0.0 || tx.marginPrincipal > tx.expense) {
          return "融資本金必須大於 0 且不得超過支出";
        }
        if (tx.marginSelfFunded < 0.0 || tx.marginSelfFunded > tx.expense) {
          return "融資自備款不可為負數或超過支出";
        }
        if (!tx.marginLotId.trim()) return "融資買進缺少批次 ID";
        const k = scopeKey(tx.marginLotId);
        if (marginLotIds.has(k)) return "融資批次 ID 重複";
        marginLotIds.add(k);
        break;
      }
      case TransactionType.MARGIN_REPAYMENT: {
        if (hasMarginOpeningFields(tx) || hasAnyShortFields(tx)) {
          return "融資還款不可同時包含開倉或融券欄位";
        }
        if (
          tx.buyPrice !== 0.0 ||
          tx.buyShares !== 0.0 ||
          tx.sellPrice !== 0.0 ||
          tx.sellShares !== 0.0 ||
          tx.fee !== 0.0 ||
          tx.tax !== 0.0 ||
          tx.income !== 0.0 ||
          hasDividendOrCorporateActionFields(tx)
        ) {
          return "融資還款包含不適用的買賣、費稅、收入或公司行動欄位";
        }
        if (
          tx.marginRepayment < 0.0 ||
          tx.marginActualInterest < 0.0 ||
          tx.marginRepayment + tx.marginActualInterest <= 0.0
        ) {
          return "融資還款本金與實際利息必須為非負數，且至少一項大於 0";
        }
        if (!tx.marginRepaymentLotId.trim()) return "融資還款缺少批次 ID";
        if (
          !approxAmountEqual(
            tx.expense,
            tx.marginRepayment + tx.marginActualInterest
          )
        ) {
          return "融資還款支出必須等於還款本金加實際利息";
        }
        break;
      }
      case TransactionType.SHORT_SELL: {
        if (
          hasAnyMarginFields(tx) ||
          hasShortCoverFields(tx) ||
          hasShortCompensationFields(tx)
        ) {
          return "融券賣出不可同時包含融資、還券或補償欄位";
        }
        if (
          tx.buyPrice !== 0.0 ||
          tx.buyShares !== 0.0 ||
          tx.expense !== 0.0 ||
          hasDividendOrCorporateActionFields(tx)
        ) {
          return "融券賣出包含不適用的買進、支出或公司行動欄位";
        }
        if (
          tx.sellPrice <= 0.0 ||
          tx.sellShares <= 0.0 ||
          tx.shortBorrowPrincipal <= 0.0 ||
          tx.income <= 0.0
        ) {
          return "融券賣出的價格、股數、融券本金與收入必須大於 0";
        }
        if (!approxAmountEqual(tx.shortBorrowPrincipal, tx.sellPrice * tx.sellShares)) {
          return "融券本金必須等於融券賣出價格乘以股數";
        }
        if (!tx.shortLotId.trim()) return "融券賣出缺少批次 ID";
        const k = scopeKey(tx.shortLotId);
        if (shortLotIds.has(k)) return "融券批次 ID 重複";
        shortLotIds.add(k);
        break;
      }
      case TransactionType.SHORT_COVER: {
        if (
          hasAnyMarginFields(tx) ||
          hasShortOpeningFields(tx) ||
          hasShortCompensationFields(tx)
        ) {
          return "買券還券不可同時包含融資、開倉或補償欄位";
        }
        if (
          tx.sellPrice !== 0.0 ||
          tx.sellShares !== 0.0 ||
          tx.tax !== 0.0 ||
          tx.income !== 0.0 ||
          hasDividendOrCorporateActionFields(tx)
        ) {
          return "買券還券包含不適用的賣出、稅額、收入或公司行動欄位";
        }
        if (
          tx.buyPrice <= 0.0 ||
          tx.buyShares <= 0.0 ||
          tx.shortCoverShares <= 0.0 ||
          tx.expense <= 0.0
        ) {
          return "買券還券的價格、股數與支出必須大於 0";
        }
        if (!approxAmountEqual(tx.buyShares, tx.shortCoverShares)) {
          return "買券還券的買進股數必須等於還券股數";
        }
        if (!tx.shortCoverLotId.trim()) return "買券還券缺少批次 ID";
        break;
      }
      case TransactionType.SHORT_COMPENSATION: {
        if (
          hasAnyMarginFields(tx) ||
          hasShortOpeningFields(tx) ||
          hasShortCoverFields(tx)
        ) {
          return "融券補償不可同時包含融資、開倉或還券欄位";
        }
        if (
          tx.buyPrice !== 0.0 ||
          tx.buyShares !== 0.0 ||
          tx.sellPrice !== 0.0 ||
          tx.sellShares !== 0.0 ||
          tx.fee !== 0.0 ||
          tx.tax !== 0.0 ||
          tx.income !== 0.0 ||
          hasDividendOrCorporateActionFields(tx)
        ) {
          return "融券補償包含不適用的買賣、費稅、收入或公司行動欄位";
        }
        if (tx.shortCompensation <= 0.0) return "融券補償金必須大於 0";
        if (!tx.shortCompensationLotId.trim()) return "融券補償缺少批次 ID";
        if (!approxAmountEqual(tx.expense, tx.shortCompensation)) {
          return "融券補償支出必須等於補償金";
        }
        break;
      }
      case TransactionType.SELL: {
        if (hasMarginPayment(tx)) {
          if (hasMarginOpeningFields(tx) || hasAnyShortFields(tx)) {
            return "賣出還融資不可同時包含開倉或融券欄位";
          }
          if (
            tx.buyPrice !== 0.0 ||
            tx.buyShares !== 0.0 ||
            tx.expense !== 0.0 ||
            hasDividendOrCorporateActionFields(tx)
          ) {
            return "賣出還融資包含不適用的買進、支出或公司行動欄位";
          }
          if (
            tx.sellPrice <= 0.0 ||
            tx.sellShares <= 0.0 ||
            tx.income <= 0.0 ||
            tx.marginRepayment <= 0.0
          ) {
            return "賣出還融資的價格、股數、收入與還款本金必須大於 0";
          }
          if (!tx.marginRepaymentLotId.trim()) return "賣出還融資缺少批次 ID";
        }
        break;
      }
      default:
        return "交易類型與融資融券欄位不一致";
    }
  }
  return null;
}

export function validateLongPositionBalances(
  transactions: readonly StockTransaction[]
): string | null {
  const positions = new Map<string, number>();
  const ordered = transactions.slice().sort(compareTransactions);

  for (const tx of ordered) {
    const key = `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}`;
    const currentShares = positions.get(key) ?? 0.0;
    let nextShares = currentShares;

    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.MARGIN_BUY:
        nextShares = currentShares + tx.buyShares;
        break;
      case TransactionType.SELL:
        if (!Number.isFinite(tx.sellShares) || tx.sellShares < 0.0) {
          return "賣出股數必須是非負的有效數字";
        }
        if (currentShares + POSITION_EPSILON < tx.sellShares) {
          return "賣出股數超過交易當下可用持股";
        }
        nextShares = currentShares - tx.sellShares;
        break;
      case TransactionType.STOCK_DIVIDEND:
        nextShares = currentShares + tx.dividendShares;
        break;
      case TransactionType.CAPITAL_REDUCTION: {
        const expectedAfter =
          tx.sharesBeforeReduction > 0.0
            ? tx.sharesBeforeReduction * (1.0 - tx.capitalReductionRatio / 100.0)
            : null;
        const err = validateCompanyActionShares(
          tx.type,
          tx.sharesBeforeReduction,
          tx.sharesAfterReduction,
          currentShares,
          expectedAfter
        );
        if (err) return err;
        nextShares = currentShares + capitalReductionShareChange(tx, currentShares);
        break;
      }
      case TransactionType.STOCK_SPLIT: {
        const expectedAfter =
          tx.sharesBeforeSplit > 0.0
            ? tx.sharesBeforeSplit * tx.stockSplitRatio
            : null;
        const err = validateCompanyActionShares(
          tx.type,
          tx.sharesBeforeSplit,
          tx.sharesAfterSplit,
          currentShares,
          expectedAfter
        );
        if (err) return err;
        nextShares = currentShares + splitShareChange(tx, currentShares);
        break;
      }
    }

    if (!Number.isFinite(nextShares) || nextShares < -POSITION_EPSILON) {
      return "交易回放後的持股數無效";
    }
    positions.set(key, Math.max(0.0, nextShares));
  }
  return null;
}

function validateCompanyActionShares(
  type: string,
  recordedBefore: number,
  recordedAfter: number,
  currentShares: number,
  expectedAfter: number | null
): string | null {
  if (recordedBefore < 0.0 || recordedAfter < 0.0) {
    return `${type}前後股數不可為負數`;
  }
  const hasBefore = recordedBefore > 0.0;
  const hasAfter = recordedAfter > 0.0;
  if (!hasBefore && !hasAfter) return null;
  if (hasBefore !== hasAfter) {
    return `${type}前後股數必須同時填寫`;
  }
  if (!approximatelyEqual(recordedBefore, currentShares)) {
    return `${type}前股數與交易回放持股不一致`;
  }
  if (recordedAfter > 0.0 && expectedAfter !== null && !approximatelyEqual(recordedAfter, expectedAfter)) {
    return `${type}前後股數與比例不一致`;
  }
  return null;
}

export function validateTransactionSequence(
  transactions: readonly StockTransaction[]
): ValidationResult {
  for (const tx of transactions) {
    const singleErr = validateSingleTransaction(tx);
    if (singleErr) return { valid: false, error: singleErr };
  }

  const financingErr = validateFinancingTransaction(transactions);
  if (financingErr) return { valid: false, error: financingErr };

  const longErr = validateLongPositionBalances(transactions);
  if (longErr) return { valid: false, error: longErr };

  if (!hasValidRepaymentBalances(transactions)) {
    return { valid: false, error: "融資還款超過可用融資本金或批次不存在" };
  }
  if (!hasValidCoverBalances(transactions)) {
    return { valid: false, error: "融券還券或補償超過可用融券股數或批次不存在" };
  }

  return { valid: true, error: null };
}

export function transactionsWithCandidateForValidation(
  existingTransactions: readonly StockTransaction[],
  candidate: StockTransaction
): StockTransaction[] {
  const withoutCandidate =
    candidate.id > 0
      ? existingTransactions.filter((tx) => tx.id !== candidate.id)
      : existingTransactions.slice();
  const maxExistingId = existingTransactions.reduce(
    (max, tx) => Math.max(max, tx.id),
    0
  );
  const resolvedCandidate =
    candidate.id === 0 ? { ...candidate, id: maxExistingId + 1 } : candidate;
  return [...withoutCandidate, resolvedCandidate];
}

export function validateEditTransactionScopes(
  allTransactions: readonly StockTransaction[],
  originalTx: StockTransaction | null,
  candidateTx: StockTransaction
): ValidationResult {
  const newScopeKey = `${normalizeMarket(candidateTx.market)}:${canonicalStockCode(candidateTx.stockCode)}:${candidateTx.accountId}`;
  const candidateList = transactionsWithCandidateForValidation(
    allTransactions.filter(
      (tx) =>
        `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}` ===
        newScopeKey
    ),
    candidateTx
  );
  const newResult = validateTransactionSequence(candidateList);
  if (!newResult.valid) return newResult;

  if (originalTx) {
    const oldScopeKey = `${normalizeMarket(originalTx.market)}:${canonicalStockCode(originalTx.stockCode)}:${originalTx.accountId}`;
    if (oldScopeKey !== newScopeKey) {
      const remainingOldScope = allTransactions.filter(
        (tx) =>
          tx.id !== originalTx.id &&
          `${normalizeMarket(tx.market)}:${canonicalStockCode(tx.stockCode)}:${tx.accountId}` ===
            oldScopeKey
      );
      const oldResult = validateTransactionSequence(remainingOldScope);
      if (!oldResult.valid) return oldResult;
    }
  }

  return { valid: true, error: null };
}

export function canDeleteTransaction(
  target: StockTransaction,
  allTransactions: readonly StockTransaction[]
): boolean {
  const targetMarket = normalizeMarket(target.market);
  const targetCode = canonicalStockCode(target.stockCode);
  const sameScope = allTransactions.filter(
    (tx) =>
      tx.id !== target.id &&
      tx.accountId === target.accountId &&
      normalizeMarket(tx.market) === targetMarket &&
      canonicalStockCode(tx.stockCode) === targetCode
  );

  if (target.type === TransactionType.MARGIN_BUY) {
    const lotId = target.marginLotId.trim() ? target.marginLotId : `legacy-${target.id}`;
    const hasDependent = sameScope.some(
      (tx) =>
        tx.marginRepaymentLotId === lotId &&
        (tx.marginRepayment > 0.0 || tx.marginActualInterest > 0.0)
    );
    if (hasDependent) return false;
  }

  if (target.type === TransactionType.SHORT_SELL) {
    const lotId = target.shortLotId.trim()
      ? target.shortLotId
      : `legacy-short-${target.id}`;
    const hasDependent = sameScope.some(
      (tx) =>
        (tx.shortCoverLotId === lotId && tx.shortCoverShares > 0.0) ||
        (tx.shortCompensationLotId === lotId && tx.shortCompensation > 0.0)
    );
    if (hasDependent) return false;
  }

  return validateTransactionSequence(sameScope).valid;
}

export function assignProvisionalImportIds(
  existingOrMaxId: readonly StockTransaction[] | number,
  importedTransactions: readonly StockTransaction[]
): StockTransaction[] {
  const maxExistingId =
    typeof existingOrMaxId === "number"
      ? Math.max(0, existingOrMaxId)
      : existingOrMaxId.reduce((max, tx) => Math.max(max, tx.id), 0);
  return importedTransactions.map((tx, index) => ({
    ...tx,
    id: maxExistingId + index + 1,
  }));
}
