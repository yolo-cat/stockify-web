import type { DividendInfoCacheEntry, LimitState } from "./market";

export const StockMarket = {
  TW: "TW",
  US: "US",
} as const;
export type StockMarket = (typeof StockMarket)[keyof typeof StockMarket];

export const StockExchange = {
  UNKNOWN: "",
  LISTED: "上市",
  OTC: "上櫃",
  EMERGING: "興櫃",
} as const;
export type StockExchange = (typeof StockExchange)[keyof typeof StockExchange];

export const TransactionType = {
  BUY: "買進",
  SELL: "賣出",
  CASH_DIVIDEND: "配息",
  STOCK_DIVIDEND: "配股",
  CAPITAL_REDUCTION: "減資",
  STOCK_SPLIT: "分割",
  MARGIN_BUY: "融資買進",
  MARGIN_REPAYMENT: "融資還款",
  SHORT_SELL: "融券賣出",
  SHORT_COVER: "買券還券",
  SHORT_COMPENSATION: "融券補償",
} as const;
export type TransactionType =
  (typeof TransactionType)[keyof typeof TransactionType];

export const STANDARD_TRANSACTION_TYPES: readonly TransactionType[] = [
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.CASH_DIVIDEND,
  TransactionType.STOCK_DIVIDEND,
  TransactionType.CAPITAL_REDUCTION,
  TransactionType.STOCK_SPLIT,
];

export const FINANCING_TRANSACTION_TYPES: readonly TransactionType[] = [
  TransactionType.MARGIN_BUY,
  TransactionType.MARGIN_REPAYMENT,
  TransactionType.SHORT_SELL,
  TransactionType.SHORT_COVER,
  TransactionType.SHORT_COMPENSATION,
];

export const ALL_TRANSACTION_TYPES: readonly TransactionType[] = [
  ...STANDARD_TRANSACTION_TYPES,
  ...FINANCING_TRANSACTION_TYPES,
];

export const HomeDisplayMode = {
  TW: "TW",
  US: "US",
  COMBINED: "COMBINED",
} as const;
export type HomeDisplayMode =
  (typeof HomeDisplayMode)[keyof typeof HomeDisplayMode];

export const ReturnRateMode = {
  REMAINING_POSITION: "REMAINING_POSITION",
  CUMULATIVE_INVESTMENT: "CUMULATIVE_INVESTMENT",
  XIRR: "XIRR",
} as const;
export type ReturnRateMode =
  (typeof ReturnRateMode)[keyof typeof ReturnRateMode];

export const CalculationRoundingMode = {
  ROUND: "ROUND",
  FLOOR: "FLOOR",
} as const;
export type CalculationRoundingMode =
  (typeof CalculationRoundingMode)[keyof typeof CalculationRoundingMode];

export const TextSizeMode = {
  EXTRA_SMALL: "EXTRA_SMALL",
  SMALL: "SMALL",
  DEFAULT: "DEFAULT",
  LARGE: "LARGE",
  EXTRA_LARGE: "EXTRA_LARGE",
} as const;
export type TextSizeMode = (typeof TextSizeMode)[keyof typeof TextSizeMode];

export const ThemeMode = {
  SYSTEM: "System",
  LIGHT: "Light",
  DARK: "Dark",
  AMOLED: "AMOLED",
} as const;
export type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode];

export const HomeHoldingsSortMode = {
  MANUAL: "MANUAL",
  COLUMN: "COLUMN",
} as const;
export type HomeHoldingsSortMode =
  (typeof HomeHoldingsSortMode)[keyof typeof HomeHoldingsSortMode];

export const HomeHoldingsSortColumn = {
  NONE: "NONE",
  MARKET_VALUE: "MARKET_VALUE",
  DAILY_PL: "DAILY_PL",
  TOTAL_PL: "TOTAL_PL",
  RETURN_RATE: "RETURN_RATE",
} as const;
export type HomeHoldingsSortColumn =
  (typeof HomeHoldingsSortColumn)[keyof typeof HomeHoldingsSortColumn];

