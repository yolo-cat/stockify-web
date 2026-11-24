import type { StockMarket } from "@/types";

export const APP_ROUTES = {
  LOGIN: "/login",
  HOLDINGS: "/holdings",
  TRANSACTIONS: "/transactions",
  ADD_TRANSACTION: "/transactions/new",
  TRANSACTION_DETAIL: "/transactions/:transactionId",
  EDIT_TRANSACTION: "/transactions/:transactionId/edit",
  ASSETS: "/assets",
  DIVIDENDS: "/dividends",
  SETTINGS: "/settings",
  STOCK_DETAIL: "/stocks/:market/:stockCode",
} as const;

export function createStockDetailRoute(
  market: StockMarket | string,
  stockCode: string,
): string {
  const safeMarket = encodeURIComponent(market.trim().toUpperCase() || "TW");
  const safeCode = encodeURIComponent(stockCode.trim().toUpperCase());
  return `/stocks/${safeMarket}/${safeCode}`;
}

export function createTransactionDetailRoute(transactionId: number | string): string {
  return `/transactions/${encodeURIComponent(String(transactionId))}`;
}

export function createEditTransactionRoute(transactionId: number | string): string {
  return `/transactions/${encodeURIComponent(String(transactionId))}/edit`;
}

export function createAddTransactionRoute(params?: {
  stockCode?: string;
  market?: StockMarket | string;
  date?: number;
}): string {
  if (!params) {
    return APP_ROUTES.ADD_TRANSACTION;
  }
  const search = new URLSearchParams();
  if (params.stockCode) {
    search.set("stockCode", params.stockCode.trim().toUpperCase());
  }
  if (params.market) {
    search.set("market", params.market.trim().toUpperCase());
  }
  if (typeof params.date === "number" && Number.isFinite(params.date)) {
    search.set("date", String(params.date));
  }
  const query = search.toString();
  return query ? `${APP_ROUTES.ADD_TRANSACTION}?${query}` : APP_ROUTES.ADD_TRANSACTION;
}
