import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Account, UserSettings } from "@/types";

interface AccountSwitcherModalProps {
  open: boolean;
  onClose: () => void;
  accounts: readonly Account[];
  activeAccountId: number;
  settings: UserSettings;
  onSelectAccount: (accountId: number) => Promise<void>;
  onSaveAccount: (account: Account) => Promise<Account>;
  onDeleteAccount: (accountId: number) => Promise<void>;
}

function parseNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function AccountSwitcherModal({
  open,
  onClose,
  accounts,
  activeAccountId,
  settings,
  onSelectAccount,
  onSaveAccount,
  onDeleteAccount,
}: AccountSwitcherModalProps) {
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [feeDiscountInput, setFeeDiscountInput] = useState("");
  const [minRegularInput, setMinRegularInput] = useState("");
  const [minOddLotInput, setMinOddLotInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (!open) return null;

  const startAdd = () => {
    setIsAdding(true);
    setEditingAccount(null);
    setNameInput("");
    setFeeDiscountInput("");
    setMinRegularInput("");
    setMinOddLotInput("");
    setErrorMessage(null);
  };

  const startEdit = (account: Account) => {
    setIsAdding(false);
    setEditingAccount(account);
    setNameInput(account.name);
    setFeeDiscountInput(
      account.feeDiscount !== null ? String(account.feeDiscount) : "",
    );
    setMinRegularInput(
      account.minFeeRegular !== null ? String(account.minFeeRegular) : "",
    );
    setMinOddLotInput(
      account.minFeeOddLot !== null ? String(account.minFeeOddLot) : "",
    );
    setErrorMessage(null);
  };

  const cancelForm = () => {
    setIsAdding(false);
    setEditingAccount(null);
    setErrorMessage(null);
  };

  const handleSave = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setErrorMessage("帳戶名稱不可空白");
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);
    try {
      const nextId =
        editingAccount?.id ??
        (accounts.reduce((max, a) => Math.max(max, a.id), 0) + 1);
      await onSaveAccount({
        id: nextId,
        name: trimmed,
        feeDiscount: parseNullableNumber(feeDiscountInput),
        minFeeRegular: parseNullableNumber(minRegularInput),
        minFeeOddLot: parseNullableNumber(minOddLotInput),
      });
      cancelForm();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "儲存帳戶失敗");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (account: Account) => {
    if (accounts.length <= 1) {
      setErrorMessage("至少需保留一個證券帳戶");
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    try {
      await onDeleteAccount(account.id);
      if (activeAccountId === account.id) {
        await onSelectAccount(0);
      }
      if (editingAccount?.id === account.id) {
        cancelForm();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "刪除帳戶失敗");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="帳戶切換與管理"
    >
      <div className="w-full max-w-md rounded-2xl border bg-card p-5 text-card-foreground shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">切換與管理帳戶</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉帳戶視窗"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => {
              void onSelectAccount(0).then(onClose);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              activeAccountId === 0
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "hover:bg-muted/60",
            )}
          >
            <span>全部帳戶</span>
            {activeAccountId === 0 && <Check className="h-4 w-4" />}
          </button>

          {accounts.map((acc) => {
            const isSelected = activeAccountId === acc.id;
            return (
              <div
                key={acc.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
                  isSelected ? "border-primary bg-primary/10" : "hover:bg-muted/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    void onSelectAccount(acc.id).then(onClose);
                  }}
                  className="flex flex-1 items-center justify-between text-left"
                >
                  <div>
                    <div className={cn("font-medium", isSelected && "text-primary")}>
                      {acc.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      折數 {acc.feeDiscount ?? settings.feeDiscount} · 整股低消{" "}
                      {acc.minFeeRegular ?? settings.minFeeRegular} · 零股低消{" "}
                      {acc.minFeeOddLot ?? settings.minFeeOddLot}
                    </div>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-primary" />}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(acc)}
                    aria-label={`編輯 ${acc.name}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={accounts.length <= 1 || isBusy}
                    onClick={() => void handleDelete(acc)}
                    aria-label={`刪除 ${acc.name}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {(isAdding || editingAccount) && (
          <div className="mt-4 space-y-2.5 rounded-xl border bg-muted/30 p-3">
            <div className="text-xs font-semibold">
              {editingAccount ? `編輯帳戶：${editingAccount.name}` : "新增帳戶"}
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">帳戶名稱</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="例如：元大證券"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">手續費折數</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={feeDiscountInput}
                  onChange={(e) => setFeeDiscountInput(e.target.value)}
                  placeholder={String(settings.feeDiscount)}
                  className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">整股低消</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={minRegularInput}
                  onChange={(e) => setMinRegularInput(e.target.value)}
                  placeholder={String(settings.minFeeRegular)}
                  className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">零股低消</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={minOddLotInput}
                  onChange={(e) => setMinOddLotInput(e.target.value)}
                  placeholder={String(settings.minFeeOddLot)}
                  className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleSave()}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                儲存
              </button>
            </div>
          </div>
        )}

        {!isAdding && !editingAccount && (
          <button
            type="button"
            onClick={startAdd}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            新增證券帳戶
          </button>
        )}
      </div>
    </div>
  );
}
