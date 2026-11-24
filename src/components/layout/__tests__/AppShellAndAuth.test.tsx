import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";

function renderWithRouter(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path={APP_ROUTES.LOGIN} element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route path={APP_ROUTES.HOLDINGS} element={<div>HoldingsView</div>} />
              <Route path={APP_ROUTES.STOCK_DETAIL} element={<div>StockDetailView</div>} />
              <Route path={APP_ROUTES.ADD_TRANSACTION} element={<div>AddTxView</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("LoginPage & AppShell", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    document.documentElement.classList.remove("dark", "amoled");
    document.documentElement.style.fontSize = "";
  });

  it("shows demo preview button when Supabase is unconfigured and enters demo mode on click", async () => {
    renderWithRouter(APP_ROUTES.LOGIN);
    expect(screen.getByText("韭菜記帳本")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /使用 Google 帳號登入/i }),
    ).toBeInTheDocument();

    const demoBtn = screen.getByRole("button", {
      name: /進入本地預覽模式 \(示範資料\)/i,
    });
    fireEvent.click(demoBtn);

    expect(await screen.findByText("HoldingsView")).toBeInTheDocument();
  });

  it("renders 5 navigation tabs and prefills stockCode & market on stock detail route", async () => {
    window.sessionStorage.setItem("stockify_demo_mode", "1");
    renderWithRouter("/stocks/TW/2330");

    expect(await screen.findByText("StockDetailView")).toBeInTheDocument();
    expect(screen.getAllByText("持股").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("交易").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("資產").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("股息").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("設定").length).toBeGreaterThanOrEqual(1);

    const addLink = screen.getByRole("link", { name: /\+ 新增交易/i });
    expect(addLink).toHaveAttribute(
      "href",
      "/transactions/new?stockCode=2330&market=TW",
    );
  });

  it("hides mobile bottom navigation bar on /transactions/new", async () => {
    window.sessionStorage.setItem("stockify_demo_mode", "1");
    renderWithRouter(APP_ROUTES.ADD_TRANSACTION);

    expect(await screen.findByText("AddTxView")).toBeInTheDocument();
    expect(screen.queryByLabelText("底部導覽")).not.toBeInTheDocument();
  });
});
