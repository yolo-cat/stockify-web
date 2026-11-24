import { GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { formatShareCount, isUsMarket, stockCacheKey } from "@/domain";
import { createStockDetailRoute } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { LimitState, type HoldingInfo } from "@/types";
import {
  formatCurrencyAmount,
  formatPrice,
  formatSignedMarketAmount,
  formatSignedPercent,
  plColorClass,
} from "./formatters";

interface HoldingCardProps {
  holding: HoldingInfo;
  isManualSort: boolean;
  partialSalesAsRealized: boolean;
  onDragStart?: (key: string) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (targetKey: string) => void;
}

export function HoldingCard({
  holding,
  isManualSort,
  partialSalesAsRealized,
  onDragStart,
  onDragOver,
  onDrop,
}: HoldingCardProps) {
  const { stock } = holding;
  const key = stockCacheKey(stock.market, stock.code);
  const isUs = isUsMarket(stock.market);

  const displayPL =
    partialSalesAsRealized && holding.profitLossBreakdown
      ? holding.isRealizedSlice
        ? holding.profitLossBreakdown.realizedProfitLoss
        : holding.profitLossBreakdown.unrealizedProfitLoss
      : holding.totalPL;

  const displayPLPct =
    partialSalesAsRealized && holding.profitLossBreakdown
      ? holding.isRealizedSlice
        ? holding.profitLossBreakdown.realizedPercentage
        : holding.profitLossBreakdown.unrealizedPercentage
      : holding.totalPLPercentage;

  const hasMargin =
    holding.marginOutstandingPrincipal > 1e-6 ||
    holding.marginAccruedInterest > 1e-6;
  const hasShort = holding.shortOutstandingShares > 1e-6;

  return (
    <div
      draggable={isManualSort}
      onDragStart={() => isManualSort && onDragStart?.(key)}
      onDragOver={(e) => {
        if (isManualSort) {
          e.preventDefault();
          onDragOver?.(e);
        }
      }}
      onDrop={() => isManualSort && onDrop?.(key)}
      data-holding-key={key}
      className={cn(
        "group relative rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm transition-colors hover:border-primary/40",
        isManualSort && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        {isManualSort && (
          <div
            className="mt-1 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground"
            aria-label="拖曳排序"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        <Link
          to={createStockDetailRoute(stock.market, stock.code)}
          className="min-w-0 flex-1 space-y-2"
        >
          {/* Top row: Stock identity + single-line non-wrapping price/change */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold sm:text-base">
                  {stock.name || stock.code}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {isUs ? "US" : "TW"} {stock.code}
                </span>
                {hasMargin && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    融資
                  </span>
                )}
                {hasShort && (
                  <span className="shrink-0 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                    融券
                  </span>
                )}
                {holding.limitState === LimitState.LIMIT_UP && (
                  <span className="shrink-0 rounded bg-stock-gain/15 px-1.5 py-0.5 text-[10px] font-semibold text-stock-gain">
                    漲停
                  </span>
                )}
                {holding.limitState === LimitState.LIMIT_DOWN && (
                  <span className="shrink-0 rounded bg-stock-loss/15 px-1.5 py-0.5 text-[10px] font-semibold text-stock-loss">
                    跌停
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                <span>{formatShareCount(holding.shares)} 股</span>
                <span>·</span>
                <span>均價 {formatPrice(holding.averageCost, stock.market)}</span>
              </div>
            </div>

            {/* Single-line adaptive price + daily change */}
            <div className="shrink-0 text-right">
              <div className="whitespace-nowrap text-sm font-bold tabular-nums sm:text-base">
                {formatPrice(holding.currentPrice, stock.market)}
              </div>
              <div
                className={cn(
                  "whitespace-nowrap text-[11px] font-medium tabular-nums sm:text-xs",
                  plColorClass(holding.dailyChange),
                )}
              >
                {holding.dailyChange > 0 ? "+" : ""}
                {holding.dailyChange.toFixed(2)} (
                {formatSignedPercent(holding.dailyChangePercentage)})
              </div>
            </div>
          </div>

          {/* Bottom row: Market value & Total P&L */}
          <div className="flex items-center justify-between border-t pt-2 text-xs tabular-nums">
            <div className="text-muted-foreground">
              市值{" "}
              <span className="font-semibold text-foreground">
                {formatCurrencyAmount(holding.marketValue, stock.market)}
              </span>
            </div>
            <div className={cn("font-semibold whitespace-nowrap", plColorClass(displayPL))}>
              {formatSignedMarketAmount(displayPL, stock.market)} (
              {formatSignedPercent(displayPLPct)})
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
