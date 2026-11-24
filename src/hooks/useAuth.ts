import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  isSupabaseConfigured,
  SUPABASE_CONFIG_WARNING,
  supabase,
} from "@/integrations/supabase/client";
import { DEMO_USER_ID } from "@/services/localDemoStore";

const DEMO_SESSION_STORAGE_KEY = "stockify_demo_mode";

function createDemoUser(): User {
  return {
    id: DEMO_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "demo@stockify.local",
    app_metadata: { provider: "demo" },
    user_metadata: { full_name: "Demo User" },
    created_at: "2025-01-01T00:00:00.000Z",
  } as User;
}

function hasOptedIntoDemoMode(): boolean {
  if (isSupabaseConfigured || typeof window === "undefined") {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      window.sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isConfigured: boolean;
  isDemoMode: boolean;
  configWarning: string | null;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() =>
    hasOptedIntoDemoMode(),
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) {
        setSession(nextSession);
        setIsLoading(false);
      }
    });

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data.session ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSession(null);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const enterDemoMode = useCallback(() => {
    if (isSupabaseConfigured) return;
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, "1");
      } catch {
        // Ignore sessionStorage errors
      }
    }
    setIsDemoMode(true);
  }, []);

  const exitDemoMode = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
      } catch {
        // Ignore sessionStorage errors
      }
    }
    setIsDemoMode(false);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) {
      return {
        error: new Error(
          SUPABASE_CONFIG_WARNING ?? "Supabase is not configured.",
        ),
      };
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/holdings`,
      },
    });

    return { error: error ? new Error(error.message) : null };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSession(null);
      exitDemoMode();
      return { error: null };
    }

    const { error } = await supabase.auth.signOut();
    return { error: error ? new Error(error.message) : null };
  }, [exitDemoMode]);

  const demoUser = useMemo(
    () => (isDemoMode && !isSupabaseConfigured ? createDemoUser() : null),
    [isDemoMode],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? demoUser,
      isLoading,
      isConfigured: isSupabaseConfigured,
      isDemoMode: isDemoMode && !isSupabaseConfigured,
      configWarning: SUPABASE_CONFIG_WARNING,
      signInWithGoogle,
      signOut,
      enterDemoMode,
      exitDemoMode,
    }),
    [
      session,
      demoUser,
      isLoading,
      isDemoMode,
      signInWithGoogle,
      signOut,
      enterDemoMode,
      exitDemoMode,
    ],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
