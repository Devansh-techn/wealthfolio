import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when env vars are missing/placeholder, so the app shows a setup screen instead of crashing. */
export const isSupabaseConfigured = Boolean(url && anonKey && /^https?:\/\/.+/.test(url) && !/your-project/i.test(url));

// Only the public anon key is ever used in the browser. Data access is protected by Row Level Security.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;