export const StockDataSource = {
  TWSE: "TWSE",
  YAHOO: "Yahoo",
} as const;
export type StockDataSource =
  (typeof StockDataSource)[keyof typeof StockDataSource];

export const UsStockDataSource = {
  NASDAQ: "Nasdaq",
  YAHOO: "Yahoo",
} as const;
export type UsStockDataSource =
  (typeof UsStockDataSource)[keyof typeof UsStockDataSource];

export interface StockKey {
  market: StockMarket;
  code: string;
}

export interface Stock {
  name: string;
  code: string;
  market: StockMarket;
  exchange: StockExchange | string;
  industry: string;
  stockType: string;
}

export interface Account {
  id: number;
  name: string;
  feeDiscount: number | null;
  minFeeRegular: number | null;
  minFeeOddLot: number | null;
}

export interface AccountFeeSettings {
  feeDiscount: number;
  minFeeRegular: number;
  minFeeOddLot: number;
}

export interface StockTransaction {
  id: number;
  stockCode: string;
  market: StockMarket;
  accountId: number;
  date: number;
  recordTime: number;
  type: TransactionType;
  buyPrice: number;
  buyShares: number;
  sellPrice: number;
  sellShares: number;
  fee: number;
  tax: number;
  income: number;
  expense: number;
  cashDividend: number;
  exDividendShares: number;
  dividendIncome: number;
  supplementaryHealthInsurancePremium: number;
  stockDividend: number;
  dividendShares: number;
  exRightsShares: number;
  note: string;
  capitalReductionRatio: number;
  sharesBeforeReduction: number;
  sharesAfterReduction: number;
  cashReturned: number;
  stockSplitRatio: number;
  sharesBeforeSplit: number;
  sharesAfterSplit: number;
  marginPrincipal: number;
  marginAnnualRate: number;
  marginLotId: string;
  marginRepaymentLotId: string;
  marginRepayment: number;
  marginSelfFunded: number;
  marginSelfFundedOverridden: boolean;
  marginActualInterest: number;
  shortBorrowPrincipal: number;
  shortBorrowAnnualRate: number;
  shortLotId: string;
  shortCoverLotId: string;
  shortCoverShares: number;
  shortCompensationLotId: string;
  shortCompensation: number;
}

export interface TransactionWithStock {
  transaction: StockTransaction;
  stock: Stock;
}

export interface TransactionUiState {
  transaction: StockTransaction;
  stockName: string;
  market: StockMarket | "";
}

export interface BankDeposit {
  id: number;
  name: string;
  amount: number;
}

export interface Loan {
  id: number;
  name: string;
  amount: number;
}

export interface AssetBalances {
  bankDeposits: BankDeposit[];
  loans: Loan[];
}

export interface AssetBalanceBackup {
  format: "stockify.asset-balances";
  version: 1;
  bankDeposits: BankDeposit[];
  loans: Loan[];
}

export interface HoldingsOrderData {
  order: string[];
  realizedOrder: string[];
}

export interface HoldingsOrderBackup {
  version: 1;
  order: string[];
  realizedOrder: string[];
}

