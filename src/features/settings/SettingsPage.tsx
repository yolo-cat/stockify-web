import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Info,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  exportTransactionsToCsv,
  importTransactionsFromCsv,
  nextAssetBalanceId,
  parseHoldingsOrderBackup,
  serializeHoldingsOrderBackup,
} from "@/domain";
import { PORTFOLIO_QUERY_KEYS, usePortfolioData } from "@/hooks/usePortfolioData";
import {
  CalculationRoundingMode,
  ReturnRateMode,
  StockDataSource,
  StockMarket,
  TextSizeMode,
  ThemeMode,
  UsStockDataSource,
  type Account,
  type CsvTransaction,
} from "@/types";

const TEXT_SIZE_OPTIONS: Array<{ value: TextSizeMode; label: string; scale: string }> = [
  { value: TextSizeMode.EXTRA_SMALL, label: "極小", scale: "87.5%" },
  { value: TextSizeMode.SMALL, label: "小", scale: "93.75%" },
  { value: TextSizeMode.DEFAULT, label: "標準", scale: "100%" },
  { value: TextSizeMode.LARGE, label: "大", scale: "110%" },
  { value: TextSizeMode.EXTRA_LARGE, label: "極大", scale: "120%" },
];

export function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "amoled");
  if (theme === ThemeMode.DARK) {
    root.classList.add("dark");
  } else if (theme === ThemeMode.AMOLED) {
    root.classList.add("dark", "amoled");
  } else if (theme === ThemeMode.SYSTEM) {
    const prefersDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) root.classList.add("dark");
  }
}

export function applyTextSizeToDocument(mode: TextSizeMode) {
  if (typeof document === "undefined") return;
  const found = TEXT_SIZE_OPTIONS.find((o) => o.value === mode);
  document.documentElement.style.fontSize = found?.scale ?? "100%";
}

