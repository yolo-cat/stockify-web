import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        載入驗證狀態中...
      </div>
    );
  }

  if (!user) {
    return <Navigate to={APP_ROUTES.LOGIN} replace state={{ from: location }} />;
  }

  return <Outlet />;
}
