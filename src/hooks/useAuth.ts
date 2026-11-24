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

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isConfigured: boolean;
  configWarning: string | null;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(isSupabaseConfigured);

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
      return { error: null };
    }

    const { error } = await supabase.auth.signOut();
    return { error: error ? new Error(error.message) : null };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isConfigured: isSupabaseConfigured,
      configWarning: SUPABASE_CONFIG_WARNING,
      signInWithGoogle,
      signOut,
    }),
    [session, isLoading, signInWithGoogle, signOut],
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
