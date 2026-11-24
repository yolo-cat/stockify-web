import { useParams } from "react-router-dom";

export function TransactionDetailPage() {
  const { transactionId = "" } = useParams();

  return (
    <section className="space-y-4">
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="text-xl font-bold">
          交易詳情 #{decodeURIComponent(transactionId)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 3 `ui-ledger` 垂直切片預留頁面：單筆交易完整欄位、批次依賴檢查與編輯/刪除操作。
        </p>
      </div>
    </section>
  );
}
