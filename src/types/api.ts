import type {
  Stock,
  StockDataSource,
  StockExchange,
  StockMarket,
  UsStockDataSource,
} from "./domain";
import type {
  RealtimeStockInfo,
  StockHistoryPoint,
  TaiwanHolidayCalendarAsset,
  TaiwanWeightedIndexInfo,
  UsdTwdExchangeRate,
  YahooDividendSummary,
} from "./market";

export const EDGE_FUNCTIONS = {
  MARKET_QUOTES: "market-quotes",
  MARKET_HISTORY: "market-history",
  MARKET_INDEX: "market-index",
  EXCHANGE_RATE: "exchange-rate",
  TAIWAN_CALENDAR: "taiwan-calendar",
  STOCK_LIST_SYNC: "stock-list-sync",
  DIVIDEND_INFO: "dividend-info",
} as const;
export type EdgeFunctionName =
  (typeof EDGE_FUNCTIONS)[keyof typeof EDGE_FUNCTIONS];

export interface EdgeErrorResponse {
  error: string;
  code?: string;
  details?: string;
}

export interface MarketQuoteTarget {
  market: StockMarket;
  code: string;
  exchange?: StockExchange | string;
  stockType?: string;
}

export interface MarketQuotesRequest {
  stocks: MarketQuoteTarget[];
  preferredTwSource?: StockDataSource;
  preferredUsSource?: UsStockDataSource;
}

export interface MarketQuotesResponse {
  quotes: Record<string, RealtimeStockInfo>;
  fallbackUsed: boolean;
  certificateFailure: boolean;
  errors?: Record<string, string>;
}

export interface MarketHistoryRequest {
  market: StockMarket;
  code: string;
  exchange?: StockExchange | string;
  stockType?: string;
  fromDate: string;
  toDate: string;
  months?: string[];
  forceRefreshCurrentMonth?: boolean;
}

export interface MarketHistoryResponse {
  market: StockMarket;
  code: string;
  points: StockHistoryPoint[];
  resolvedStockType?: string;
  fromCache?: boolean;
}

export interface MarketIndexRequest {
  preferredSource?: StockDataSource;
}

export interface MarketIndexResponse {
  index: TaiwanWeightedIndexInfo;
  fallbackUsed: boolean;
}

export type ExchangeRateRequest = Record<string, never>;

export interface ExchangeRateResponse {
  exchangeRate: UsdTwdExchangeRate;
}

export interface TaiwanCalendarRequest {
  year: number;
}

export interface TaiwanCalendarResponse {
  year: number;
  calendar: TaiwanHolidayCalendarAsset;
}

export interface StockListSyncRequest {
  market: StockMarket;
}

export interface StockListSyncResponse {
  market: StockMarket;
  syncedCount: number;
  updatedAtMillis: number;
  stocks?: Stock[];
}

export interface DividendInfoRequest {
  stockCodes: string[];
}

export interface DividendInfoResponse {
  results: Record<string, YahooDividendSummary | null>;
  errors?: Record<string, string>;
}
