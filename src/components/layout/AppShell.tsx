import { NavLink, Outlet } from "react-router-dom";
import {
  ArrowLeftRight,
  Coins,
  LogOut,
  PieChart,
  PlusCircle,
  Settings,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: APP_ROUTES.HOLDINGS, label: "持股", icon: TrendingUp },
  { to: APP_ROUTES.TRANSACTIONS, label: "交易", icon: ArrowLeftRight },
  { to: APP_ROUTES.ASSETS, label: "資產", icon: PieChart },
  { to: APP_ROUTES.DIVIDENDS, label: "股息", icon: Coins },
  { to: APP_ROUTES.SETTINGS, label: "設定", icon: Settings },
] as const;

export function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <NavLink
              to={APP_ROUTES.HOLDINGS}
              className="text-base font-bold tracking-tight"
            >
              韭菜記帳本
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
              to={APP_ROUTES.ADD_TRANSACTION}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>新增交易</span>
            </NavLink>
            {user?.email && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {user.email}
              </span>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>登出</span>
            </button>
          </div>
        </div>
      </header>

      <main className="container flex-1 py-4 pb-20 md:pb-6">
        <Outlet />
      </main>

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
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-xs",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
