import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HoldingsPage } from "@/features/holdings/HoldingsPage";
import { AuthProvider } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

function renderHoldings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[APP_ROUTES.HOLDINGS]}>
          <Routes>
            <Route path={APP_ROUTES.HOLDINGS} element={<HoldingsPage />} />
            <Route path={APP_ROUTES.ASSETS} element={<div>Assets</div>} />
            <Route path={APP_ROUTES.DIVIDENDS} element={<div>Dividends</div>} />
            <Route path={APP_ROUTES.STOCK_DETAIL} element={<div>StockDetail</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("HoldingsPage", () => {
  beforeEach(() => {
    window.sessionStorage.setItem("stockify_demo_mode", "1");
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("renders summary card, display mode cycle pill, cost/value toggle, and unrealized section", async () => {
    renderHoldings();

    expect(await screen.findByText("持股總覽")).toBeInTheDocument();
    expect(screen.getByText("累積損益")).toBeInTheDocument();
    expect(await screen.findByText(/未實現 \(\d+\)/)).toBeInTheDocument();

    // Toggle 持股市值 -> 持股成本
    const valueBtn = screen.getByRole("button", { name: /持股市值/i });
    fireEvent.click(valueBtn);
    expect(screen.getByText("持股成本")).toBeInTheDocument();

    // Cycle HomeDisplayMode: 合併 -> 台股 -> 美股 -> 合併
    const modeBtn = screen.getByRole("button", { name: "合併" });
    fireEvent.click(modeBtn);
    expect(await screen.findByRole("button", { name: "台股" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "台股" }));
    expect(await screen.findByRole("button", { name: "美股" })).toBeInTheDocument();
  }, 15000);

  it("opens AccountSwitcherModal and cycles 3-state column sort", async () => {
    renderHoldings();
    expect(await screen.findByText("持股總覽")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /全部帳戶/i }));
    expect(screen.getByRole("dialog", { name: "帳戶切換與管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "關閉帳戶視窗" }));
    expect(
      screen.queryByRole("dialog", { name: "帳戶切換與管理" }),
    ).not.toBeInTheDocument();

    // 3-state column sort: MANUAL -> COLUMN asc -> COLUMN desc -> MANUAL
    const sortButtons = screen.getAllByRole("button", { name: "市值" });
    const sortBtn = sortButtons[sortButtons.length - 1];
    fireEvent.click(sortBtn);
    expect(await screen.findByText("欄位排序")).toBeInTheDocument();
    fireEvent.click(sortBtn);
    expect(await screen.findByText("欄位排序")).toBeInTheDocument();
    fireEvent.click(sortBtn);
    expect(
      await screen.findByText("手動排序（可拖曳調整）"),
    ).toBeInTheDocument();
  });
});
