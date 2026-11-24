import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  buildTransactionsUiState,
  formatMarketAmount,
  formatShareCount,
} from "@/domain";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import {
  APP_ROUTES,
  createTransactionDetailRoute,
} from "@/lib/routes";
import { StockMarket, TransactionType, type StockTransaction } from "@/types";

const TYPE_BADGE_CLASS: Record<string, string> = {
  [TransactionType.BUY]: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  [TransactionType.SELL]: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  [TransactionType.CASH_DIVIDEND]: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  [TransactionType.STOCK_DIVIDEND]: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  [TransactionType.CAPITAL_REDUCTION]: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  [TransactionType.STOCK_SPLIT]: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  [TransactionType.MARGIN_BUY]: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  [TransactionType.MARGIN_REPAYMENT]: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  [TransactionType.SHORT_SELL]: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  [TransactionType.SHORT_COVER]: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  [TransactionType.SHORT_COMPENSATION]: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

function formatCashFlowBadgeAmount(amount: number, market: StockMarket): string {
  const formatted = formatMarketAmount(amount, market);
  return market === StockMarket.US ? `$${formatted}` : `NT$${formatted}`;
}

function summarizeTransactionRow(tx: StockTransaction, market: StockMarket): string {
  const prefix = market === StockMarket.US ? "$" : "NT$";
  switch (tx.type) {
    case TransactionType.BUY:
    case TransactionType.MARGIN_BUY:
      return `${formatShareCount(tx.buyShares)} 股 @ ${prefix}${formatMarketAmount(tx.buyPrice, market)}`;
    case TransactionType.SELL:
    case TransactionType.SHORT_SELL:
      return `${formatShareCount(tx.sellShares)} 股 @ ${prefix}${formatMarketAmount(tx.sellPrice, market)}`;
    case TransactionType.SHORT_COVER:
      return `還券 ${formatShareCount(tx.shortCoverShares || tx.buyShares)} 股 @ ${prefix}${formatMarketAmount(tx.buyPrice, market)}`;
    case TransactionType.MARGIN_REPAYMENT:
      return `還本 ${prefix}${formatMarketAmount(tx.marginRepayment, market)}${tx.marginActualInterest > 0 ? ` · 息 ${prefix}${formatMarketAmount(tx.marginActualInterest, market)}` : ""}`;
    case TransactionType.SHORT_COMPENSATION:
      return `補償 ${prefix}${formatMarketAmount(tx.shortCompensation, market)}`;
    case TransactionType.CASH_DIVIDEND:
      return `每股 ${tx.cashDividend} · 實領 ${prefix}${formatMarketAmount(tx.dividendIncome || tx.income, market)}`;
    case TransactionType.STOCK_DIVIDEND:
      return `配股 ${formatShareCount(tx.dividendShares)} 股`;
    case TransactionType.CAPITAL_REDUCTION:
      return `減資 ${tx.capitalReductionRatio}% · ${formatShareCount(tx.sharesBeforeReduction)} → ${formatShareCount(tx.sharesAfterReduction)} 股`;
    case TransactionType.STOCK_SPLIT:
      return `分割 1:${tx.stockSplitRatio} · ${formatShareCount(tx.sharesBeforeSplit)} → ${formatShareCount(tx.sharesAfterSplit)} 股`;
    default:
      return "";
  }
}

function primaryTransactionCashText(tx: StockTransaction, market: StockMarket): {
  text: string;
  tone: "income" | "expense" | "neutral";
} {
  const prefix = market === StockMarket.US ? "$" : "NT$";
  if (tx.type === TransactionType.CASH_DIVIDEND) {
    const net = tx.dividendIncome || tx.income;
    return { text: `+${prefix}${formatMarketAmount(net, market)}`, tone: "income" };
  }
  if (tx.type === TransactionType.SELL || tx.type === TransactionType.SHORT_SELL) {
    const net = tx.income - tx.marginRepayment - tx.marginActualInterest;
    if (net >= 0) {
      return { text: `+${prefix}${formatMarketAmount(net, market)}`, tone: "income" };
    }
    return { text: `-${prefix}${formatMarketAmount(-net, market)}`, tone: "expense" };
  }
  if (tx.type === TransactionType.CAPITAL_REDUCTION && tx.cashReturned > 0) {
    return { text: `+${prefix}${formatMarketAmount(tx.cashReturned, market)}`, tone: "income" };
  }
  if (tx.type === TransactionType.MARGIN_BUY) {
    const selfFunded = tx.marginSelfFundedOverridden
      ? tx.marginSelfFunded
      : Math.max(0, tx.expense - tx.marginPrincipal);
    return { text: `-${prefix}${formatMarketAmount(selfFunded, market)}`, tone: "expense" };
  }
  if (tx.type === TransactionType.MARGIN_REPAYMENT) {
    const total = tx.marginRepayment + tx.marginActualInterest;
    return { text: `-${prefix}${formatMarketAmount(total, market)}`, tone: "expense" };
  }
  if (tx.type === TransactionType.SHORT_COMPENSATION) {
    return { text: `-${prefix}${formatMarketAmount(tx.shortCompensation, market)}`, tone: "expense" };
  }
  if (tx.expense > 0) {
    return { text: `-${prefix}${formatMarketAmount(tx.expense, market)}`, tone: "expense" };
  }
  return { text: "—", tone: "neutral" };
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const {
    isLoading,
    accounts,
    activeAccountId,
    transactionsWithStock,
    updateSettings,
  } = usePortfolioData();
  const [query, setQuery] = useState("");

  const uiState = useMemo(
    () =>
      buildTransactionsUiState({
        transactionsWithStock,
        accountId: activeAccountId,
        query,
        isLoading,
      }),
    [transactionsWithStock, activeAccountId, query, isLoading],
  );

  const accountNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const acc of accounts) {
      map.set(acc.id, acc.name);
    }
    return map;
  }, [accounts]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">交易紀錄</h1>
          <p className="text-xs text-muted-foreground" data-testid="transactions-count">
            {query.trim()
              ? `符合 ${uiState.resultCount} 筆 / 共 ${uiState.totalCount} 筆`
              : `共 ${uiState.totalCount} 筆交易`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="篩選帳戶"
            value={activeAccountId}
            onChange={(e) => {
              const nextId = Number(e.target.value);
              void updateSettings({ activeAccountId: nextId });
            }}
            className="h-9 rounded-md border bg-background px-2.5 text-sm"
          >
            <option value={0}>全部帳戶</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => navigate(APP_ROUTES.ADD_TRANSACTION)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            <span>新增交易</span>
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋代號、名稱、類型、筆記或日期（空白分隔多關鍵字）"
          aria-label="搜尋交易紀錄"
          className="h-10 w-full rounded-lg border bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="清除搜尋"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {uiState.isLoading ? (
        <div className="space-y-3" data-testid="transactions-loading">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border bg-card p-4"
            />
          ))}
        </div>
      ) : uiState.sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center">
          <ArrowLeftRight className="mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">
            {query.trim() ? "找不到符合條件的交易紀錄" : "尚無交易紀錄"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query.trim()
              ? "請嘗試調整搜尋關鍵字或切換帳戶篩選"
              : "點擊上方「新增交易」開始記錄第一筆買賣或股息"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {uiState.sections.map((section) => (
            <div
              key={section.date}
              className="overflow-hidden rounded-xl border bg-card text-card-foreground"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                <span className="text-xs font-semibold tracking-wide text-foreground">
                  {section.date}
                </span>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {section.cashFlowTotals.map((cf) => (
                    <span
                      key={cf.market}
                      className="inline-flex items-center gap-1.5 text-muted-foreground"
                    >
                      <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold">
                        {cf.market}
                      </span>
                      {cf.income > 0 && (
                        <span className="text-rose-600 dark:text-rose-400">
                          收入 {formatCashFlowBadgeAmount(cf.income, cf.market)}
                        </span>
                      )}
                      {cf.expense > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          支出 {formatCashFlowBadgeAmount(cf.expense, cf.market)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>

              <ul className="divide-y">
                {section.transactions.map((item) => {
                  const tx = item.transaction;
                  const market = (item.market || tx.market) as StockMarket;
                  const typeLabel =
                    tx.type === TransactionType.MARGIN_REPAYMENT
                      ? "還融資"
                      : tx.type;
                  const badgeClass =
                    TYPE_BADGE_CLASS[tx.type] ??
                    "bg-muted text-muted-foreground";
                  const cash = primaryTransactionCashText(tx, market);

                  return (
                    <li key={tx.id}>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(createTransactionDetailRoute(tx.id))
                        }
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                            >
                              {typeLabel}
                            </span>
                            <span className="font-semibold">
                              {tx.stockCode}
                            </span>
                            <span className="truncate text-sm text-muted-foreground">
                              {item.stockName}
                            </span>
                            <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {market}
                            </span>
                            {activeAccountId === 0 && (
                              <span className="text-xs text-muted-foreground">
                                · {accountNameById.get(tx.accountId) ?? `帳戶 #${tx.accountId}`}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{summarizeTransactionRow(tx, market)}</span>
                            {tx.note && (
                              <span className="truncate text-muted-foreground/80">
                                · {tx.note}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <span
                            className={`text-sm font-semibold tabular-nums ${
                              cash.tone === "income"
                                ? "text-rose-600 dark:text-rose-400"
                                : cash.tone === "expense"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {cash.text}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
