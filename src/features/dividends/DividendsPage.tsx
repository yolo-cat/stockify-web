import { useMemo, useRef, useState } from "react";
import { Coins, RefreshCw } from "lucide-react";
import {
  canonicalStockCode,
  compareTransactions,
  isTaiwanStockRefIncluded,
  stockCacheKey,
} from "@/domain";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { invokeDividendInfo } from "@/services";
import {
  StockMarket,
  TransactionType,
  type DividendInfoCacheEntry,
  type DividendItemUiState,
} from "@/types";

function formatLocalDate(millis: number): string {
  const d = new Date(millis);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDateKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return dateStr.replace(/\//g, "-").trim();
}

function latestDateKey(item: DividendItemUiState): string {
  const candidates = [
    item.cashDividendDate,
    item.stockDividendDate,
    item.lastLocalCashDividendDate,
    item.lastLocalStockDividendDate,
  ]
    .map(normalizeDateKey)
    .filter(Boolean);
  if (candidates.length === 0) return "";
  return candidates.sort().at(-1) ?? "";
}

export function DividendsPage() {
  const {
    isLoading,
    activeAccountId,
    transactions,
    scopedTransactions,
    stockMap,
    settings,
    updateSettings,
  } = usePortfolioData();

  const [loadingCodes, setLoadingCodes] = useState<Record<string, boolean>>({});
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({});
  const requestSeqRef = useRef(0);

  const twCodes = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const tx of transactions) {
      if (isTaiwanStockRefIncluded(tx, activeAccountId, now)) {
        const code = canonicalStockCode(tx.stockCode);
        if (code) set.add(code);
      }
    }
    return [...set];
  }, [transactions, activeAccountId]);

  const items = useMemo<DividendItemUiState[]>(() => {
    const sortedTxs = scopedTransactions
      .slice()
      .sort((a, b) => compareTransactions(b, a));

    const list: DividendItemUiState[] = twCodes.map((code) => {
      const stock = stockMap.get(stockCacheKey(StockMarket.TW, code));
      const cache = settings.dividendInfoCache[code];

      const lastCashTx = sortedTxs.find(
        (t) =>
          canonicalStockCode(t.stockCode) === code &&
          t.type === TransactionType.CASH_DIVIDEND,
      );
      const lastStockTx = sortedTxs.find(
        (t) =>
          canonicalStockCode(t.stockCode) === code &&
          t.type === TransactionType.STOCK_DIVIDEND,
      );

      return {
        stockCode: code,
        stockName: stock?.name || code,
        cashDividend: cache?.cashDividend ?? null,
        cashDividendDate: cache?.cashDividendDate ?? null,
        stockDividend: cache?.stockDividend ?? null,
        stockDividendDate: cache?.stockDividendDate ?? null,
        lastLocalCashDividend: lastCashTx?.cashDividend ?? null,
        lastLocalCashDividendDate: lastCashTx
          ? formatLocalDate(lastCashTx.date)
          : null,
        lastLocalStockDividend: lastStockTx?.stockDividend ?? null,
        lastLocalStockDividendDate: lastStockTx
          ? formatLocalDate(lastStockTx.date)
          : null,
        isLoading: Boolean(loadingCodes[code]),
        errorMessage: errorByCode[code] ?? null,
      };
    });

    // Sort descending by latest valid date (nulls last)
    return list.sort((a, b) => {
      const da = latestDateKey(a);
      const db = latestDateKey(b);
      if (!da && !db) return a.stockCode.localeCompare(b.stockCode);
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });
  }, [
    twCodes,
    scopedTransactions,
    stockMap,
    settings.dividendInfoCache,
    loadingCodes,
    errorByCode,
  ]);

  const refreshCodes = async (codes: string[]) => {
    if (codes.length === 0) return;

    const seqByCode: Record<string, number> = {};
    for (const code of codes) {
      requestSeqRef.current += 1;
      seqByCode[code] = requestSeqRef.current;
    }

    setLoadingCodes((prev) => {
      const next = { ...prev };
      for (const c of codes) next[c] = true;
      return next;
    });
    setErrorByCode((prev) => {
      const next = { ...prev };
      for (const c of codes) delete next[c];
      return next;
    });

    // Chunk into <= 3 concurrent batches
    const chunks: string[][] = [];
    for (let i = 0; i < codes.length; i += 3) {
      chunks.push(codes.slice(i, i + 3));
    }

    const nextCache: Record<string, DividendInfoCacheEntry> = {
      ...settings.dividendInfoCache,
    };
    const nextErrors: Record<string, string> = {};
    const todayStr = formatLocalDate(Date.now());
    const nowMillis = Date.now();

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (code) => {
          const seq = seqByCode[code];
          try {
            const res = await invokeDividendInfo([code]);
            const errMsg = res.errors?.[code];
            if (errMsg) {
              nextErrors[code] = errMsg;
              return;
            }
            const summary = res.results[code] ?? null;
            const existingSeq = nextCache[code]?.requestSequence ?? 0;
            if (seq >= existingSeq) {
              nextCache[code] = {
                cashDividend: summary?.cashDividend?.amount ?? null,
                cashDividendDate: summary?.cashDividend?.date ?? null,
                stockDividend: summary?.stockDividend?.amount ?? null,
                stockDividendDate: summary?.stockDividend?.date ?? null,
                lastFetchedDate: todayStr,
                lastFetchedTimeMillis: nowMillis,
                requestSequence: seq,
              };
            }
          } catch (err) {
            nextErrors[code] =
              err instanceof Error ? err.message : "查詢失敗";
          } finally {
            setLoadingCodes((prev) => ({ ...prev, [code]: false }));
          }
        }),
      );
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrorByCode((prev) => ({ ...prev, ...nextErrors }));
    }

    await updateSettings({ dividendInfoCache: nextCache });
  };

  const anyLoading = Object.values(loadingCodes).some(Boolean);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">台股股息資訊</h1>
          <p className="text-xs text-muted-foreground">
            對照 Yahoo 最新除權息預告與本地實領紀錄（共 {items.length} 檔）
          </p>
        </div>

        <button
          type="button"
          disabled={anyLoading || twCodes.length === 0}
          onClick={() => void refreshCodes(twCodes)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${anyLoading ? "animate-spin" : ""}`}
          />
          <span>{anyLoading ? "更新中..." : "全部更新"}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="dividends-loading">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border bg-card p-4"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center">
          <Coins className="mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm font-medium">尚無台股持股紀錄</p>
          <p className="mt-1 text-xs text-muted-foreground">
            新增台股交易後，即可在此追蹤各檔股息與除權息日期
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <article
              key={item.stockCode}
              className="rounded-xl border bg-card p-4 text-card-foreground"
            >
              <div className="flex items-start justify-between gap-2 border-b pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold">
                      {item.stockCode}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {item.stockName}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={item.isLoading}
                  aria-label={`更新 ${item.stockCode} 股息`}
                  onClick={() => void refreshCodes([item.stockCode])}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${item.isLoading ? "animate-spin" : ""}`}
                  />
                  <span>{item.isLoading ? "更新中" : "更新"}</span>
                </button>
              </div>

              {item.errorMessage && (
                <p
                  role="alert"
                  className="mt-2 rounded bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                >
                  {item.errorMessage}
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1 rounded-lg bg-muted/40 p-2.5">
                  <p className="font-semibold text-muted-foreground">
                    Yahoo 最新除權息
                  </p>
                  <p className="tabular-nums">
                    現金：
                    {item.cashDividend !== null
                      ? `${item.cashDividend} 元 (${item.cashDividendDate ?? "—"})`
                      : "—"}
                  </p>
                  <p className="tabular-nums">
                    股票：
                    {item.stockDividend !== null
                      ? `${item.stockDividend} 元 (${item.stockDividendDate ?? "—"})`
                      : "—"}
                  </p>
                </div>

                <div className="space-y-1 rounded-lg bg-muted/40 p-2.5">
                  <p className="font-semibold text-muted-foreground">
                    本地最近實領
                  </p>
                  <p className="tabular-nums">
                    配息：
                    {item.lastLocalCashDividend !== null
                      ? `${item.lastLocalCashDividend} 元 (${item.lastLocalCashDividendDate ?? "—"})`
                      : "—"}
                  </p>
                  <p className="tabular-nums">
                    配股：
                    {item.lastLocalStockDividend !== null
                      ? `${item.lastLocalStockDividend} 元 (${item.lastLocalStockDividendDate ?? "—"})`
                      : "—"}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
