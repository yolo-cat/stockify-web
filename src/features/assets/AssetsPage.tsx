import { useMemo, useRef, useState } from "react";
import {
  Download,
  Landmark,
  Pencil,
  PieChart as PieChartIcon,
  Plus,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  ASSET_BALANCE_BACKUP_FILE_NAME,
  formatAssetInputAmount,
  formatMarketAmount,
  nextAssetBalanceId,
  parseAssetBalanceBackup,
  serializeAssetBalanceBackup,
} from "@/domain";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import {
  StockMarket,
  type AssetBalances,
  type BankDeposit,
  type Loan,
} from "@/types";

const TABLEAU_16 = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#BAB0AC",
  "#86BCB6",
  "#F1CE63",
  "#D37295",
  "#A0CBE8",
  "#FFBE7D",
  "#8CD17D",
] as const;

const LOAN_COLOR = "#D32F2F";

function sliceColorAt(index: number, isLoan: boolean): string {
  if (isLoan) return LOAN_COLOR;
  if (index < TABLEAU_16.length) return TABLEAU_16[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 62%, 56%)`;
}

type ChartMode = "category" | "item";

interface PieSliceItem {
  key: string;
  name: string;
  value: number;
  absValue: number;
  color: string;
  isLoan: boolean;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AssetsPage() {
  const {
    isLoading,
    assetBalances,
    assetOverviewUiState,
    saveBankDeposit,
    removeBankDeposit,
    saveLoan,
    removeLoan,
    replaceAssetBalances,
  } = usePortfolioData();

  const [chartMode, setChartMode] = useState<ChartMode>("category");
  const [selectedSliceKey, setSelectedSliceKey] = useState<string | null>(null);

  // CRUD dialog state
  const [dialogKind, setDialogKind] = useState<"deposit" | "loan" | null>(null);
  const [editingItem, setEditingItem] = useState<BankDeposit | Loan | null>(
    null,
  );
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);

  // Backup import preview state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<AssetBalances | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importApplying, setImportApplying] = useState(false);

  const fmtTwd = (val: number) =>
    `NT$${formatMarketAmount(val, StockMarket.TW)}`;

  const pieSlices = useMemo<PieSliceItem[]>(() => {
    if (chartMode === "category") {
      const raw: Array<{
        key: string;
        name: string;
        value: number;
        isLoan: boolean;
      }> = [
        {
          key: "cat:tw",
          name: "台股",
          value: assetOverviewUiState.taiwanStockValue,
          isLoan: false,
        },
        {
          key: "cat:us",
          name: "美股",
          value: assetOverviewUiState.usStockValue,
          isLoan: false,
        },
        {
          key: "cat:deposit",
          name: "銀行存款",
          value: assetOverviewUiState.totalBankDeposit,
          isLoan: false,
        },
        {
          key: "cat:loan",
          name: "貸款",
          value: -assetOverviewUiState.totalLoan,
          isLoan: true,
        },
      ];
      let colorIdx = 0;
      return raw
        .filter((r) => Math.abs(r.value) > 0)
        .map((r) => ({
          ...r,
          absValue: Math.abs(r.value),
          color: sliceColorAt(r.isLoan ? 0 : colorIdx++, r.isLoan),
        }));
    }

    const items: Array<{
      key: string;
      name: string;
      value: number;
      isLoan: boolean;
    }> = [];
    for (const sv of assetOverviewUiState.stockValues) {
      if (Math.abs(sv.marketValue) <= 0) continue;
      items.push({
        key: `stock:${sv.stock.market}:${sv.stock.code}`,
        name: `${sv.stock.code} ${sv.stock.name}`,
        value: sv.marketValue,
        isLoan: false,
      });
    }
    for (const d of assetOverviewUiState.bankDeposits) {
      if (d.amount <= 0) continue;
      items.push({
        key: `deposit:${d.id}`,
        name: d.name,
        value: d.amount,
        isLoan: false,
      });
    }
    for (const l of assetOverviewUiState.loans) {
      if (l.amount <= 0) continue;
      items.push({
        key: `loan:${l.id}`,
        name: l.name,
        value: -l.amount,
        isLoan: true,
      });
    }

    let colorIdx = 0;
    return items.map((item) => ({
      ...item,
      absValue: Math.abs(item.value),
      color: sliceColorAt(item.isLoan ? 0 : colorIdx++, item.isLoan),
    }));
  }, [chartMode, assetOverviewUiState]);

  const selectedSlice = useMemo(
    () => pieSlices.find((s) => s.key === selectedSliceKey) ?? null,
    [pieSlices, selectedSliceKey],
  );

  const openDialog = (
    kind: "deposit" | "loan",
    item: BankDeposit | Loan | null = null,
  ) => {
    setDialogKind(kind);
    setEditingItem(item);
    setNameInput(item ? item.name : "");
    setAmountInput(item ? formatAssetInputAmount(item.amount) : "");
    setDialogError(null);
  };

  const handleSaveDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialogKind) return;
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setDialogError("名稱不可為空白");
      return;
    }
    const parsedAmount = Number(amountInput.trim());
    if (!amountInput.trim() || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setDialogError("金額須為大於或等於 0 的有效數字");
      return;
    }

    setDialogSaving(true);
    setDialogError(null);
    try {
      if (dialogKind === "deposit") {
        const id =
          editingItem?.id ??
          nextAssetBalanceId(assetBalances.bankDeposits.map((d) => d.id));
        await saveBankDeposit({ id, name: trimmedName, amount: parsedAmount });
      } else {
        const id =
          editingItem?.id ??
          nextAssetBalanceId(assetBalances.loans.map((l) => l.id));
        await saveLoan({ id, name: trimmedName, amount: parsedAmount });
      }
      setDialogKind(null);
      setEditingItem(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setDialogSaving(false);
    }
  };

  const handleExportJson = () => {
    try {
      const json = serializeAssetBalanceBackup(assetBalances);
      downloadTextFile(ASSET_BALANCE_BACKUP_FILE_NAME, json);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "匯出失敗");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseAssetBalanceBackup(bytes);
      setImportPreview(parsed);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "無法解析存款與貸款備份檔",
      );
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImportApplying(true);
    setImportError(null);
    try {
      await replaceAssetBalances(importPreview);
      setImportPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "匯入還原失敗");
    } finally {
      setImportApplying(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">資產總覽</h1>
          <p className="text-xs text-muted-foreground">
            淨資產 = 台股 + 美股 + 銀行存款 - 貸款
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            <span>匯出 JSON</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>匯入 JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
            aria-label="選擇資產備份 JSON 檔案"
          />
        </div>
      </div>

      {importError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {importError}
        </div>
      )}

      {/* Gross & Net Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground">淨資產</p>
          <p
            className="mt-1 text-xl font-bold tabular-nums"
            data-testid="net-assets-value"
          >
            {fmtTwd(assetOverviewUiState.netAssets)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            總資產 {fmtTwd(assetOverviewUiState.grossAssets)}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">台股市值</p>
          <p className="mt-1 text-base font-semibold tabular-nums">
            {fmtTwd(assetOverviewUiState.taiwanStockValue)}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">美股市值 (約當台幣)</p>
          <p className="mt-1 text-base font-semibold tabular-nums">
            {fmtTwd(assetOverviewUiState.usStockValue)}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">銀行存款</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmtTwd(assetOverviewUiState.totalBankDeposit)}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">貸款負債</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
            -{fmtTwd(assetOverviewUiState.totalLoan)}
          </p>
        </div>
      </div>

      {/* PieChart Section */}
      <div className="rounded-xl border bg-card p-5 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">資產配置圖表</h2>
          </div>

          <div
            role="tablist"
            aria-label="圖表分組模式"
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === "category"}
              onClick={() => {
                setChartMode("category");
                setSelectedSliceKey(null);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                chartMode === "category"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              資產類別
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === "item"}
              onClick={() => {
                setChartMode("item");
                setSelectedSliceKey(null);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                chartMode === "item"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              個別標的
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : pieSlices.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            尚無資產資料可繪製圖表
          </div>
        ) : (
          <div className="grid items-center gap-6 md:grid-cols-2">
            <div className="relative mx-auto h-64 w-full max-w-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieSlices}
                    dataKey="absValue"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="58%"
                    outerRadius="86%"
                    paddingAngle={1.5}
                    onClick={(entry: PieSliceItem) => {
                      setSelectedSliceKey((prev) =>
                        prev === entry.key ? null : entry.key,
                      );
                    }}
                  >
                    {pieSlices.map((slice) => {
                      const isSelected = selectedSliceKey === slice.key;
                      return (
                        <Cell
                          key={slice.key}
                          fill={slice.color}
                          stroke={isSelected ? "hsl(var(--foreground))" : "none"}
                          strokeWidth={isSelected ? 2 : 0}
                          style={{ cursor: "pointer" }}
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip
                    formatter={(_val: unknown, _name: unknown, props: { payload?: PieSliceItem }) => {
                      const p = props?.payload;
                      if (!p) return "";
                      return fmtTwd(p.value);
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  {selectedSlice ? selectedSlice.name : "淨資產"}
                </span>
                <span className="mt-0.5 max-w-full truncate text-sm font-bold tabular-nums">
                  {selectedSlice
                    ? fmtTwd(selectedSlice.value)
                    : fmtTwd(assetOverviewUiState.netAssets)}
                </span>
              </div>
            </div>

            <ul className="max-h-64 space-y-1.5 overflow-auto pr-1">
              {pieSlices.map((slice) => {
                const isSelected = selectedSliceKey === slice.key;
                return (
                  <li key={slice.key}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedSliceKey((prev) =>
                          prev === slice.key ? null : slice.key,
                        )
                      }
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isSelected ? "bg-primary/10 font-semibold" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="truncate">{slice.name}</span>
                      </span>
                      <span
                        className={`shrink-0 tabular-nums ${
                          slice.isLoan ? "text-rose-600 dark:text-rose-400" : ""
                        }`}
                      >
                        {fmtTwd(slice.value)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Bank Deposits & Loans Lists */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Bank Deposits */}
        <div className="rounded-xl border bg-card p-5 text-card-foreground">
          <div className="flex items-center justify-between gap-2 pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-semibold">銀行存款</h2>
            </div>
            <button
              type="button"
              onClick={() => openDialog("deposit", null)}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增存款</span>
            </button>
          </div>

          {assetBalances.bankDeposits.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              尚未新增銀行存款
            </p>
          ) : (
            <ul className="divide-y">
              {assetBalances.bankDeposits.map((deposit) => (
                <li
                  key={deposit.id}
                  className="flex items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="truncate font-medium">{deposit.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums font-semibold">
                      {fmtTwd(deposit.amount)}
                    </span>
                    <button
                      type="button"
                      aria-label={`編輯存款 ${deposit.name}`}
                      onClick={() => openDialog("deposit", deposit)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`刪除存款 ${deposit.name}`}
                      onClick={() => void removeBankDeposit(deposit.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Loans */}
        <div className="rounded-xl border bg-card p-5 text-card-foreground">
          <div className="flex items-center justify-between gap-2 pb-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <h2 className="text-base font-semibold">貸款負債</h2>
            </div>
            <button
              type="button"
              onClick={() => openDialog("loan", null)}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增貸款</span>
            </button>
          </div>

          {assetBalances.loans.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              尚未新增貸款項目
            </p>
          ) : (
            <ul className="divide-y">
              {assetBalances.loans.map((loan) => (
                <li
                  key={loan.id}
                  className="flex items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="truncate font-medium">{loan.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                      -{fmtTwd(loan.amount)}
                    </span>
                    <button
                      type="button"
                      aria-label={`編輯貸款 ${loan.name}`}
                      onClick={() => openDialog("loan", loan)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`刪除貸款 ${loan.name}`}
                      onClick={() => void removeLoan(loan.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Add/Edit Deposit or Loan Dialog */}
      {dialogKind && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <form
            onSubmit={(e) => void handleSaveDialog(e)}
            className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-lg"
          >
            <h2 id="asset-dialog-title" className="text-base font-bold">
              {editingItem ? "編輯" : "新增"}
              {dialogKind === "deposit" ? "銀行存款" : "貸款項目"}
            </h2>

            {dialogError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
              >
                {dialogError}
              </div>
            )}

            <div>
              <label
                htmlFor="asset-item-name"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                名稱
              </label>
              <input
                id="asset-item-name"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={
                  dialogKind === "deposit" ? "例如 台新 Richart" : "例如 房貸"
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="asset-item-amount"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                金額 (TWD)
              </label>
              <input
                id="asset-item-amount"
                type="number"
                inputMode="decimal"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={dialogSaving}
                onClick={() => setDialogKind(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={dialogSaving}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {dialogSaving ? "儲存中..." : "儲存"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-import-preview-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-lg">
            <h2 id="asset-import-preview-title" className="text-base font-bold">
              確認還原存款與貸款備份？
            </h2>
            <p className="text-xs text-muted-foreground">
              驗證通過（格式 `stockify.asset-balances` v1）。確認後將以以下資料完整替換現有存款與貸款：
            </p>
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between">
                <span>銀行存款筆數</span>
                <span className="font-semibold">
                  {importPreview.bankDeposits.length} 筆
                </span>
              </div>
              <div className="flex justify-between">
                <span>存款總額</span>
                <span className="font-semibold tabular-nums">
                  {fmtTwd(
                    importPreview.bankDeposits.reduce(
                      (s, d) => s + d.amount,
                      0,
                    ),
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>貸款筆數</span>
                <span className="font-semibold">
                  {importPreview.loans.length} 筆
                </span>
              </div>
              <div className="flex justify-between">
                <span>貸款總額</span>
                <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                  {fmtTwd(
                    importPreview.loans.reduce((s, l) => s + l.amount, 0),
                  )}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={importApplying}
                onClick={() => setImportPreview(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={importApplying}
                onClick={() => void handleConfirmImport()}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {importApplying ? "還原中..." : "確認替換"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