export interface UserSettings {
  refreshInterval: number;
  feeDiscount: number;
  minFeeRegular: number;
  minFeeOddLot: number;
  dividendFee: number;
  preDeductSellFees: boolean;
  partialSalesAsRealized: boolean;
  excludeDividendIncomeFromReturns: boolean;
  returnRateMode: ReturnRateMode;
  calculationRoundingMode: CalculationRoundingMode;
  theme: ThemeMode;
  textSizeMode: TextSizeMode;
  stockDataSource: StockDataSource;
  usStockDataSource: UsStockDataSource;
  notifyFallbackRepeatedly: boolean;
  taxRateNormalListedStock: number;
  taxRateDomesticStockEtf: number;
  taxRateBondEtf: number;
  taxRateDayTrading: number;
  usdToTwdRate: number;
  homeDisplayMode: HomeDisplayMode;
  homeHoldingsSortMode: HomeHoldingsSortMode;
  homeHoldingsSortColumn: HomeHoldingsSortColumn | string;
  homeHoldingsSortAscending: boolean;
  activeAccountId: number;
  showTaiwanWeightedIndex: boolean;
  showTaiwanPortfolioChart: boolean;
  homeHistoryChartExpanded: boolean;
  detailHistoryChartExpanded: boolean;
  marginFeatureEnabled: boolean;
  marginDayCount: 360 | 365;
  defaultMarginAnnualRate: number;
  defaultShortBorrowAnnualRate: number;
  lastUpdateHighlightsVersion: string | null;
  dividendInfoCache: Record<string, DividendInfoCacheEntry>;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  refreshInterval: 10,
  feeDiscount: 0.28,
  minFeeRegular: 1,
  minFeeOddLot: 1,
  dividendFee: 10,
  preDeductSellFees: true,
  partialSalesAsRealized: false,
  excludeDividendIncomeFromReturns: false,
  returnRateMode: ReturnRateMode.REMAINING_POSITION,
  calculationRoundingMode: CalculationRoundingMode.ROUND,
  theme: ThemeMode.SYSTEM,
  textSizeMode: TextSizeMode.DEFAULT,
  stockDataSource: StockDataSource.TWSE,
  usStockDataSource: UsStockDataSource.NASDAQ,
  notifyFallbackRepeatedly: false,
  taxRateNormalListedStock: 0.003,
  taxRateDomesticStockEtf: 0.001,
  taxRateBondEtf: 0.0,
  taxRateDayTrading: 0.0015,
  usdToTwdRate: 32.0,
  homeDisplayMode: HomeDisplayMode.COMBINED,
  homeHoldingsSortMode: HomeHoldingsSortMode.MANUAL,
  homeHoldingsSortColumn: HomeHoldingsSortColumn.NONE,
  homeHoldingsSortAscending: true,
  activeAccountId: 0,
  showTaiwanWeightedIndex: true,
  showTaiwanPortfolioChart: true,
  homeHistoryChartExpanded: true,
  detailHistoryChartExpanded: true,
  marginFeatureEnabled: false,
  marginDayCount: 365,
  defaultMarginAnnualRate: 6.45,
  defaultShortBorrowAnnualRate: 3.5,
  lastUpdateHighlightsVersion: null,
  dividendInfoCache: {},
};

export interface PositionInvestmentBasis {
  remaining: number;
  cumulative: number;
}

export interface LongPositionReplaySummary {
  shares: number;
  totalBuyExpense: number;
  totalSellIncome: number;
  totalSellNetIncome: number;
  sellSharesTotal: number;
  sellAmountBeforeFee: number;
  totalDividendIncome: number;
  buySharesTotal: number;
  buyCostTotal: number;
}

export interface MarginLotSummary {
  lotId: string;
  openedAt: number;
  annualRate: number;
  originalPrincipal: number;
  remainingPrincipal: number;
  accruedInterest: number;
}

export interface MarginSummary {
  outstandingPrincipal: number;
  accruedInterest: number;
  lots: MarginLotSummary[];
  selfFundedCapital: number;
  cashBalance: number;
  actualInterestPaid: number;
  totalInterestExpense: number;
}

export interface ShortLotSummary {
  lotId: string;
  openedAt: number;
  annualRate: number;
  originalShares: number;
  remainingShares: number;
  originalPrincipal: number;
  accruedBorrowFee: number;
}

export interface ShortSellingSummary {
  outstandingShares: number;
  accruedBorrowFee: number;
  compensationExpense: number;
  lots: ShortLotSummary[];
  openedPrincipal: number;
  cumulativeOpenedPrincipal: number;
}

export interface ProfitLossBreakdown {
  realizedProfitLoss: number;
  unrealizedProfitLoss: number;
  realizedCost: number;
  unrealizedCost: number;
  soldShares: number;
  coveredShortShares: number;
  realizedBuyAverage: number;
  realizedSellAverage: number;
  unrealizedAverageCost: number;
  hasRealizedActivity: boolean;
  realizedPercentage: number;
  unrealizedPercentage: number;
}

export interface CashFlow {
  dateMillis: number;
  amount: number;
}

