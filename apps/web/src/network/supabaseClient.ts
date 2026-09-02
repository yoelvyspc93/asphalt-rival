import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const MISSING_SUPABASE_ENV_MESSAGE =
  "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Configura Supabase para jugar online o usa la demo local.";

export const SUPABASE_CONFIG_ERROR = MISSING_SUPABASE_ENV_MESSAGE;

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseConfig(): SupabaseConfig | null {
  const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env;
  const url = environment?.VITE_SUPABASE_URL?.trim();
  const anonKey = environment?.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let sharedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) return null;
  sharedClient ??= createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return sharedClient;
}
