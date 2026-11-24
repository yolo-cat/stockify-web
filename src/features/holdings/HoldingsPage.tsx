import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Coins,
  PieChart,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  aggregateHoldingsUiState,
  isUsMarket,
  stockCacheKey,
} from "@/domain";
import { HistoryChartSection } from "@/features/charts/HistoryChartSection";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { APP_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  HomeDisplayMode,
  HomeHoldingsSortColumn,
  HomeHoldingsSortMode,
  type HoldingInfo,
} from "@/types";
import { AccountSwitcherModal } from "./AccountSwitcherModal";
import {
  formatHomeCurrencyAmount,
  formatQuoteTimestamp,
  formatSignedHomeAmount,
  formatSignedPercent,
  plColorClass,
} from "./formatters";
import { HoldingCard } from "./HoldingCard";

const DISPLAY_MODE_CYCLE: Record<HomeDisplayMode, HomeDisplayMode> = {
  [HomeDisplayMode.TW]: HomeDisplayMode.US,
  [HomeDisplayMode.US]: HomeDisplayMode.COMBINED,
  [HomeDisplayMode.COMBINED]: HomeDisplayMode.TW,
};

const DISPLAY_MODE_LABELS: Record<HomeDisplayMode, string> = {
  [HomeDisplayMode.TW]: "台股",
  [HomeDisplayMode.US]: "美股",
  [HomeDisplayMode.COMBINED]: "合併",
};

const SORT_COLUMNS: Array<{ column: HomeHoldingsSortColumn; label: string }> = [
  { column: HomeHoldingsSortColumn.MARKET_VALUE, label: "市值" },
  { column: HomeHoldingsSortColumn.DAILY_PL, label: "當日" },
  { column: HomeHoldingsSortColumn.TOTAL_PL, label: "總損益" },
  { column: HomeHoldingsSortColumn.RETURN_RATE, label: "報酬率" },
];

function filterByDisplayMode(
  list: readonly HoldingInfo[],
  displayMode: HomeDisplayMode,
): HoldingInfo[] {
  if (displayMode === HomeDisplayMode.TW) {
    return list.filter((h) => !isUsMarket(h.stock.market));
  }
  if (displayMode === HomeDisplayMode.US) {
    return list.filter((h) => isUsMarket(h.stock.market));
  }
  return list.slice();
}

