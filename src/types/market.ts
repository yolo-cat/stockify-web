import type { StockExchange, StockMarket } from "./domain";

export const LimitState = {
  LIMIT_UP: "LIMIT_UP",
  LIMIT_DOWN: "LIMIT_DOWN",
  NONE: "NONE",
} as const;
export type LimitState = (typeof LimitState)[keyof typeof LimitState];

export interface RealtimeStockInfo {
  currentPrice: number;
  change: number;
  changePercent: number;
  lastUpdated: number;
  limitState: LimitState;
}

export interface QuoteFetchOutcome {
  info: RealtimeStockInfo | null;
  fallbackUsed: boolean;
  certificateFailure: boolean;
}

export interface QuoteBatchOutcome {
  infos: Record<string, RealtimeStockInfo>;
  certificateFailure: boolean;
}

export interface QuoteFetchResult {
  key: string;
  outcome: QuoteFetchOutcome;
}

export interface StockHistoryPoint {
  date: string;
  price: number;
}

export interface StockHistoryPrice {
  stockCode: string;
  market: StockMarket;
  date: string;
  price: number;
}

export interface TaiwanWeightedIndexInfo {
  name: string;
  current: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  updatedAtMillis: number;
  change: number;
  changePercent: number;
}

export interface UsdTwdExchangeRate {
  rate: number;
  updatedAtMillis: number;
  source: string;
}

export interface TaiwanHolidayItem {
  date: string;
  week: string;
  isHoliday: boolean;
  description: string;
}

export interface TaiwanHolidayCalendarAsset {
  calendarVersion: number;
  source: string;
  items: TaiwanHolidayItem[];
}

export interface TaiwanHolidayCalendarSnapshot {
  year: number;
  calendarVersion: number;
  updatedAtEpochMillis: number;
  holidays: Record<string, boolean>;
  source: string;
}

export interface BundledStockRecord {
  name: string;
  code: string;
  market: StockExchange | StockMarket | string;
  industry: string;
  stockType: string;
}

export interface DividendResult {
  amount: number;
  date: string;
}

export interface YahooDividendSummary {
  cashDividend: DividendResult | null;
  stockDividend: DividendResult | null;
}

export interface DividendInfoCacheEntry {
  cashDividend: number | null;
  cashDividendDate: string | null;
  stockDividend: number | null;
  stockDividendDate: string | null;
  lastFetchedDate: string | null;
  lastFetchedTimeMillis: number | null;
  requestSequence: number | null;
}

export interface DividendItemUiState {
  stockCode: string;
  stockName: string;
  cashDividend: number | null;
  cashDividendDate: string | null;
  stockDividend: number | null;
  stockDividendDate: string | null;
  lastLocalCashDividend: number | null;
  lastLocalCashDividendDate: string | null;
  lastLocalStockDividend: number | null;
  lastLocalStockDividendDate: string | null;
  isLoading: boolean;
  errorMessage: string | null;
}
