import { useEffect, useId, useMemo, useState } from "react";
import { Calendar, ChevronDown, ChevronUp, LineChart as LineChartIcon, Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildPortfolioHistorySeries,
  buildStockHistorySeries,
  canonicalStockCode,
  compareTransactions,
  isUsMarket,
  normalizeMarket,
  rangeToMonths,
  resolveHistoryCutoffDate,
  stockCacheKey,
  targetHistoryMonths,
} from "@/domain";
import {
  formatHomeCurrencyAmount,
  formatSignedHomeAmount,
  formatSignedMarketAmount,
  formatSignedPercent,
  plColorClass,
} from "@/features/holdings/formatters";
import { cn } from "@/lib/utils";
import { invokeMarketHistory } from "@/services";
import {
  HistoryRange,
  HomeDisplayMode,
  type AccountFeeSettings,
  type HistoryState,
  type PersonalHistoryPoint,
  type Stock,
  type StockHistoryPoint,
  type StockTransaction,
  type UserSettings,
} from "@/types";
import { PerformanceCalendarSection } from "./PerformanceCalendarSection";

type ChartMetric = "RETURN" | "MARKET_VALUE";
type HomeChartTab = "CURVE" | "CALENDAR";

const RANGE_OPTIONS: Array<{ value: HistoryRange; label: string }> = [
  { value: HistoryRange.ONE_MONTH, label: "1M" },
  { value: HistoryRange.SIX_MONTHS, label: "6M" },
  { value: HistoryRange.ONE_YEAR, label: "1Y" },
];

const historyPointsCache = new Map<string, StockHistoryPoint[]>();

function computeFromDate(monthsBack: number, cutoffDate: string): string {
  const [y, m, d] = cutoffDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - monthsBack, d));
  return dt.toISOString().slice(0, 10);
}

