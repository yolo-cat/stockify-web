import { useParams } from "react-router-dom";

export function AddTransactionPage() {
  const { transactionId } = useParams();
  const isEditing = Boolean(transactionId);

  return (
    <section className="space-y-4">
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="text-xl font-bold">
          {isEditing
            ? `編輯交易 #${decodeURIComponent(transactionId ?? "")}`
            : "新增交易"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 3 `ui-ledger` 垂直切片預留頁面：支援一般交易、除權息、減資/拆分與台股融資融券表單。
        </p>
      </div>
    </section>
  );
}
