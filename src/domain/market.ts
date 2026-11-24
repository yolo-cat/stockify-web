import {
  CalculationRoundingMode,
  HomeDisplayMode,
  StockExchange,
  StockMarket,
  TransactionType,
  type Account,
  type AccountFeeSettings,
} from "@/types";

const US_TICKER_REGEX = /^[A-Za-z]+(?:[.-][A-Za-z]+)?$/;

export interface TaiwanTaxRates {
  normalListedStock: number;
  domesticStockEtf: number;
  bondEtf: number;
  dayTrading: number;
}

export const DEFAULT_TAIWAN_TAX_RATES: TaiwanTaxRates = {
  normalListedStock: 0.003,
  domesticStockEtf: 0.001,
  bondEtf: 0.0,
  dayTrading: 0.0015,
};

export function normalizeMarket(market: string | null | undefined): StockMarket {
  const normalized = (market ?? "").trim().toUpperCase();
  return normalized === StockMarket.US ? StockMarket.US : StockMarket.TW;
}

export function isTwMarket(market: string | null | undefined): boolean {
  return normalizeMarket(market) === StockMarket.TW;
}

export function isUsMarket(market: string | null | undefined): boolean {
  return normalizeMarket(market) === StockMarket.US;
}

export function inferMarketFromCode(code: string | null | undefined): StockMarket {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return StockMarket.TW;
  return US_TICKER_REGEX.test(trimmed) ? StockMarket.US : StockMarket.TW;
}

export function normalizeExchange(exchange: string | null | undefined): StockExchange {
  const trimmed = (exchange ?? "").trim();
  if (trimmed.includes(StockExchange.EMERGING)) return StockExchange.EMERGING;
  if (trimmed.includes(StockExchange.OTC)) return StockExchange.OTC;
  if (trimmed.includes(StockExchange.LISTED)) return StockExchange.LISTED;
  return StockExchange.UNKNOWN;
}

export function canonicalStockCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export function stockCacheKey(
  market: string | null | undefined,
  code: string | null | undefined
): string {
  return `${normalizeMarket(market)}:${canonicalStockCode(code)}`;
}

export function normalizeRoundingMode(
  mode: string | null | undefined
): CalculationRoundingMode {
  return mode === CalculationRoundingMode.FLOOR
    ? CalculationRoundingMode.FLOOR
    : CalculationRoundingMode.ROUND;
}

export function applyRounding(
  value: number,
  mode: CalculationRoundingMode | string = CalculationRoundingMode.ROUND
): number {
  if (!Number.isFinite(value)) return 0;
  const result =
    normalizeRoundingMode(mode) === CalculationRoundingMode.FLOOR
      ? Math.floor(value)
      : Math.round(value);
  return result === 0 ? 0 : result;
}

export function applyCurrencyRounding(
  value: number,
  market: string | null | undefined,
  mode: CalculationRoundingMode | string = CalculationRoundingMode.ROUND
): number {
  if (!Number.isFinite(value)) return 0;
  if (isUsMarket(market)) {
    const scaled = applyRounding(value * 100, mode);
    const result = scaled / 100;
    return result === 0 ? 0 : result;
  }
  return applyRounding(value, mode);
}

export function resolveAccountFeeSettings(
  account: Pick<Account, "feeDiscount" | "minFeeRegular" | "minFeeOddLot"> | null | undefined,
  shared: AccountFeeSettings
): AccountFeeSettings {
  if (!account) {
    return { ...shared };
  }
  return {
    feeDiscount: account.feeDiscount ?? shared.feeDiscount,
    minFeeRegular: account.minFeeRegular ?? shared.minFeeRegular,
    minFeeOddLot: account.minFeeOddLot ?? shared.minFeeOddLot,
  };
}

export function resolveAccountFeeSettingsById(
  accountId: number,
  feeSettingsByAccount: Record<number, AccountFeeSettings>,
  shared: AccountFeeSettings
): AccountFeeSettings {
  return feeSettingsByAccount[accountId] ?? shared;
}

export function validateRestoredAccounts(accounts: Account[]): Account[] {
  if (accounts.length === 0) {
    throw new Error("帳戶清單不可為空");
  }
  const seenIds = new Set<number>();
  return accounts.map((account) => {
    const id = account.id;
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("帳戶 ID 必須大於 0");
    }
    if (seenIds.has(id)) {
      throw new Error(`帳戶 ID 重複：${id}`);
    }
    seenIds.add(id);

    const trimmedName = (account.name ?? "").trim();
    if (!trimmedName) {
      throw new Error("帳戶名稱不可空白");
    }

    const feeDiscount = account.feeDiscount ?? null;
    if (feeDiscount !== null && (!Number.isFinite(feeDiscount) || feeDiscount < 0)) {
      throw new Error("手續費折數必須是非負有限數值");
    }

    const minFeeRegular = account.minFeeRegular ?? null;
    if (minFeeRegular !== null && (!Number.isFinite(minFeeRegular) || minFeeRegular < 0)) {
      throw new Error("整股最低手續費必須是非負有限數值");
    }

    const minFeeOddLot = account.minFeeOddLot ?? null;
    if (minFeeOddLot !== null && (!Number.isFinite(minFeeOddLot) || minFeeOddLot < 0)) {
      throw new Error("零股最低手續費必須是非負有限數值");
    }

    return {
      id,
      name: trimmedName,
      feeDiscount,
      minFeeRegular,
      minFeeOddLot,
    };
  });
}

