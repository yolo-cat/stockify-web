import { useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { APP_ROUTES } from "@/lib/routes";

export function LoginPage() {
  const { user, isLoading, isConfigured, configWarning, signInWithGoogle } =
    useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoading && user) {
    return <Navigate to={APP_ROUTES.HOLDINGS} replace />;
  }

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setErrorMessage(error.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">韭菜記帳本</h1>
          <p className="text-sm text-muted-foreground">
            使用 Google 帳號登入以同步您的台股、美股持股與資產總覽
          </p>
        </div>

        {!isConfigured && configWarning && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{configWarning}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {errorMessage}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={isLoading || isSubmitting || !isConfigured}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {isSubmitting ? "正在導向 Google 登入..." : "使用 Google 帳號登入"}
        </button>
      </div>
    </div>
  );
}