async function fetchStockHistoryWithLimit(
  targets: Array<{
    stock: Stock;
    fromDate: string;
    toDate: string;
    months: string[];
    forceRefreshCurrentMonth: boolean;
  }>,
  onProgress: (completed: number, total: number) => void,
): Promise<Record<string, StockHistoryPoint[]>> {
  const results: Record<string, StockHistoryPoint[]> = {};
  let completed = 0;
  const total = targets.length;
  const concurrency = Math.min(3, Math.max(1, total));
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const t = targets[idx];
      const key = stockCacheKey(t.stock.market, t.stock.code);
      const cacheKey = `${key}:${t.fromDate}:${t.toDate}`;

      if (!t.forceRefreshCurrentMonth && historyPointsCache.has(cacheKey)) {
        results[key] = historyPointsCache.get(cacheKey)!;
      } else {
        try {
          const res = await invokeMarketHistory({
            market: t.stock.market,
            code: t.stock.code,
            exchange: t.stock.exchange,
            stockType: t.stock.stockType,
            fromDate: t.fromDate,
            toDate: t.toDate,
            months: t.months,
            forceRefreshCurrentMonth: t.forceRefreshCurrentMonth,
          });
          historyPointsCache.set(cacheKey, res.points);
          results[key] = res.points;
        } catch {
          results[key] = historyPointsCache.get(cacheKey) ?? [];
        }
      }
      completed++;
      onProgress(completed, total);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

type HistoryChartSectionProps = (
  | {
      mode: "portfolio";
      stocks: readonly Stock[];
      transactions: readonly StockTransaction[];
      displayMode: HomeDisplayMode | string;
      usdToTwdRate: number;
    }
  | {
      mode: "stock";
      stock: Stock;
      transactions: readonly StockTransaction[];
    }
) & {
  settings: UserSettings;
  feeSettingsByAccount: Record<number, AccountFeeSettings>;
  sharedFeeSettings: AccountFeeSettings;
  updateSettings: (partial: Partial<UserSettings>) => Promise<UserSettings>;
  refreshNonce?: number;
};

export function HistoryChartSection(props: HistoryChartSectionProps) {
  const gradientId = useId().replace(/:/g, "");
  const isPortfolio = props.mode === "portfolio";
  const expanded = isPortfolio
    ? props.settings.homeHistoryChartExpanded
    : props.settings.detailHistoryChartExpanded;

  const [homeTab, setHomeTab] = useState<HomeChartTab>("CURVE");
  const [metric, setMetric] = useState<ChartMetric>("RETURN");
  const [range, setRange] = useState<HistoryRange>(HistoryRange.SIX_MONTHS);
  const [historyState, setHistoryState] = useState<HistoryState>({ status: "idle" });
  const [hoveredPoint, setHoveredPoint] = useState<PersonalHistoryPoint | null>(null);

  const effectiveRange =
    isPortfolio && homeTab === "CALENDAR" ? HistoryRange.ONE_YEAR : range;

  const toggleExpanded = () => {
    if (isPortfolio) {
      void props.updateSettings({ homeHistoryChartExpanded: !expanded });
    } else {
      void props.updateSettings({ detailHistoryChartExpanded: !expanded });
    }
  };

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    const run = async () => {
      const nowMillis = Date.now();
      const monthsCount = rangeToMonths(effectiveRange);

      if (props.mode === "stock") {
        const stock = props.stock;
        const txs = props.transactions.slice().sort(compareTransactions);
        if (txs.length === 0) {
          setHistoryState({
            status: "empty",
            range: effectiveRange,
            message: "尚無交易紀錄",
          });
          return;
        }

        setHistoryState({
          status: "loading",
          progress: 0.2,
          statusText: `載入 ${stock.code} 歷史股價中...`,
        });

        const cutoffDate = resolveHistoryCutoffDate(nowMillis, stock.market);
        const fromDate = computeFromDate(monthsCount, cutoffDate);
        const months = targetHistoryMonths(monthsCount, cutoffDate.slice(0, 7));

        const fetched = await fetchStockHistoryWithLimit(
          [
            {
              stock,
              fromDate,
              toDate: cutoffDate,
              months,
              forceRefreshCurrentMonth: (props.refreshNonce ?? 0) > 0,
            },
          ],
          () => undefined,
        );
        if (cancelled) return;

        const key = stockCacheKey(stock.market, stock.code);
        const points = buildStockHistorySeries({
          stock,
          transactions: txs,
          historyPoints: fetched[key] ?? [],
          returnRateMode: props.settings.returnRateMode,
          preDeductSellFees: props.settings.preDeductSellFees,
          feeSettingsByAccount: props.feeSettingsByAccount,
          sharedFeeSettings: props.sharedFeeSettings,
          marginDayCount: props.settings.marginDayCount,
          excludeDividendIncomeFromReturns:
            props.settings.excludeDividendIncomeFromReturns,
          taxRates: {
            normalListedStock: props.settings.taxRateNormalListedStock,
            domesticStockEtf: props.settings.taxRateDomesticStockEtf,
            bondEtf: props.settings.taxRateBondEtf,
            dayTrading: props.settings.taxRateDayTrading,
          },
          cutoffDate,
        });

        if (points.length === 0) {
          setHistoryState({
            status: "empty",
            range: effectiveRange,
            message: "此時段尚無足夠歷史股價資料",
          });
        } else {
          setHistoryState({ status: "success", range: effectiveRange, points });
        }
        return;
      }

      // Portfolio mode
      const grouped = new Map<string, StockTransaction[]>();
      for (const tx of props.transactions) {
        const m = normalizeMarket(tx.market);
        const c = canonicalStockCode(tx.stockCode);
        if (!c) continue;
        if (props.displayMode === HomeDisplayMode.TW && isUsMarket(m)) continue;
        if (props.displayMode === HomeDisplayMode.US && !isUsMarket(m)) continue;
        const key = stockCacheKey(m, c);
        const arr = grouped.get(key) ?? [];
        arr.push(tx);
        grouped.set(key, arr);
      }

      if (grouped.size === 0) {
        setHistoryState({
          status: "empty",
          range: effectiveRange,
          message: "目前模式尚無持股交易紀錄",
        });
        return;
      }

      const stockLookup = new Map<string, Stock>();
      for (const s of props.stocks) {
        stockLookup.set(stockCacheKey(s.market, s.code), s);
      }

      const scopedStocks: Stock[] = [];
      const transactionsByStockKey: Record<string, StockTransaction[]> = {};
      for (const [key, txs] of grouped.entries()) {
        const [mkt, code] = key.split(":");
        const found = stockLookup.get(key) ?? {
          market: normalizeMarket(mkt),
          code,
          name: code,
          exchange: "",
          industry: "",
          stockType: "",
        };
        scopedStocks.push(found);
        transactionsByStockKey[key] = txs.slice().sort(compareTransactions);
      }

      setHistoryState({
        status: "loading",
        progress: 0,
        statusText: `載入歷史股價 (0/${scopedStocks.length})...`,
      });

      const targets = scopedStocks.map((s) => {
        const cutoff = resolveHistoryCutoffDate(nowMillis, s.market);
        return {
          stock: s,
          fromDate: computeFromDate(monthsCount, cutoff),
          toDate: cutoff,
          months: targetHistoryMonths(monthsCount, cutoff.slice(0, 7)),
          forceRefreshCurrentMonth: (props.refreshNonce ?? 0) > 0,
        };
      });

      const historyByStockKey = await fetchStockHistoryWithLimit(
        targets,
        (completed, total) => {
          if (!cancelled) {
            setHistoryState({
              status: "loading",
              progress: total > 0 ? completed / total : 1,
              statusText: `載入歷史股價 (${completed}/${total})...`,
            });
          }
        },
      );
      if (cancelled) return;

      const cutoffDate = resolveHistoryCutoffDate(
        nowMillis,
        props.displayMode === HomeDisplayMode.US ? "US" : "TW",
      );

      const points = buildPortfolioHistorySeries({
        stocks: scopedStocks,
        transactionsByStockKey,
        historyByStockKey,
        displayMode: props.displayMode,
        usdToTwdRate: props.usdToTwdRate,
        returnRateMode: props.settings.returnRateMode,
        preDeductSellFees: props.settings.preDeductSellFees,
        feeSettingsByAccount: props.feeSettingsByAccount,
        sharedFeeSettings: props.sharedFeeSettings,
        marginDayCount: props.settings.marginDayCount,
        excludeDividendIncomeFromReturns:
          props.settings.excludeDividendIncomeFromReturns,
        taxRates: {
          normalListedStock: props.settings.taxRateNormalListedStock,
          domesticStockEtf: props.settings.taxRateDomesticStockEtf,
          bondEtf: props.settings.taxRateBondEtf,
          dayTrading: props.settings.taxRateDayTrading,
        },
        cutoffDate,
      });

      if (points.length === 0) {
        setHistoryState({
          status: "empty",
          range: effectiveRange,
          message: "此時段尚無足夠歷史股價資料",
        });
      } else {
        setHistoryState({ status: "success", range: effectiveRange, points });
      }
    };

    void run().catch((err: unknown) => {
      if (!cancelled) {
        setHistoryState({
          status: "error",
          message: err instanceof Error ? err.message : "載入歷史走勢失敗",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    expanded,
    effectiveRange,
    props.mode,
    props.transactions,
    props.settings.returnRateMode,
    props.settings.preDeductSellFees,
    props.settings.marginDayCount,
    props.settings.excludeDividendIncomeFromReturns,
    props.settings.taxRateNormalListedStock,
    props.settings.taxRateDomesticStockEtf,
    props.settings.taxRateBondEtf,
    props.settings.taxRateDayTrading,
    props.feeSettingsByAccount,
    props.sharedFeeSettings,
    props.refreshNonce,
    ...(props.mode === "portfolio"
      ? [props.stocks, props.displayMode, props.usdToTwdRate]
      : [props.stock]),
  ]);

  const points = historyState.status === "success" ? historyState.points : [];
  const activePoint = hoveredPoint ?? points[points.length - 1] ?? null;

  // Compute SVG gradient split offset for 0 baseline when plotting totalPL
  const zeroOffset = useMemo(() => {
    if (points.length === 0 || metric !== "RETURN") return 0;
    const values = points.map((p) => p.totalPL);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [points, metric]);

  const isLoading = historyState.status === "loading";
  const displayMode = isPortfolio
    ? props.displayMode
    : isUsMarket(props.stock.market)
      ? HomeDisplayMode.US
      : HomeDisplayMode.TW;

  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">歷史走勢與報酬</h2>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-4 py-3">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {isPortfolio && (
                <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setHomeTab("CURVE")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors",
                      homeTab === "CURVE"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <LineChartIcon className="h-3.5 w-3.5" />
                    報酬曲線
                  </button>
                  <button
                    type="button"
                    onClick={() => setHomeTab("CALENDAR")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors",
                      homeTab === "CALENDAR"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    報酬日曆
                  </button>
                </div>
              )}

              {(!isPortfolio || homeTab === "CURVE") && (
                <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMetric("RETURN")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      metric === "RETURN"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    報酬
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetric("MARKET_VALUE")}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      metric === "MARKET_VALUE"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    市值
                  </button>
                </div>
              )}
            </div>

            {(!isPortfolio || homeTab === "CURVE") && (
              <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isLoading}
                    onClick={() => setRange(opt.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50",
                      range === opt.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {historyState.status === "loading" && (
            <div className="flex h-52 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>{historyState.statusText}</span>
            </div>
          )}

          {historyState.status === "empty" && (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              {historyState.message}
            </div>
          )}

          {historyState.status === "error" && (
            <div className="flex h-40 items-center justify-center text-xs text-destructive">
              {historyState.message}
            </div>
          )}

          {historyState.status === "success" &&
            (isPortfolio && homeTab === "CALENDAR" ? (
              <PerformanceCalendarSection
                points={points}
                displayMode={displayMode}
              />
            ) : (
              <div className="space-y-2">
                {activePoint && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      {activePoint.date}
                    </span>
                    <div className="flex items-center gap-3 tabular-nums">
                      {metric === "RETURN" ? (
                        <>
                          <span
                            className={cn(
                              "font-semibold",
                              plColorClass(activePoint.totalPL),
                            )}
                          >
                            {isPortfolio
                              ? formatSignedHomeAmount(activePoint.totalPL, displayMode)
                              : formatSignedMarketAmount(
                                  activePoint.totalPL,
                                  props.stock.market,
                                )}
                          </span>
                          <span className={plColorClass(activePoint.totalPLPercentage)}>
                            {formatSignedPercent(activePoint.totalPLPercentage)}
                          </span>
                        </>
                      ) : (
                        <span className="font-semibold">
                          市值{" "}
                          {formatHomeCurrencyAmount(
                            activePoint.marketValue,
                            displayMode,
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={points}
                      margin={{ top: 8, right: 6, left: 6, bottom: 0 }}
                      onMouseMove={(state) => {
                        const pt = state?.activePayload?.[0]?.payload as
                          | PersonalHistoryPoint
                          | undefined;
                        if (pt) setHoveredPoint(pt);
                      }}
                      onMouseLeave={() => setHoveredPoint(null)}
                    >
                      <defs>
                        <linearGradient
                          id={`stroke-${gradientId}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset={zeroOffset}
                            stopColor="hsl(var(--stock-gain))"
                            stopOpacity={1}
                          />
                          <stop
                            offset={zeroOffset}
                            stopColor="hsl(var(--stock-loss))"
                            stopOpacity={1}
                          />
                        </linearGradient>
                        <linearGradient
                          id={`fill-${gradientId}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset={zeroOffset}
                            stopColor="hsl(var(--stock-gain))"
                            stopOpacity={0.22}
                          />
                          <stop
                            offset={zeroOffset}
                            stopColor="hsl(var(--stock-loss))"
                            stopOpacity={0.18}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        strokeOpacity={0.2}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: string) => v.slice(5)}
                        minTickGap={24}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        hide
                        domain={["auto", "auto"]}
                      />
                      {metric === "RETURN" && (
                        <ReferenceLine
                          y={0}
                          stroke="hsl(var(--muted-foreground))"
                          strokeDasharray="3 3"
                          strokeOpacity={0.6}
                        />
                      )}
                      <Tooltip
                        formatter={(value: number) => [
                          metric === "RETURN"
                            ? formatSignedHomeAmount(value, displayMode)
                            : formatHomeCurrencyAmount(value, displayMode),
                          metric === "RETURN" ? "累積損益" : "持股市值",
                        ]}
                        labelFormatter={(label: string) => label}
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          borderColor: "hsl(var(--border))",
                          borderRadius: "0.5rem",
                          fontSize: "12px",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey={metric === "RETURN" ? "totalPL" : "marketValue"}
                        stroke={
                          metric === "RETURN"
                            ? `url(#stroke-${gradientId})`
                            : "hsl(var(--primary))"
                        }
                        fill={
                          metric === "RETURN"
                            ? `url(#fill-${gradientId})`
                            : "hsl(var(--primary) / 0.16)"
                        }
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
