import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Fail loud in dev — a silent misconfig would show an empty board with no clue why.
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set');
}

// Legacy/root dashboards remain an unauthenticated anon-key client so enabling
// or rolling back screen control never changes their ticket policy/session.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Dedicated TV identity client. Keeping its session isolated avoids an
// anonymous screen login narrowing the legacy root client's ticket scope.
export const screenSupabase = createClient(url, anonKey, {
  // Anonymous TV identities survive reloads so RLS can keep one browser
  // profile bound to one screen. A service-role key is never used here.
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'camtom-screen-auth-v1',
  },
});