function downloadBlob(filename: string, data: BlobPart, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const {
    userId,
    accounts,
    transactionsWithStock,
    settings,
    holdingsOrder,
    updateSettings,
    updateHoldingsOrder,
    syncStockList,
    importTransactions,
    saveAccount,
    removeAccount,
    clearAllTransactions,
    clearAllUserData,
  } = usePortfolioData();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncingMarket, setSyncingMarket] = useState<StockMarket | null>(null);

  // Account dialog state
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountDiscount, setAccountDiscount] = useState("");
  const [accountMinRegular, setAccountMinRegular] = useState("");
  const [accountMinOdd, setAccountMinOdd] = useState("");

  // CSV Import state
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const orderInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCsvBytes, setPendingCsvBytes] = useState<Uint8Array | null>(null);
  const [pendingCsvRows, setPendingCsvRows] = useState<CsvTransaction[] | null>(
    null,
  );
  const [csvMarketError, setCsvMarketError] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);

  // Confirm dangerous delete modal
  const [confirmDeleteMode, setConfirmDeleteMode] = useState<
    "transactions" | "all" | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    applyThemeToDocument(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    applyTextSizeToDocument(settings.textSizeMode);
  }, [settings.textSizeMode]);

  const handleUpdate = async (partial: Parameters<typeof updateSettings>[0]) => {
    setErrorMessage(null);
    try {
      await updateSettings(partial);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "更新設定失敗");
    }
  };

  const handleSyncStocks = async (market: StockMarket) => {
    setSyncingMarket(market);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await syncStockList(market);
      setStatusMessage(
        `${market === StockMarket.TW ? "台股" : "美股"}清單同步完成，共 ${res.syncedCount} 檔`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "同步股票清單失敗");
    } finally {
      setSyncingMarket(null);
    }
  };

  const openAccountDialog = (acc: Account | null) => {
    setEditingAccount(acc);
    setAccountName(acc ? acc.name : "");
    setAccountDiscount(
      acc && acc.feeDiscount !== null ? String(acc.feeDiscount) : "",
    );
    setAccountMinRegular(
      acc && acc.minFeeRegular !== null ? String(acc.minFeeRegular) : "",
    );
    setAccountMinOdd(
      acc && acc.minFeeOddLot !== null ? String(acc.minFeeOddLot) : "",
    );
    setAccountDialogOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = accountName.trim();
    if (!trimmed) {
      setErrorMessage("帳戶名稱不可空白");
      return;
    }
    const id =
      editingAccount?.id ?? nextAssetBalanceId(accounts.map((a) => a.id));
    await saveAccount({
      id,
      name: trimmed,
      feeDiscount: accountDiscount.trim() ? Number(accountDiscount) : null,
      minFeeRegular: accountMinRegular.trim()
        ? Number(accountMinRegular)
        : null,
      minFeeOddLot: accountMinOdd.trim() ? Number(accountMinOdd) : null,
    });
    setAccountDialogOpen(false);
    setStatusMessage(`已儲存帳戶「${trimmed}」`);
  };

  const handleExportCsv = () => {
    const bytes = exportTransactionsToCsv(transactionsWithStock);
    downloadBlob("stockify_backup.csv", bytes as unknown as BlobPart, "text/csv;charset=utf-8");
    setStatusMessage(
      `已匯出 ${transactionsWithStock.length} 筆交易至 stockify_backup.csv`,
    );
  };

  const handleCsvFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setCsvMarketError(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const rows = importTransactionsFromCsv(bytes, true);
      setPendingCsvBytes(bytes);
      setPendingCsvRows(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CSV 解析失敗";
      if (msg.includes("不一致")) {
        // Offer force-import when market validation fails
        const bytes = new Uint8Array(await file.arrayBuffer());
        setPendingCsvBytes(bytes);
        setCsvMarketError(msg);
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleForceParseCsv = () => {
    if (!pendingCsvBytes) return;
    try {
      const rows = importTransactionsFromCsv(pendingCsvBytes, false);
      setCsvMarketError(null);
      setPendingCsvRows(rows);
    } catch (err) {
      setCsvMarketError(null);
      setPendingCsvBytes(null);
      setErrorMessage(err instanceof Error ? err.message : "強制解析失敗");
    }
  };

  const handleConfirmCsvImport = async (mode: "replace" | "append") => {
    if (!pendingCsvRows) return;
    setCsvImporting(true);
    setErrorMessage(null);
    try {
      const imported = pendingCsvRows.map((r) => r.transaction);
      await importTransactions({ imported, mode });
      setStatusMessage(
        `已${mode === "replace" ? "覆蓋" : "新增"}匯入 ${imported.length} 筆交易紀錄`,
      );
      setPendingCsvRows(null);
      setPendingCsvBytes(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "CSV 匯入失敗");
    } finally {
      setCsvImporting(false);
    }
  };

  const handleExportOrder = () => {
    const json = serializeHoldingsOrderBackup(holdingsOrder);
    downloadBlob("stockify_holdings_order.json", json, "application/json;charset=utf-8");
    setStatusMessage("已匯出持股排序設定");
  };

  const handleImportOrder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrorMessage(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseHoldingsOrderBackup(bytes);
      await updateHoldingsOrder(parsed);
      setStatusMessage("已匯入持股排序設定");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "匯入持股排序失敗");
    }
  };

  const handleClearCaches = async () => {
    queryClient.setQueryData(PORTFOLIO_QUERY_KEYS.quotes(userId), {});
    await handleUpdate({ dividendInfoCache: {} });
    setStatusMessage("已清除即時報價與股息快取");
  };

  const handleConfirmDangerousDelete = async () => {
    if (!confirmDeleteMode) return;
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      if (confirmDeleteMode === "transactions") {
        await clearAllTransactions();
        setStatusMessage("已刪除全部交易資料（帳戶設定已保留）");
      } else {
        await clearAllUserData();
        setStatusMessage("已刪除全部使用者資料（股票主清單已保留）");
      }
      setConfirmDeleteMode(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "刪除資料失敗");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">設定與資料管理</h1>
        <p className="text-xs text-muted-foreground">
          自訂外觀、計算規則、交易費率、即時資料來源與 CSV 備份還原
        </p>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 1. Theme & Text Size & Home Display */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <h2 className="text-base font-semibold">外觀與首頁顯示</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="setting-theme"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              主題外觀
            </label>
            <select
              id="setting-theme"
              value={settings.theme}
              onChange={(e) => {
                const next = e.target.value as ThemeMode;
                applyThemeToDocument(next);
                void handleUpdate({ theme: next });
              }}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={ThemeMode.SYSTEM}>跟隨系統 (System)</option>
              <option value={ThemeMode.LIGHT}>淺色 (Light)</option>
              <option value={ThemeMode.DARK}>深色 (Dark)</option>
              <option value={ThemeMode.AMOLED}>純黑 (AMOLED)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-text-size"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              文字大小
            </label>
            <select
              id="setting-text-size"
              value={settings.textSizeMode}
              onChange={(e) => {
                const next = e.target.value as TextSizeMode;
                applyTextSizeToDocument(next);
                void handleUpdate({ textSizeMode: next });
              }}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              {TEXT_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.scale})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showTaiwanWeightedIndex}
              onChange={(e) =>
                void handleUpdate({ showTaiwanWeightedIndex: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>首頁顯示加權指數</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showTaiwanPortfolioChart}
              onChange={(e) =>
                void handleUpdate({ showTaiwanPortfolioChart: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>首頁顯示投資組合歷史圖表</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.homeHistoryChartExpanded}
              onChange={(e) =>
                void handleUpdate({ homeHistoryChartExpanded: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>預設展開首頁歷史圖表</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.detailHistoryChartExpanded}
              onChange={(e) =>
                void handleUpdate({
                  detailHistoryChartExpanded: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border"
            />
            <span>預設展開個股歷史圖表</span>
          </label>
        </div>
      </div>

      {/* 2. P&L & Calculation Settings */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <h2 className="text-base font-semibold">損益與報酬計算</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="setting-return-mode"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              報酬率計算模式
            </label>
            <select
              id="setting-return-mode"
              value={settings.returnRateMode}
              onChange={(e) =>
                void handleUpdate({
                  returnRateMode: e.target.value as ReturnRateMode,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={ReturnRateMode.REMAINING_POSITION}>
                剩餘部位成本
              </option>
              <option value={ReturnRateMode.CUMULATIVE_INVESTMENT}>
                歷來投入成本
              </option>
              <option value={ReturnRateMode.XIRR}>年化報酬率 (XIRR)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-rounding"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              手續費與金額取整方式
            </label>
            <select
              id="setting-rounding"
              value={settings.calculationRoundingMode}
              onChange={(e) =>
                void handleUpdate({
                  calculationRoundingMode: e.target
                    .value as CalculationRoundingMode,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={CalculationRoundingMode.ROUND}>四捨五入</option>
              <option value={CalculationRoundingMode.FLOOR}>無條件捨去</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.partialSalesAsRealized}
              onChange={(e) =>
                void handleUpdate({ partialSalesAsRealized: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>部分賣出列入已實現損益</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.excludeDividendIncomeFromReturns}
              onChange={(e) =>
                void handleUpdate({
                  excludeDividendIncomeFromReturns: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border"
            />
            <span>損益與報酬排除股息收入</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.preDeductSellFees}
              onChange={(e) =>
                void handleUpdate({ preDeductSellFees: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>未實現損益預扣賣出手續費與交易稅</span>
          </label>
        </div>
      </div>

      {/* 3. Margin & Short Selling */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">台股融資融券設定</h2>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.marginFeatureEnabled}
              onChange={(e) =>
                void handleUpdate({ marginFeatureEnabled: e.target.checked })
              }
              className="h-4 w-4 rounded border"
            />
            <span>啟用融資融券功能</span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="setting-margin-days"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              計息天數基準
            </label>
            <select
              id="setting-margin-days"
              value={settings.marginDayCount}
              onChange={(e) =>
                void handleUpdate({
                  marginDayCount: Number(e.target.value) as 360 | 365,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={365}>365 天</option>
              <option value={360}>360 天</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-margin-rate"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              預設融資年利率 (%)
            </label>
            <input
              id="setting-margin-rate"
              type="number"
              step="any"
              value={settings.defaultMarginAnnualRate}
              onChange={(e) =>
                void handleUpdate({
                  defaultMarginAnnualRate: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>

          <div>
            <label
              htmlFor="setting-short-rate"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              預設融券年費率 (%)
            </label>
            <input
              id="setting-short-rate"
              type="number"
              step="any"
              value={settings.defaultShortBorrowAnnualRate}
              onChange={(e) =>
                void handleUpdate({
                  defaultShortBorrowAnnualRate: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* 4. Data Sources & Sync */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <h2 className="text-base font-semibold">即時報價來源與清單同步</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="setting-tw-source"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              台股報價來源
            </label>
            <select
              id="setting-tw-source"
              value={settings.stockDataSource}
              onChange={(e) =>
                void handleUpdate({
                  stockDataSource: e.target.value as StockDataSource,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={StockDataSource.TWSE}>TWSE (備援 Yahoo)</option>
              <option value={StockDataSource.YAHOO}>Yahoo (備援 TWSE)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-us-source"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              美股報價來源
            </label>
            <select
              id="setting-us-source"
              value={settings.usStockDataSource}
              onChange={(e) =>
                void handleUpdate({
                  usStockDataSource: e.target.value as UsStockDataSource,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={UsStockDataSource.NASDAQ}>
                Nasdaq (備援 Yahoo)
              </option>
              <option value={UsStockDataSource.YAHOO}>
                Yahoo (備援 Nasdaq)
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="setting-refresh-interval"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              盤中更新頻率
            </label>
            <select
              id="setting-refresh-interval"
              value={settings.refreshInterval}
              onChange={(e) =>
                void handleUpdate({
                  refreshInterval: Number(e.target.value),
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={10}>10 秒</option>
              <option value={15}>15 秒</option>
              <option value={30}>30 秒</option>
              <option value={60}>60 秒</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.notifyFallbackRepeatedly}
            onChange={(e) =>
              void handleUpdate({ notifyFallbackRepeatedly: e.target.checked })
            }
            className="h-4 w-4 rounded border"
          />
          <span>切換備援報價來源時重複提示通知</span>
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={syncingMarket !== null}
            onClick={() => void handleSyncStocks(StockMarket.TW)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncingMarket === StockMarket.TW ? "animate-spin" : ""}`}
            />
            <span>同步台股清單</span>
          </button>
          <button
            type="button"
            disabled={syncingMarket !== null}
            onClick={() => void handleSyncStocks(StockMarket.US)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncingMarket === StockMarket.US ? "animate-spin" : ""}`}
            />
            <span>同步美股清單</span>
          </button>
        </div>
      </div>

      {/* 5. Accounts, Fees & Tax Rates */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">證券帳戶與費率 / 稅率</h2>
          <button
            type="button"
            onClick={() => openAccountDialog(null)}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新增帳戶</span>
          </button>
        </div>

        <ul className="divide-y rounded-lg border">
          {accounts.map((acc) => (
            <li
              key={acc.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium">{acc.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  折扣 {acc.feeDiscount ?? settings.feeDiscount} · 整股低消{" "}
                  {acc.minFeeRegular ?? settings.minFeeRegular} · 零股低消{" "}
                  {acc.minFeeOddLot ?? settings.minFeeOddLot}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAccountDialog(acc)}
                  className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                >
                  編輯
                </button>
                {accounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void removeAccount(acc.id)}
                    className="rounded border px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10"
                  >
                    刪除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label
              htmlFor="setting-fee-discount"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              預設手續費折數
            </label>
            <input
              id="setting-fee-discount"
              type="number"
              step="any"
              value={settings.feeDiscount}
              onChange={(e) =>
                void handleUpdate({
                  feeDiscount: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-min-fee-reg"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              整股最低手續費
            </label>
            <input
              id="setting-min-fee-reg"
              type="number"
              step="any"
              value={settings.minFeeRegular}
              onChange={(e) =>
                void handleUpdate({
                  minFeeRegular: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-min-fee-odd"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              零股最低手續費
            </label>
            <input
              id="setting-min-fee-odd"
              type="number"
              step="any"
              value={settings.minFeeOddLot}
              onChange={(e) =>
                void handleUpdate({
                  minFeeOddLot: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-div-fee"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              配息匯費
            </label>
            <input
              id="setting-div-fee"
              type="number"
              step="any"
              value={settings.dividendFee}
              onChange={(e) =>
                void handleUpdate({
                  dividendFee: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label
              htmlFor="setting-tax-normal"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              一般股票證交稅率
            </label>
            <input
              id="setting-tax-normal"
              type="number"
              step="any"
              value={settings.taxRateNormalListedStock}
              onChange={(e) =>
                void handleUpdate({
                  taxRateNormalListedStock: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-tax-etf"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              台股 ETF 稅率
            </label>
            <input
              id="setting-tax-etf"
              type="number"
              step="any"
              value={settings.taxRateDomesticStockEtf}
              onChange={(e) =>
                void handleUpdate({
                  taxRateDomesticStockEtf: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-tax-bond"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              債券 ETF 稅率
            </label>
            <input
              id="setting-tax-bond"
              type="number"
              step="any"
              value={settings.taxRateBondEtf}
              onChange={(e) =>
                void handleUpdate({
                  taxRateBondEtf: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label
              htmlFor="setting-tax-day"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              當沖證交稅率
            </label>
            <input
              id="setting-tax-day"
              type="number"
              step="any"
              value={settings.taxRateDayTrading}
              onChange={(e) =>
                void handleUpdate({
                  taxRateDayTrading: Number(e.target.value) || 0,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* 6. Data Management */}
      <div className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">資料管理與備份</h2>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            匯出與匯入採用 46 欄完整 CSV 格式（支援 UTF-8、Big5、UTF-16）。匯入將保留原始手續費與金額欄位，不會自動重算覆蓋。
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            <span>匯出交易 CSV (46 欄)</span>
          </button>
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>匯入交易 CSV</span>
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void handleCsvFileSelected(e)}
            className="hidden"
            aria-label="選擇交易 CSV 檔案"
          />

          <button
            type="button"
            onClick={handleExportOrder}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            <span>匯出持股排序 JSON</span>
          </button>
          <button
            type="button"
            onClick={() => orderInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>匯入持股排序 JSON</span>
          </button>
          <input
            ref={orderInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handleImportOrder(e)}
            className="hidden"
            aria-label="選擇持股排序 JSON 檔案"
          />

          <button
            type="button"
            onClick={() => void handleClearCaches()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>清除報價與股息快取</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <button
            type="button"
            onClick={() => setConfirmDeleteMode("transactions")}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>刪除全部交易資料</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteMode("all")}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>刪除全部資料</span>
          </button>
        </div>
      </div>

      {/* Version Footer */}
      <footer className="py-2 text-center text-xs text-muted-foreground">
        目前版本 v0.1.0
      </footer>

      {/* Account Dialog */}
      {accountDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <form
            onSubmit={(e) => void handleSaveAccount(e)}
            className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-6 shadow-lg"
          >
            <h3 className="text-base font-bold">
              {editingAccount ? "編輯證券帳戶" : "新增證券帳戶"}
            </h3>
            <div>
              <label
                htmlFor="acc-name"
                className="mb-1 block text-xs text-muted-foreground"
              >
                帳戶名稱
              </label>
              <input
                id="acc-name"
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label
                  htmlFor="acc-disc"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  折數 (選填)
                </label>
                <input
                  id="acc-disc"
                  type="number"
                  step="any"
                  value={accountDiscount}
                  onChange={(e) => setAccountDiscount(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="acc-min-reg"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  整股低消
                </label>
                <input
                  id="acc-min-reg"
                  type="number"
                  step="any"
                  value={accountMinRegular}
                  onChange={(e) => setAccountMinRegular(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="acc-min-odd"
                  className="mb-1 block text-xs text-muted-foreground"
                >
                  零股低消
                </label>
                <input
                  id="acc-min-odd"
                  type="number"
                  step="any"
                  value={accountMinOdd}
                  onChange={(e) => setAccountMinOdd(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAccountDialogOpen(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              >
                儲存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CSV Market Validation Error -> Force Import Modal */}
      {csvMarketError && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-bold text-amber-600">
              CSV 市場欄位與股號推斷不一致
            </h3>
            <p className="text-sm text-muted-foreground">{csvMarketError}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCsvMarketError(null);
                  setPendingCsvBytes(null);
                }}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleForceParseCsv}
                className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                忽略不一致並強制匯入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Clear vs Append Modal */}
      {pendingCsvRows && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-bold">選擇 CSV 匯入方式</h3>
            <p className="text-sm text-muted-foreground">
              已解析 {pendingCsvRows.length} 筆有效交易紀錄。請選擇要「覆蓋現有交易」或「附加至現有紀錄」：
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={csvImporting}
                onClick={() => {
                  setPendingCsvRows(null);
                  setPendingCsvBytes(null);
                }}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={csvImporting}
                onClick={() => void handleConfirmCsvImport("append")}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                附加匯入
              </button>
              <button
                type="button"
                disabled={csvImporting}
                onClick={() => void handleConfirmCsvImport("replace")}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              >
                清空並覆蓋
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteMode && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-bold text-destructive">
              {confirmDeleteMode === "transactions"
                ? "確認刪除全部交易資料？"
                : "確認刪除全部資料？"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {confirmDeleteMode === "transactions"
                ? "將清除所有交易紀錄，但保留您的證券帳戶設定。此操作無法復原。"
                : "將清除所有交易、證券帳戶、持股排序與快取，僅保留股票代號主清單。此操作無法復原。"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteMode(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDangerousDelete()}
                className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground"
              >
                {isDeleting ? "刪除中..." : "確認刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
