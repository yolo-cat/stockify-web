import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "@/components/auth/LoginPage";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { DividendsPage } from "@/features/dividends/DividendsPage";
import { HoldingsPage } from "@/features/holdings/HoldingsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { StockDetailPage } from "@/features/stock-detail/StockDetailPage";
import { AddTransactionPage } from "@/features/transactions/AddTransactionPage";
import { TransactionDetailPage } from "@/features/transactions/TransactionDetailPage";
import { TransactionsPage } from "@/features/transactions/TransactionsPage";
import { AuthProvider } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path={APP_ROUTES.LOGIN} element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route
                  path="/"
                  element={<Navigate to={APP_ROUTES.HOLDINGS} replace />}
                />
                <Route path={APP_ROUTES.HOLDINGS} element={<HoldingsPage />} />
                <Route
                  path={APP_ROUTES.TRANSACTIONS}
                  element={<TransactionsPage />}
                />
                <Route
                  path={APP_ROUTES.ADD_TRANSACTION}
                  element={<AddTransactionPage />}
                />
                <Route
                  path={APP_ROUTES.TRANSACTION_DETAIL}
                  element={<TransactionDetailPage />}
                />
                <Route
                  path={APP_ROUTES.EDIT_TRANSACTION}
                  element={<AddTransactionPage />}
                />
                <Route path={APP_ROUTES.ASSETS} element={<AssetsPage />} />
                <Route
                  path={APP_ROUTES.DIVIDENDS}
                  element={<DividendsPage />}
                />
                <Route path={APP_ROUTES.SETTINGS} element={<SettingsPage />} />
                <Route
                  path={APP_ROUTES.STOCK_DETAIL}
                  element={<StockDetailPage />}
                />
                <Route
                  path="*"
                  element={<Navigate to={APP_ROUTES.HOLDINGS} replace />}
                />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
