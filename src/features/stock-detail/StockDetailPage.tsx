import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  PlusCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  calculateHoldingInfo,
  canDeleteTransaction,
  canonicalStockCode,
  compareTransactions,
  formatShareCount,
  isUsMarket,
  normalizeMarket,
  stockCacheKey,
  transactionCashFlowAmount,
} from "@/domain";
import { HistoryChartSection } from "@/features/charts/HistoryChartSection";
import {
  formatCurrencyAmount,
  formatPrice,
  formatQuoteTimestamp,
  formatSignedMarketAmount,
  formatSignedPercent,
  plColorClass,
} from "@/features/holdings/formatters";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import {
  APP_ROUTES,
  createAddTransactionRoute,
  createTransactionDetailRoute,
} from "@/lib/routes";
import { cn } from "@/lib/utils";
import { LimitState, StockExchange, type Stock } from "@/types";

type DeleteScope = "ACTIVE_ACCOUNT" | "ALL_ACCOUNTS";

function formatTxDate(epochMillis: number): string {
  const d = new Date(epochMillis);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function StockDetailPage() {
  const { market: rawMarket = "TW", stockCode: rawCode = "" } = useParams();
  const navigate = useNavigate();

  const market = normalizeMarket(rawMarket);
  const stockCode = canonicalStockCode(decodeURIComponent(rawCode));
  const key = stockCacheKey(market, stockCode);
  const isUs = isUsMarket(market);

  const {
    accounts,
    activeAccountId,
    transactions,
    scopedTransactions,
    stockMap,
    quotes,
    settings,
    refreshQuotes,
    removeTransaction,
    updateSettings,
  } = usePortfolioData();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<DeleteScope>(
    activeAccountId > 0 ? "ACTIVE_ACCOUNT" : "ALL_ACCOUNTS",
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const stock: Stock = useMemo(
    () =>
      stockMap.get(key) ?? {
        market,
        code: stockCode,
        name: stockCode,
        exchange: StockExchange.UNKNOWN,
        industry: "",
        stockType: "",
      },
    [stockMap, key, market, stockCode],
  );

  const allStockTransactions = useMemo(
    () =>
      transactions
        .filter(
          (tx) =>
            normalizeMarket(tx.market) === market &&
            canonicalStockCode(tx.stockCode) === stockCode,
        )
        .sort(compareTransactions),
    [transactions, market, stockCode],
  );

  const scopedStockTransactions = useMemo(
    () =>
      scopedTransactions
        .filter(
          (tx) =>
            normalizeMarket(tx.market) === market &&
            canonicalStockCode(tx.stockCode) === stockCode,
        )
        .sort(compareTransactions),
    [scopedTransactions, market, stockCode],
  );

  const displayTransactionsDesc = useMemo(
    () => scopedStockTransactions.slice().reverse(),
    [scopedStockTransactions],
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

  const quote = quotes[key];

  const holding = useMemo(
    () =>
      calculateHoldingInfo(
        {
          stock,
          transactions: scopedStockTransactions,
          currentPrice: quote?.currentPrice ?? 0,
          dailyChange: quote?.change ?? 0,
          dailyChangePercentage: quote?.changePercent ?? 0,
          limitState: quote?.limitState ?? LimitState.NONE,
          preDeductSellFees: settings.preDeductSellFees,
          feeSettingsByAccount,
          sharedFeeSettings,
          returnRateMode: settings.returnRateMode,
          currentDateMillis: Date.now(),
          marginDayCount: settings.marginDayCount,
          includeProfitLossBreakdown: settings.partialSalesAsRealized,
          excludeDividendIncomeFromReturns:
            settings.excludeDividendIncomeFromReturns,
        },
        {
          normalListedStock: settings.taxRateNormalListedStock,
          domesticStockEtf: settings.taxRateDomesticStockEtf,
          bondEtf: settings.taxRateBondEtf,
          dayTrading: settings.taxRateDayTrading,
        },
      ),
    [
      stock,
      scopedStockTransactions,
      quote,
      settings,
      feeSettingsByAccount,
      sharedFeeSettings,
    ],
  );

  const activeAccountName = useMemo(() => {
    if (activeAccountId === 0) return "全部帳戶";
    return accounts.find((a) => a.id === activeAccountId)?.name ?? "預設帳戶";
  }, [accounts, activeAccountId]);

  const yahooUrl = isUs
    ? `https://finance.yahoo.com/quote/${encodeURIComponent(stockCode)}`
    : `https://tw.stock.yahoo.com/quote/${encodeURIComponent(stockCode)}`;

  const showMarginCard =
    holding.marginOutstandingPrincipal > 1e-6 ||
    holding.marginAccruedInterest > 1e-6;
  const showShortCard =
    holding.shortOutstandingShares > 1e-6 ||
    holding.shortAccruedBorrowFee > 1e-6 ||
    holding.shortCompensationExpense > 1e-6;

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshQuotes();
      setRefreshNonce((n) => n + 1);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleConfirmDelete = async () => {
    const targets =
      deleteScope === "ACTIVE_ACCOUNT" && activeAccountId > 0
        ? scopedStockTransactions
        : allStockTransactions;

    if (targets.length === 0) {
      setDeleteDialogOpen(false);
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);
    try {
      // Delete newest-first so dependent repayments/covers are removed before opening lots
      const orderedDesc = targets.slice().sort(compareTransactions).reverse();
      let remainingAll = transactions.slice();
      for (const tx of orderedDesc) {
        if (!canDeleteTransaction(tx, remainingAll)) {
          throw new Error("部分開倉交易仍被還款、還券或補償引用，無法刪除");
        }
        await removeTransaction(tx);
        remainingAll = remainingAll.filter((t) => t.id !== tx.id);
      }
      setDeleteDialogOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除交易失敗");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>返回</span>
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-bold sm:text-lg">
                {stock.name || stockCode}
              </h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {market} {stockCode}
              </span>
              {stock.exchange && (
                <span className="hidden rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
                  {stock.exchange}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={yahooUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <span>Yahoo 報價</span>
            <ExternalLink className="h-3 w-3" />
          </a>

          <Link
            to={createAddTransactionRoute({ market, stockCode })}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>新增交易</span>
          </Link>

          {allStockTransactions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDeleteScope(
                  activeAccountId > 0 ? "ACTIVE_ACCOUNT" : "ALL_ACCOUNTS",
                );
                setDeleteError(null);
                setDeleteDialogOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>刪除交易</span>
            </button>
          )}
        </div>
      </div>

      {/* Realtime price row */}
      <section className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="text-2xl font-bold tabular-nums sm:text-3xl">
              {formatPrice(holding.currentPrice, market)}
            </span>
            <span
              className={cn(
                "whitespace-nowrap text-sm font-semibold tabular-nums",
                plColorClass(holding.dailyChange),
              )}
            >
              {holding.dailyChange > 0 ? "+" : ""}
              {holding.dailyChange.toFixed(2)} (
              {formatSignedPercent(holding.dailyChangePercentage)})
            </span>
            {holding.limitState === LimitState.LIMIT_UP && (
              <span className="rounded bg-stock-gain/15 px-1.5 py-0.5 text-xs font-semibold text-stock-gain">
                漲停
              </span>
            )}
            {holding.limitState === LimitState.LIMIT_DOWN && (
              <span className="rounded bg-stock-loss/15 px-1.5 py-0.5 text-xs font-semibold text-stock-loss">
                跌停
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-primary")}
            />
            <span className="tabular-nums">
              {formatQuoteTimestamp(quote?.lastUpdated)}
            </span>
          </button>
        </div>

        {/* Position summary */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">持有股數</div>
            <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
              {formatShareCount(holding.shares)} 股
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">平均成本</div>
            <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
              {formatPrice(holding.averageCost, market)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">持股市值</div>
            <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
              {formatCurrencyAmount(holding.marketValue, market)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">累積損益</div>
            <div
              className={cn(
                "mt-0.5 font-semibold tabular-nums sm:text-sm",
                plColorClass(holding.totalPL),
              )}
            >
              {formatSignedMarketAmount(holding.totalPL, market)} (
              {formatSignedPercent(holding.totalPLPercentage)})
            </div>
          </div>
        </div>

        {settings.partialSalesAsRealized && holding.profitLossBreakdown && (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
            <div>
              <span className="text-muted-foreground">未實現損益：</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  plColorClass(holding.profitLossBreakdown.unrealizedProfitLoss),
                )}
              >
                {formatSignedMarketAmount(
                  holding.profitLossBreakdown.unrealizedProfitLoss,
                  market,
                )}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">已實現損益：</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  plColorClass(holding.profitLossBreakdown.realizedProfitLoss),
                )}
              >
                {formatSignedMarketAmount(
                  holding.profitLossBreakdown.realizedProfitLoss,
                  market,
                )}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Conditional Margin Card */}
      {showMarginCard && (
        <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">融資摘要</h2>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">融資未償</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatCurrencyAmount(holding.marginOutstandingPrincipal, market)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">應計利息</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatCurrencyAmount(holding.marginAccruedInterest, market)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">融資淨值</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatCurrencyAmount(holding.marginNetEquity, market)}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Conditional Short Card */}
      {showShortCard && (
        <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">融券摘要</h2>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">融券尚欠</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatShareCount(holding.shortOutstandingShares)} 股
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">回補市值</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatCurrencyAmount(holding.shortMarketLiability, market)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">應計借券費</div>
              <div className="mt-0.5 font-semibold tabular-nums sm:text-sm">
                {formatCurrencyAmount(holding.shortAccruedBorrowFee, market)}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Stock History Chart */}
      <HistoryChartSection
        mode="stock"
        stock={stock}
        transactions={scopedStockTransactions}
        settings={settings}
        feeSettingsByAccount={feeSettingsByAccount}
        sharedFeeSettings={sharedFeeSettings}
        updateSettings={updateSettings}
        refreshNonce={refreshNonce}
      />

      {/* Transaction History List */}
      <section className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            交易紀錄 ({displayTransactionsDesc.length})
          </h2>
          <Link
            to={APP_ROUTES.TRANSACTIONS}
            className="text-xs text-primary hover:underline"
          >
            查看全部交易
          </Link>
        </div>

        {displayTransactionsDesc.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            此帳戶尚無 {stockCode} 的交易紀錄
          </div>
        ) : (
          <div className="divide-y">
            {displayTransactionsDesc.map((tx) => {
              const cashFlow = transactionCashFlowAmount(tx);
              return (
                <Link
                  key={tx.id}
                  to={createTransactionDetailRoute(tx.id)}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition-colors hover:bg-muted/40"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                        {tx.type}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatTxDate(tx.date)}
                      </span>
                    </div>
                    {tx.note && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {tx.note}
                      </div>
                    )}
                  </div>

                  <div className="text-right tabular-nums">
                    {cashFlow !== null && (
                      <div
                        className={cn(
                          "font-semibold",
                          cashFlow > 0
                            ? "text-stock-gain"
                            : cashFlow < 0
                              ? "text-stock-loss"
                              : "text-muted-foreground",
                        )}
                      >
                        {formatSignedMarketAmount(cashFlow, market)}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      {tx.buyShares > 0
                        ? `${formatShareCount(tx.buyShares)} 股 @ ${formatPrice(tx.buyPrice, market)}`
                        : tx.sellShares > 0
                          ? `${formatShareCount(tx.sellShares)} 股 @ ${formatPrice(tx.sellPrice, market)}`
                          : tx.dividendShares > 0
                            ? `配股 ${formatShareCount(tx.dividendShares)} 股`
                            : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Delete all transactions scope dialog */}
      {deleteDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="刪除個股交易確認"
        >
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 text-card-foreground shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">刪除 {stockCode} 交易紀錄</h3>
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-3 text-xs text-muted-foreground">
              請選擇要刪除的範圍，此操作無法復原。
            </p>

            {activeAccountId > 0 && (
              <div className="mb-4 space-y-2 text-xs">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5">
                  <input
                    type="radio"
                    name="deleteScope"
                    checked={deleteScope === "ACTIVE_ACCOUNT"}
                    onChange={() => setDeleteScope("ACTIVE_ACCOUNT")}
                  />
                  <span>
                    僅目前帳戶（{activeAccountName}，{scopedStockTransactions.length} 筆）
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5">
                  <input
                    type="radio"
                    name="deleteScope"
                    checked={deleteScope === "ALL_ACCOUNTS"}
                    onChange={() => setDeleteScope("ALL_ACCOUNTS")}
                  />
                  <span>所有帳戶（共 {allStockTransactions.length} 筆）</span>
                </label>
              </div>
            )}

            {deleteError && (
              <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(false)}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {isDeleting ? "刪除中..." : "確認刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