export interface HoldingCalculationInputs {
  stock: Stock;
  transactions: StockTransaction[];
  currentPrice: number;
  dailyChange: number;
  dailyChangePercentage: number;
  limitState: LimitState;
  preDeductSellFees: boolean;
  feeSettingsByAccount: Record<number, AccountFeeSettings>;
  sharedFeeSettings: AccountFeeSettings;
  returnRateMode: ReturnRateMode;
  currentDateMillis: number;
  marginDayCount: number;
  includeProfitLossBreakdown?: boolean;
  excludeDividendIncomeFromReturns?: boolean;
}

export interface HoldingInfo {
  stock: Stock;
  shares: number;
  currentPrice: number;
  averageCost: number;
  buyAverage: number;
  totalInvestment: number;
  remainingPositionInvestment: number;
  sellAverage: number;
  totalPL: number;
  totalPLPercentage: number;
  dailyChange: number;
  dailyChangePercentage: number;
  dividendIncome: number;
  marketValue: number;
  limitState: LimitState;
  marginOutstandingPrincipal: number;
  marginAccruedInterest: number;
  marginNetEquity: number;
  shortOutstandingShares: number;
  shortMarketLiability: number;
  shortAccruedBorrowFee: number;
  shortCompensationExpense: number;
  profitLossBreakdown: ProfitLossBreakdown | null;
  isRealizedSlice: boolean;
}

export interface AssetStockValue {
  stock: Stock;
  marketValue: number;
}

export interface HoldingsUiState {
  cumulativePL: number;
  cumulativePLPercentage: number;
  dailyPL: number;
  marketValue: number;
  taiwanMarketValue: number;
  usMarketValue: number;
  totalCost: number;
  dividendIncome: number;
  holdings: HoldingInfo[];
  assetStockValues: AssetStockValue[];
  sellAverage: number;
}

export const HistoryRange = {
  ONE_MONTH: "ONE_MONTH",
  SIX_MONTHS: "SIX_MONTHS",
  ONE_YEAR: "ONE_YEAR",
} as const;
export type HistoryRange = (typeof HistoryRange)[keyof typeof HistoryRange];

export interface PersonalHistoryPoint {
  date: string;
  price: number;
  shares: number;
  marketValue: number;
  totalPL: number;
  totalPLPercentage: number;
}

export type HistoryState =
  | { status: "idle" }
  | { status: "loading"; progress: number; statusText: string }
  | { status: "success"; range: HistoryRange; points: PersonalHistoryPoint[] }
  | { status: "empty"; range: HistoryRange; message: string }
  | { status: "error"; message: string };

export interface DailyPerformance {
  date: string;
  profitLoss: number;
  returnPercentage: number;
  portfolioValue: number;
  previousPortfolioValue: number;
  externalCashFlow: number;
}

export interface MonthlyPerformance {
  yearMonth: string;
  profitLoss: number;
  returnPercentage: number;
  dailyItems: DailyPerformance[];
}

export interface AssetOverviewUiState {
  taiwanStockValue: number;
  usStockValue: number;
  stockValues: AssetStockValue[];
  bankDeposits: BankDeposit[];
  loans: Loan[];
  totalBankDeposit: number;
  totalLoan: number;
  grossAssets: number;
  netAssets: number;
}

export interface TransactionDateCashFlowTotal {
  market: StockMarket;
  income: number;
  expense: number;
}

export interface TransactionDateSection {
  date: string;
  transactions: TransactionUiState[];
  cashFlowTotals: TransactionDateCashFlowTotal[];
}

export interface TransactionsUiState {
  accountId: number;
  query: string;
  isLoading: boolean;
  sections: TransactionDateSection[];
  totalCount: number;
  resultCount: number;
}

export interface MarginLotOption {
  lotId: string;
  label: string;
  remainingPrincipal: number;
}

export interface ShortLotOption {
  lotId: string;
  label: string;
  remainingShares: number;
}

export interface CsvTransaction {
  stockName: string;
  stockCode: string;
  market: StockMarket;
  transaction: StockTransaction;
  sourceRowNumber?: number | null;
  sourceId?: string;
}

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}
