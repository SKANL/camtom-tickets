import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TicketRow } from '@camtom/shared';

let admin: SupabaseClient | null = null;

/** Service-role client (server only). Bypasses RLS — never expose this key to the browser. */
export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables are not set');
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export async function upsertTickets(rows: TicketRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseAdmin().from('tickets').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`upsertTickets failed: ${error.message}`);
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from('tickets').delete().eq('id', id);
  if (error) throw new Error(`deleteTicket failed: ${error.message}`);
}

export async function getLastSync(): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('sync_state')
    .select('last_synced_at')
    .eq('id', 1)
    .single();
  if (error) throw new Error(`getLastSync failed: ${error.message}`);
  return data?.last_synced_at ?? null;
}

export async function setLastSync(iso: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('sync_state')
    .update({ last_synced_at: iso })
    .eq('id', 1);
  if (error) throw new Error(`setLastSync failed: ${error.message}`);
}
