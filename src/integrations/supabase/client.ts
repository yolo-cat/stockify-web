import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_SUPABASE_KEY = "placeholder-anon-key";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

export const isSupabaseConfigured = Boolean(configuredUrl && configuredKey);

export const SUPABASE_CONFIG_WARNING = isSupabaseConfigured
  ? null
  : "Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY) are not configured. Running in unauthenticated local preview mode.";

if (!isSupabaseConfigured && typeof console !== "undefined") {
  console.warn(`[stockify-web] ${SUPABASE_CONFIG_WARNING}`);
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  configuredUrl || FALLBACK_SUPABASE_URL,
  configuredKey || FALLBACK_SUPABASE_KEY,
  {
    auth: {
      persistSession: isSupabaseConfigured,
      autoRefreshToken: isSupabaseConfigured,
      detectSessionInUrl: isSupabaseConfigured,
    },
  },
);