export function resolveActiveAccountId(
  candidateActiveId: number,
  accounts: readonly Pick<Account, "id">[]
): number {
  if (candidateActiveId === 0) return 0;
  return accounts.some((a) => a.id === candidateActiveId) ? candidateActiveId : 0;
}

const twAmountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const usAmountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shareCountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

export function formatMarketAmount(
  amount: number,
  market: string | null | undefined
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (isUsMarket(market)) {
    const rounded = Math.round(safe * 100) / 100;
    return usAmountFormatter.format(rounded === 0 ? 0 : rounded);
  }
  const rounded = Math.round(safe);
  return twAmountFormatter.format(rounded === 0 ? 0 : rounded);
}

export function formatHomeAmount(
  amount: number,
  displayMode: HomeDisplayMode | string
): string {
  return displayMode === HomeDisplayMode.US
    ? formatMarketAmount(amount, StockMarket.US)
    : formatMarketAmount(amount, StockMarket.TW);
}

export function formatMarketPlainAmount(
  amount: number,
  market: string | null | undefined
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (isUsMarket(market)) {
    const rounded = Math.round(safe * 100) / 100;
    return (rounded === 0 ? 0 : rounded).toFixed(2);
  }
  const rounded = Math.round(safe);
  return (rounded === 0 ? 0 : rounded).toFixed(0);
}

function toPlainDecimalString(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  const str = value.toString();
  if (!/[eE]/.test(str)) {
    return str.includes(".") ? str.replace(/\.?0+$/, "") : str;
  }
  // Convert scientific notation without losing precision for typical share/asset magnitudes.
  const fixed = value.toFixed(12);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export function formatShareInputValue(shares: number): string {
  return toPlainDecimalString(shares);
}

export function formatShareCount(shares: number): string {
  const safe = Number.isFinite(shares) ? shares : 0;
  return shareCountFormatter.format(safe === 0 ? 0 : safe);
}

export function formatAssetInputAmount(amount: number): string {
  return toPlainDecimalString(amount);
}

export function escapeLikePattern(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function minimumTaiwanFee(
  shares: number,
  minFeeRegular: number,
  minFeeOddLot: number
): number {
  return shares % 1000 === 0 ? minFeeRegular : minFeeOddLot;
}

export function calculateTaiwanFee(
  price: number,
  shares: number,
  feeDiscount: number,
  minFeeRegular: number,
  minFeeOddLot: number,
  roundingMode: CalculationRoundingMode | string = CalculationRoundingMode.ROUND
): number {
  const raw = Math.max(
    price * shares * 0.001425 * feeDiscount,
    minimumTaiwanFee(shares, minFeeRegular, minFeeOddLot)
  );
  return applyRounding(raw, roundingMode);
}

export function calculateTaiwanTax(
  price: number,
  shares: number,
  stockType: string,
  isDayTrading: boolean,
  taxRates: TaiwanTaxRates = DEFAULT_TAIWAN_TAX_RATES,
  roundingMode: CalculationRoundingMode | string = CalculationRoundingMode.ROUND,
  isBondEtf = false
): number {
  let rate: number;
  if (isDayTrading) {
    rate = taxRates.dayTrading;
  } else if (isBondEtf) {
    rate = taxRates.bondEtf;
  } else if (stockType.trim().toUpperCase() === "ETF") {
    rate = taxRates.domesticStockEtf;
  } else {
    rate = taxRates.normalListedStock;
  }
  return applyRounding(price * shares * rate, roundingMode);
}

export function calculateTaiwanSupplementaryNhiFee(
  grossDividend: number,
  market: string | null | undefined = StockMarket.TW
): number {
  if (!Number.isFinite(grossDividend) || !isTwMarket(market) || grossDividend <= 20000) {
    return 0;
  }
  return Math.round(grossDividend * 0.0211);
}

export function transactionFeeForType(
  type: TransactionType | string,
  calculatedFee: number,
  dividendFee: number
): number {
  switch (type) {
    case TransactionType.BUY:
    case TransactionType.SELL:
    case TransactionType.MARGIN_BUY:
    case TransactionType.SHORT_SELL:
    case TransactionType.SHORT_COVER:
      return calculatedFee;
    case TransactionType.CASH_DIVIDEND:
      return dividendFee;
    default:
      return 0;
  }
}
