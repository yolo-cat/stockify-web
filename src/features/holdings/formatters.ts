import { formatHomeAmount, formatMarketAmount, isUsMarket } from "@/domain";
import { HomeDisplayMode, StockMarket } from "@/types";

export function plColorClass(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-6) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-stock-gain" : "text-stock-loss";
}

export function formatSignedHomeAmount(
  amount: number,
  displayMode: HomeDisplayMode | string,
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const prefix = safe > 0 ? "+" : safe < 0 ? "-" : "";
  const currencyPrefix = displayMode === HomeDisplayMode.US ? "$" : "";
  return `${prefix}${currencyPrefix}${formatHomeAmount(Math.abs(safe), displayMode)}`;
}

export function formatSignedMarketAmount(
  amount: number,
  market: StockMarket | string,
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const prefix = safe > 0 ? "+" : safe < 0 ? "-" : "";
  const currencyPrefix = isUsMarket(market) ? "$" : "";
  return `${prefix}${currencyPrefix}${formatMarketAmount(Math.abs(safe), market)}`;
}

export function formatCurrencyAmount(
  amount: number,
  market: StockMarket | string,
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const currencyPrefix = isUsMarket(market) ? "$" : "";
  return `${currencyPrefix}${formatMarketAmount(safe, market)}`;
}

export function formatHomeCurrencyAmount(
  amount: number,
  displayMode: HomeDisplayMode | string,
): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const currencyPrefix = displayMode === HomeDisplayMode.US ? "$" : "";
  return `${currencyPrefix}${formatHomeAmount(safe, displayMode)}`;
}

export function formatSignedPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const prefix = safe > 0 ? "+" : "";
  return `${prefix}${safe.toFixed(2)}%`;
}

export function formatCompactAmount(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) < 1e-6) return "0";
  const sign = amount > 0 ? "+" : "-";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function formatQuoteTimestamp(epochMillis: number | null | undefined): string {
  if (!epochMillis || !Number.isFinite(epochMillis) || epochMillis <= 0) {
    return "--/-- --:--:--";
  }
  const d = new Date(epochMillis);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}:${ss}`;
}

export function formatPrice(
  price: number,
  market: StockMarket | string,
): string {
  const safe = Number.isFinite(price) ? price : 0;
  if (isUsMarket(market)) {
    return `$${safe.toFixed(2)}`;
  }
  return safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
