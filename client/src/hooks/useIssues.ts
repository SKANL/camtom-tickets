import { useState, useEffect, useRef, useCallback } from 'react';
import { Issue, TicketRow } from '@camtom/shared';
import { screenSupabase, supabase } from '../lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyTicketChange,
  createTicketStoreFromIssues,
  issuesFromStore,
  mergeSnapshot,
  TicketChange,
  ticketChangeFromPayload,
  TicketStore,
} from '../lib/ticket-sync';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface IssuesState {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  connection: ConnectionState;
}

const CACHE_KEY = 'camtom-tickets:issues';
const RESYNC_RETRY_MS = 5000;
const SNAPSHOT_PAGE_SIZE = 1000;
const MAX_SNAPSHOT_ROWS = 100_000;

export async function fetchTicketSnapshot(client: SupabaseClient = supabase): Promise<TicketRow[]> {
  const rows: TicketRow[] = [];
  let afterId = '';

  while (rows.length < MAX_SNAPSHOT_ROWS) {
    const { data, error } = await client
      .from('tickets')
      .select('*')
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(SNAPSHOT_PAGE_SIZE);
    if (error) throw new Error(error.message);

    const page = (data as TicketRow[] | null) ?? [];
    rows.push(...page);
    if (page.length < SNAPSHOT_PAGE_SIZE) return rows;

    const nextId = page[page.length - 1]?.id;
    if (!nextId || nextId <= afterId) throw new Error('Ticket snapshot cursor did not advance');
    afterId = nextId;
  }

  throw new Error(`Ticket snapshot exceeds the safety limit (${MAX_SNAPSHOT_ROWS})`);
}

function loadCache(cacheKey = CACHE_KEY): Issue[] {
  try {
    const raw = localStorage.getItem(cacheKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(issues: Issue[], cacheKey = CACHE_KEY): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(issues));
  } catch {
    // localStorage full/unavailable — ignore
  }
}

/**
 * Live tickets, sourced from Supabase:
 *   1. a stable, paginated SELECT snapshot (fast paint is seeded from localStorage cache)
 *   2. a Realtime subscription that pushes every INSERT/UPDATE/DELETE
 */
export function useIssues(cacheScope = 'legacy'): IssuesState {
  const cacheKey = cacheScope === 'legacy' ? CACHE_KEY : `${CACHE_KEY}:${cacheScope}`;
  const dataClient = cacheScope === 'legacy' ? supabase : screenSupabase;
  const initialRef = useRef<TicketStore | null>(null);
  if (!initialRef.current) initialRef.current = createTicketStoreFromIssues(loadCache(cacheKey));
  const storeRef = useRef<TicketStore>(initialRef.current);
  const [state, setState] = useState<IssuesState>(() => ({
    issues: issuesFromStore(storeRef.current),
    loading: true,
    error: null,
    lastUpdated: null,
    connection: 'connecting',
  }));

  const commit = useCallback((updates: Partial<IssuesState> = {}) => {
    const issues = issuesFromStore(storeRef.current);
    setState((prev) => ({ ...prev, issues, loading: false, error: null, lastUpdated: Date.now(), ...updates }));
    saveCache(issues, cacheKey);
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    let hydrating = true;
    let hydrationRunning = false;
    let hydrationAttempted = false;
    let connectionLost = false;
    let resyncEpoch = 1;
    let syncedEpoch = 0;
    let eventSequence = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const buffered: TicketChange[] = [];

    const hydrate = async (): Promise<boolean> => {
      hydrating = true;
      let data: TicketRow[];
      try {
        data = await fetchTicketSnapshot(dataClient);
      } catch (error) {
        if (cancelled) return false;
        for (const change of buffered) applyTicketChange(storeRef.current, change);
        buffered.length = 0;
        hydrating = false;
        commit({ error: error instanceof Error ? error.message : 'Ticket snapshot failed' });
        return false;
      }
      if (cancelled) return false;

      storeRef.current = mergeSnapshot(data, buffered);
      buffered.length = 0;
      hydrating = false;
      commit();
      return true;
    };

    const needsResync = () => syncedEpoch < resyncEpoch;

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestHydration();
      }, RESYNC_RETRY_MS);
    };

    const requestHydration = () => {
      if (cancelled || !needsResync() || hydrationRunning) return;
      const targetEpoch = resyncEpoch;
      hydrationAttempted = true;
      hydrationRunning = true;
      void hydrate().then((success) => {
        hydrationRunning = false;
        if (cancelled) return;
        if (success) syncedEpoch = Math.max(syncedEpoch, targetEpoch);

        if (needsResync()) {
          // A reconnect requested another snapshot while this one was in flight.
          if (success) requestHydration();
          else scheduleRetry();
        }
      });
    };

    const channel = dataClient
      .channel(`tickets-changes:${cacheScope}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        (payload) => {
          const change = ticketChangeFromPayload(payload, ++eventSequence);
          if (!change) return;
          if (hydrating) buffered.push(change);
          else if (applyTicketChange(storeRef.current, change)) commit();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (connectionLost) {
            connectionLost = false;
            resyncEpoch++;
          }
          setState((prev) => ({ ...prev, connection: 'live', error: null }));
          requestHydration();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          connectionLost = true;
          resyncEpoch++;
          scheduleRetry();
          setState((prev) => ({
            ...prev,
            connection: 'reconnecting',
            error: 'Se perdió la conexión en tiempo real — reintentando…',
          }));
        }
      });

    // Do not leave a usable cached board blocked forever if Realtime cannot subscribe.
    const fallbackTimer = setTimeout(() => {
      if (!hydrationAttempted && needsResync()) requestHydration();
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      if (retryTimer) clearTimeout(retryTimer);
      dataClient.removeChannel(channel);
    };
  }, [cacheScope, commit, dataClient]);

  return state;
}