export function HoldingsPage() {
  const {
    accounts,
    activeAccountId,
    scopedTransactions,
    settings,
    holdingsOrder,
    stocks,
    quotes,
    taiwanIndex,
    effectiveUsdToTwdRate,
    holdings,
    unrealizedHoldings,
    realizedHoldings,
    refreshQuotes,
    saveAccount,
    removeAccount,
    updateSettings,
    updateHoldingsOrder,
    isLoading,
  } = usePortfolioData();

  const [showCostInsteadOfValue, setShowCostInsteadOfValue] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [unrealizedOpen, setUnrealizedOpen] = useState(true);
  const [realizedOpen, setRealizedOpen] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [chartRefreshNonce, setChartRefreshNonce] = useState(0);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  const displayMode = settings.homeDisplayMode;

  const filteredHoldings = useMemo(
    () => filterByDisplayMode(holdings, displayMode),
    [holdings, displayMode],
  );
  const filteredUnrealized = useMemo(
    () => filterByDisplayMode(unrealizedHoldings, displayMode),
    [unrealizedHoldings, displayMode],
  );
  const filteredRealized = useMemo(
    () => filterByDisplayMode(realizedHoldings, displayMode),
    [realizedHoldings, displayMode],
  );

  const summaryState = useMemo(
    () =>
      aggregateHoldingsUiState(
        filteredHoldings,
        displayMode,
        effectiveUsdToTwdRate,
      ),
    [filteredHoldings, displayMode, effectiveUsdToTwdRate],
  );

  const feeSettingsByAccount = useMemo(() => {
    const shared = {
      feeDiscount: settings.feeDiscount,
      minFeeRegular: settings.minFeeRegular,
      minFeeOddLot: settings.minFeeOddLot,
    };
    const record: Record<number, typeof shared> = {};
    for (const acc of accounts) {
      record[acc.id] = {
        feeDiscount: acc.feeDiscount ?? shared.feeDiscount,
        minFeeRegular: acc.minFeeRegular ?? shared.minFeeRegular,
        minFeeOddLot: acc.minFeeOddLot ?? shared.minFeeOddLot,
      };
    }
    return record;
  }, [accounts, settings.feeDiscount, settings.minFeeRegular, settings.minFeeOddLot]);

  const sharedFeeSettings = useMemo(
    () => ({
      feeDiscount: settings.feeDiscount,
      minFeeRegular: settings.minFeeRegular,
      minFeeOddLot: settings.minFeeOddLot,
    }),
    [settings.feeDiscount, settings.minFeeRegular, settings.minFeeOddLot],
  );

  const latestQuoteMillis = useMemo(() => {
    let max = 0;
    for (const q of Object.values(quotes)) {
      if (q.lastUpdated > max) max = q.lastUpdated;
    }
    return max;
  }, [quotes]);

  const activeAccountName = useMemo(() => {
    if (activeAccountId === 0) return "全部帳戶";
    return accounts.find((a) => a.id === activeAccountId)?.name ?? "預設帳戶";
  }, [accounts, activeAccountId]);

  const isManualSort =
    settings.homeHoldingsSortMode === HomeHoldingsSortMode.MANUAL ||
    settings.homeHoldingsSortColumn === HomeHoldingsSortColumn.NONE;

  const handleCycleDisplayMode = () => {
    const next = DISPLAY_MODE_CYCLE[displayMode] ?? HomeDisplayMode.COMBINED;
    void updateSettings({ homeDisplayMode: next });
  };

  const handleForceRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshQuotes();
      setChartRefreshNonce((n) => n + 1);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSortClick = (column: HomeHoldingsSortColumn) => {
    if (
      settings.homeHoldingsSortMode === HomeHoldingsSortMode.MANUAL ||
      settings.homeHoldingsSortColumn !== column
    ) {
      void updateSettings({
        homeHoldingsSortMode: HomeHoldingsSortMode.COLUMN,
        homeHoldingsSortColumn: column,
        homeHoldingsSortAscending: true,
      });
    } else if (settings.homeHoldingsSortAscending) {
      void updateSettings({
        homeHoldingsSortMode: HomeHoldingsSortMode.COLUMN,
        homeHoldingsSortColumn: column,
        homeHoldingsSortAscending: false,
      });
    } else {
      void updateSettings({
        homeHoldingsSortMode: HomeHoldingsSortMode.MANUAL,
        homeHoldingsSortColumn: HomeHoldingsSortColumn.NONE,
        homeHoldingsSortAscending: true,
      });
    }
  };

  const handleDropReorder = (
    targetKey: string,
    section: "unrealized" | "realized",
    items: readonly HoldingInfo[],
  ) => {
    if (!isManualSort || !draggedKey || draggedKey === targetKey) {
      setDraggedKey(null);
      return;
    }
    const keys = items.map((h) => stockCacheKey(h.stock.market, h.stock.code));
    const fromIdx = keys.indexOf(draggedKey);
    const toIdx = keys.indexOf(targetKey);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedKey(null);
      return;
    }
    const reordered = keys.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    void updateHoldingsOrder(
      section === "unrealized"
        ? { ...holdingsOrder, order: reordered }
        : { ...holdingsOrder, realizedOrder: reordered },
    );
    setDraggedKey(null);
  };

  return (
    <div className="space-y-4">
      {/* Top header */}
      <div className="flex items-center justify-between gap-2">
        <Link
          to={APP_ROUTES.ASSETS}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground hover:bg-muted"
        >
          <PieChart className="h-3.5 w-3.5 text-primary" />
          <span>資產總覽</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h1 className="text-base font-bold sm:text-lg">持股總覽</h1>
        </div>

        <Link
          to={APP_ROUTES.DIVIDENDS}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground hover:bg-muted"
        >
          <Coins className="h-3.5 w-3.5 text-primary" />
          <span>配息資訊</span>
        </Link>
      </div>

      {/* Optional Taiwan Weighted Index banner */}
      {settings.showTaiwanWeightedIndex && taiwanIndex && (
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-2.5 text-xs shadow-sm">
          <span className="font-medium text-muted-foreground">
            {taiwanIndex.name || "加權指數"}
          </span>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="font-bold text-foreground">
              {taiwanIndex.current.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className={cn("font-semibold", plColorClass(taiwanIndex.change))}>
              {taiwanIndex.change > 0 ? "+" : ""}
              {taiwanIndex.change.toFixed(2)} (
              {formatSignedPercent(taiwanIndex.changePercent)})
            </span>
          </div>
        </div>
      )}

      {/* Portfolio Summary Card */}
      <section className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium hover:bg-muted"
            >
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <span>{activeAccountName}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>

            <button
              type="button"
              onClick={handleCycleDisplayMode}
              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              {DISPLAY_MODE_LABELS[displayMode] ?? "合併"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleForceRefresh()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="點擊立即更新報價與當月歷史走勢"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")}
            />
            <span className="tabular-nums">
              {formatQuoteTimestamp(latestQuoteMillis)}
            </span>
          </button>
        </div>

        <div className="mt-4">
          <div className="text-xs text-muted-foreground">累積損益</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2.5 tabular-nums">
            <span
              className={cn(
                "text-2xl font-bold tracking-tight sm:text-3xl",
                plColorClass(summaryState.cumulativePL),
              )}
            >
              {formatSignedHomeAmount(summaryState.cumulativePL, displayMode)}
            </span>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold",
                summaryState.cumulativePLPercentage > 0
                  ? "bg-stock-gain/10 text-stock-gain"
                  : summaryState.cumulativePLPercentage < 0
                    ? "bg-stock-loss/10 text-stock-loss"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {formatSignedPercent(summaryState.cumulativePLPercentage)}
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-3 text-xs">
          <div>
            <div className="text-muted-foreground">當日損益</div>
            <div
              className={cn(
                "mt-0.5 font-semibold tabular-nums sm:text-sm",
                plColorClass(summaryState.dailyPL),
              )}
            >
              {formatSignedHomeAmount(summaryState.dailyPL, displayMode)}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCostInsteadOfValue((v) => !v)}
            className="text-left hover:opacity-80"
          >
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>{showCostInsteadOfValue ? "持股成本" : "持股市值"}</span>
              <ArrowUpDown className="h-3 w-3" />
            </div>
            <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
              {formatHomeCurrencyAmount(
                showCostInsteadOfValue
                  ? summaryState.totalCost
                  : summaryState.marketValue,
                displayMode,
              )}
            </div>
          </button>

          <div>
            <div className="text-muted-foreground">股息收入</div>
            <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
              {formatHomeCurrencyAmount(summaryState.dividendIncome, displayMode)}
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio History Chart */}
      {settings.showTaiwanPortfolioChart && (
        <HistoryChartSection
          mode="portfolio"
          stocks={stocks}
          transactions={scopedTransactions}
          displayMode={displayMode}
          usdToTwdRate={effectiveUsdToTwdRate}
          settings={settings}
          feeSettingsByAccount={feeSettingsByAccount}
          sharedFeeSettings={sharedFeeSettings}
          updateSettings={updateSettings}
          refreshNonce={chartRefreshNonce}
        />
      )}

      {/* Sort headers */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">
          {isManualSort ? "手動排序（可拖曳調整）" : "欄位排序"}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {SORT_COLUMNS.map(({ column, label }) => {
            const isActive =
              !isManualSort && settings.homeHoldingsSortColumn === column;
            return (
              <button
                key={column}
                type="button"
                onClick={() => handleSortClick(column)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 font-semibold text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{label}</span>
                {isActive ? (
                  settings.homeHoldingsSortAscending ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-50" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty / Loading state */}
      {isLoading && holdings.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          載入持股資料中...
        </div>
      ) : filteredUnrealized.length === 0 && filteredRealized.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          目前尚無持股紀錄，點擊右上角「+ 新增交易」開始記帳。
        </div>
      ) : (
        <div className="space-y-4">
          {/* Unrealized Section */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setUnrealizedOpen((v) => !v)}
              className="flex w-full items-center justify-between px-1 py-1 text-left"
              aria-expanded={unrealizedOpen}
            >
              <h2 className="text-sm font-bold">
                未實現 ({filteredUnrealized.length})
              </h2>
              {unrealizedOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {unrealizedOpen && (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {filteredUnrealized.map((h) => (
                  <HoldingCard
                    key={`${stockCacheKey(h.stock.market, h.stock.code)}-u`}
                    holding={h}
                    isManualSort={isManualSort}
                    partialSalesAsRealized={settings.partialSalesAsRealized}
                    onDragStart={setDraggedKey}
                    onDrop={(targetKey) =>
                      handleDropReorder(targetKey, "unrealized", filteredUnrealized)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Realized Section */}
          {filteredRealized.length > 0 && (
            <section className="space-y-2">
              <button
                type="button"
                onClick={() => setRealizedOpen((v) => !v)}
                className="flex w-full items-center justify-between px-1 py-1 text-left"
                aria-expanded={realizedOpen}
              >
                <h2 className="text-sm font-bold">
                  已實現 ({filteredRealized.length})
                </h2>
                {realizedOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {realizedOpen && (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {filteredRealized.map((h) => (
                    <HoldingCard
                      key={`${stockCacheKey(h.stock.market, h.stock.code)}-r`}
                      holding={h}
                      isManualSort={isManualSort}
                      partialSalesAsRealized={settings.partialSalesAsRealized}
                      onDragStart={setDraggedKey}
                      onDrop={(targetKey) =>
                        handleDropReorder(targetKey, "realized", filteredRealized)
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <AccountSwitcherModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        accounts={accounts}
        activeAccountId={activeAccountId}
        settings={settings}
        onSelectAccount={async (id) => {
          await updateSettings({ activeAccountId: id });
        }}
        onSaveAccount={saveAccount}
        onDeleteAccount={removeAccount}
      />
    </div>
  );
}
