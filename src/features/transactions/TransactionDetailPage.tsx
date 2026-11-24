import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  canDeleteTransaction,
  formatMarketAmount,
  formatShareCount,
} from "@/domain";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import {
  APP_ROUTES,
  createEditTransactionRoute,
} from "@/lib/routes";
import { StockMarket, TransactionType } from "@/types";

function formatDisplayDate(millis: number): string {
  const d = new Date(millis);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-right">{value}</span>
    </div>
  );
}

export function TransactionDetailPage() {
  const { transactionId = "" } = useParams();
  const navigate = useNavigate();
  const {
    isLoading,
    transactions,
    transactionsWithStock,
    accounts,
    removeTransaction,
  } = usePortfolioData();

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const numericId = Number(decodeURIComponent(transactionId));

  const item = useMemo(
    () =>
      transactionsWithStock.find(
        (entry) => entry.transaction.id === numericId,
      ) ?? null,
    [transactionsWithStock, numericId],
  );

  const accountName = useMemo(() => {
    if (!item) return "";
    return (
      accounts.find((a) => a.id === item.transaction.accountId)?.name ??
      `帳戶 #${item.transaction.accountId}`
    );
  }, [accounts, item]);

  if (isLoading && !item) {
    return (
      <section className="space-y-4" data-testid="transaction-detail-loading">
        <div className="h-10 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-64 animate-pulse rounded-xl border bg-card p-6" />
      </section>
    );
  }

  if (!item) {
    return (
      <section
        className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-12 text-center"
        data-testid="transaction-detail-missing"
      >
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-bold">找不到交易紀錄</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          交易編號 #{decodeURIComponent(transactionId)} 可能已被刪除或不存在。
        </p>
        <button
          type="button"
          onClick={() => navigate(APP_ROUTES.TRANSACTIONS)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回交易紀錄</span>
        </button>
      </section>
    );
  }

  const { transaction: tx, stock } = item;
  const market = (stock.market || tx.market) as StockMarket;
  const currencyPrefix = market === StockMarket.US ? "$" : "NT$";
  const fmtMoney = (val: number) => `${currencyPrefix}${formatMarketAmount(val, market)}`;

  const editableAndDeletable = canDeleteTransaction(tx, transactions);
  const lockReason =
    "此開倉交易已被後續的融資還款、買券還券或融券補償引用，無法編輯或刪除。";

  const typeLabel =
    tx.type === TransactionType.MARGIN_REPAYMENT ? "還融資" : tx.type;

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removeTransaction(tx);
      navigate(APP_ROUTES.TRANSACTIONS);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除交易失敗");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="space-y-4" data-testid="transaction-detail-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(APP_ROUTES.TRANSACTIONS)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回列表</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!editableAndDeletable}
            title={!editableAndDeletable ? lockReason : "編輯交易"}
            onClick={() => navigate(createEditTransactionRoute(tx.id))}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="h-4 w-4" />
            <span>編輯</span>
          </button>
          <button
            type="button"
            disabled={!editableAndDeletable}
            title={!editableAndDeletable ? lockReason : "刪除交易"}
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>刪除</span>
          </button>
        </div>
      </div>

      {!editableAndDeletable && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{lockReason}</span>
        </div>
      )}

      {deleteError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {deleteError}
        </div>
      )}

      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{tx.stockCode}</span>
              <span className="text-base text-muted-foreground">
                {stock.name}
              </span>
              <span className="rounded border px-1.5 py-0.5 text-xs font-medium">
                {market}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDisplayDate(tx.date)} · {accountName}
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
            {typeLabel}
          </span>
        </div>

        <div className="mt-2 divide-y">
          {tx.buyShares > 0 && (
            <>
              <DetailRow label="買進股數" value={`${formatShareCount(tx.buyShares)} 股`} />
              <DetailRow label="買進價格" value={fmtMoney(tx.buyPrice)} />
            </>
          )}
          {tx.sellShares > 0 && (
            <>
              <DetailRow label="賣出股數" value={`${formatShareCount(tx.sellShares)} 股`} />
              <DetailRow label="賣出價格" value={fmtMoney(tx.sellPrice)} />
            </>
          )}
          {tx.fee > 0 && <DetailRow label="手續費" value={fmtMoney(tx.fee)} />}
          {tx.tax > 0 && <DetailRow label="交易稅" value={fmtMoney(tx.tax)} />}
          {tx.expense > 0 && <DetailRow label="總支出" value={fmtMoney(tx.expense)} />}
          {tx.income > 0 && <DetailRow label="總收入" value={fmtMoney(tx.income)} />}

          {tx.type === TransactionType.CASH_DIVIDEND && (
            <>
              <DetailRow label="每股現金股利" value={`${tx.cashDividend}`} />
              <DetailRow label="除息股數" value={`${formatShareCount(tx.exDividendShares)} 股`} />
              {tx.supplementaryHealthInsurancePremium > 0 && (
                <DetailRow
                  label="二代健保補充保費 (2.11%)"
                  value={fmtMoney(tx.supplementaryHealthInsurancePremium)}
                />
              )}
              <DetailRow label="實領股息收入" value={fmtMoney(tx.dividendIncome || tx.income)} />
            </>
          )}

          {tx.type === TransactionType.STOCK_DIVIDEND && (
            <>
              <DetailRow label="每股股票股利" value={`${tx.stockDividend}`} />
              <DetailRow label="除權股數" value={`${formatShareCount(tx.exRightsShares)} 股`} />
              <DetailRow label="配發股數" value={`${formatShareCount(tx.dividendShares)} 股`} />
            </>
          )}

          {tx.type === TransactionType.CAPITAL_REDUCTION && (
            <>
              <DetailRow label="減資比例" value={`${tx.capitalReductionRatio}%`} />
              <DetailRow label="減資前股數" value={`${formatShareCount(tx.sharesBeforeReduction)} 股`} />
              <DetailRow label="減資後股數" value={`${formatShareCount(tx.sharesAfterReduction)} 股`} />
              {tx.cashReturned > 0 && (
                <DetailRow label="減資返還現金" value={fmtMoney(tx.cashReturned)} />
              )}
            </>
          )}

          {tx.type === TransactionType.STOCK_SPLIT && (
            <>
              <DetailRow label="分割比例" value={`1 : ${tx.stockSplitRatio}`} />
              <DetailRow label="分割前股數" value={`${formatShareCount(tx.sharesBeforeSplit)} 股`} />
              <DetailRow label="分割後股數" value={`${formatShareCount(tx.sharesAfterSplit)} 股`} />
            </>
          )}

          {tx.type === TransactionType.MARGIN_BUY && (
            <>
              <DetailRow label="融資批次 ID" value={tx.marginLotId} />
              <DetailRow label="融資本金" value={fmtMoney(tx.marginPrincipal)} />
              <DetailRow label="融資年利率" value={`${tx.marginAnnualRate}%`} />
              <DetailRow
                label={tx.marginSelfFundedOverridden ? "融資自備款（手動覆寫）" : "融資自備款（自動）"}
                value={fmtMoney(
                  tx.marginSelfFundedOverridden
                    ? tx.marginSelfFunded
                    : Math.max(0, tx.expense - tx.marginPrincipal),
                )}
              />
            </>
          )}

          {tx.type === TransactionType.MARGIN_REPAYMENT && (
            <>
              <DetailRow label="沖抵融資批次" value={tx.marginRepaymentLotId} />
              <DetailRow label="融資還款本金" value={fmtMoney(tx.marginRepayment)} />
              <DetailRow label="融資實際利息" value={fmtMoney(tx.marginActualInterest)} />
            </>
          )}

          {tx.type === TransactionType.SHORT_SELL && (
            <>
              <DetailRow label="融券批次 ID" value={tx.shortLotId} />
              <DetailRow label="融券本金" value={fmtMoney(tx.shortBorrowPrincipal)} />
              <DetailRow label="融券年費率" value={`${tx.shortBorrowAnnualRate}%`} />
            </>
          )}

          {tx.type === TransactionType.SHORT_COVER && (
            <>
              <DetailRow label="沖抵融券批次" value={tx.shortCoverLotId} />
              <DetailRow label="買券還券股數" value={`${formatShareCount(tx.shortCoverShares)} 股`} />
            </>
          )}

          {tx.type === TransactionType.SHORT_COMPENSATION && (
            <>
              <DetailRow label="補償融券批次" value={tx.shortCompensationLotId} />
              <DetailRow label="融券補償金" value={fmtMoney(tx.shortCompensation)} />
            </>
          )}

          {tx.note && <DetailRow label="備註" value={tx.note} />}
        </div>
      </div>

      {confirmDeleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-tx-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
            <h2 id="delete-tx-title" className="text-base font-bold">
              確認刪除交易？
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              確定要刪除 {tx.stockCode} ({typeLabel}) 這筆交易紀錄嗎？此動作無法復原。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteOpen(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
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
