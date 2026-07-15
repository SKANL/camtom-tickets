import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Fail loud in dev — a silent misconfig would show an empty board with no clue why.
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set');
}

// Anon key is safe in the browser: RLS restricts it to SELECT on public.tickets.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
