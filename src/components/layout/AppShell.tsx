import { useEffect } from "react";
import { NavLink, Outlet, useMatch } from "react-router-dom";
import {
  ArrowLeftRight,
  Coins,
  LogOut,
  PieChart,
  PlusCircle,
  Settings,
  TrendingUp,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { APP_ROUTES, createAddTransactionRoute } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { TextSizeMode, ThemeMode } from "@/types";

const NAV_ITEMS = [
  { to: APP_ROUTES.HOLDINGS, label: "持股", icon: TrendingUp },
  { to: APP_ROUTES.TRANSACTIONS, label: "交易", icon: ArrowLeftRight },
  { to: APP_ROUTES.ASSETS, label: "資產", icon: PieChart },
  { to: APP_ROUTES.DIVIDENDS, label: "股息", icon: Coins },
  { to: APP_ROUTES.SETTINGS, label: "設定", icon: Settings },
] as const;

const TEXT_SIZE_SCALES: Record<TextSizeMode, number> = {
  [TextSizeMode.EXTRA_SMALL]: 0.82,
  [TextSizeMode.SMALL]: 0.9,
  [TextSizeMode.DEFAULT]: 1.0,
  [TextSizeMode.LARGE]: 1.15,
  [TextSizeMode.EXTRA_LARGE]: 1.3,
};

export function AppShell() {
  const { user, isDemoMode, signOut } = useAuth();
  const { settings, noticeMessage, clearNoticeMessage } = usePortfolioData();

  const stockDetailMatch = useMatch(APP_ROUTES.STOCK_DETAIL);
  const isAddTxRoute = Boolean(useMatch(APP_ROUTES.ADD_TRANSACTION));
  const isEditTxRoute = Boolean(useMatch(APP_ROUTES.EDIT_TRANSACTION));
  const hideMobileBottomBar = isAddTxRoute || isEditTxRoute;

  const addTransactionTo = stockDetailMatch?.params.stockCode
    ? createAddTransactionRoute({
        market: stockDetailMatch.params.market ?? "TW",
        stockCode: decodeURIComponent(stockDetailMatch.params.stockCode),
      })
    : APP_ROUTES.ADD_TRANSACTION;

  // Apply ThemeMode (System / Light / Dark / AMOLED) to document.documentElement
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (isSystemDark: boolean) => {
      root.classList.remove("dark", "amoled");
      if (settings.theme === ThemeMode.AMOLED) {
        root.classList.add("dark", "amoled");
      } else if (settings.theme === ThemeMode.DARK) {
        root.classList.add("dark");
      } else if (settings.theme === ThemeMode.SYSTEM && isSystemDark) {
        root.classList.add("dark");
      }
    };

    const mediaQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    applyTheme(mediaQuery?.matches ?? false);

    if (settings.theme !== ThemeMode.SYSTEM || !mediaQuery) {
      return;
    }

    const listener = (event: MediaQueryListEvent) => applyTheme(event.matches);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [settings.theme]);

  // Apply TextSizeMode font scale
  useEffect(() => {
    const scale = TEXT_SIZE_SCALES[settings.textSizeMode] ?? 1.0;
    document.documentElement.style.fontSize = `${(16 * scale).toFixed(2)}px`;
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [settings.textSizeMode]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <NavLink
              to={APP_ROUTES.HOLDINGS}
              className="flex items-center gap-2 text-base font-bold tracking-tight"
            >
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>韭菜記帳本</span>
            </NavLink>
            <nav className="hidden items-center gap-1 md:flex" aria-label="主導覽">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <NavLink
              to={addTransactionTo}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>+ 新增交易</span>
            </NavLink>
            {isDemoMode ? (
              <span className="hidden rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 sm:inline-flex">
                預覽模式
              </span>
            ) : (
              user?.email && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {user.email}
                </span>
              )
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>登出</span>
            </button>
          </div>
        </div>
      </header>

      {noticeMessage && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          <div className="container flex items-center justify-between gap-2">
            <span>{noticeMessage}</span>
            <button
              type="button"
              onClick={clearNoticeMessage}
              aria-label="關閉通知"
              className="rounded p-0.5 hover:bg-amber-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <main
        className={cn(
          "container flex-1 py-4",
          hideMobileBottomBar ? "pb-6" : "pb-20 md:pb-6",
        )}
      >
        <Outlet />
      </main>

      {!hideMobileBottomBar && (
        <nav
          aria-label="底部導覽"
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden"
        >
          <div className="grid grid-cols-5">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
                    isActive
                      ? "font-semibold text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
