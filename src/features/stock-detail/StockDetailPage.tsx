import { useParams } from "react-router-dom";

export function StockDetailPage() {
  const { market = "TW", stockCode = "" } = useParams();

  return (
    <section className="space-y-4">
      <div className="rounded-xl border bg-card p-6 text-card-foreground">
        <h1 className="text-xl font-bold">
          個股明細 ({market}:{decodeURIComponent(stockCode)})
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 3 `ui-portfolio` 垂直切片預留頁面：個股歷史走勢、融資融券摘要與交易紀錄。
        </p>
      </div>
    </section>
  );
}
