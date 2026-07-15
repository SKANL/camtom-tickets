import { useState, useEffect, useRef, useCallback } from 'react';
import { Issue, TicketRow } from '@camtom/shared';
import { supabase } from '../lib/supabase';
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

function loadCache(): Issue[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(issues: Issue[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(issues));
  } catch {
    // localStorage full/unavailable — ignore
  }
}

/**
 * Live tickets, sourced from Supabase:
 *   1. one SELECT for the initial snapshot (fast paint, seeded from localStorage cache)
 *   2. a Realtime subscription that pushes every INSERT/UPDATE/DELETE
 */
export function useIssues(): IssuesState {
  const initialRef = useRef<TicketStore | null>(null);
  if (!initialRef.current) initialRef.current = createTicketStoreFromIssues(loadCache());
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
    saveCache(issues);
  }, []);

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
      const { data, error } = await supabase.from('tickets').select('*');
      if (cancelled) return false;

      if (error) {
        for (const change of buffered) applyTicketChange(storeRef.current, change);
        buffered.length = 0;
        hydrating = false;
        commit({ error: error.message });
        return false;
      }

      storeRef.current = mergeSnapshot((data as TicketRow[]) ?? [], buffered);
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

    const channel = supabase
      .channel('tickets-changes')
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
      supabase.removeChannel(channel);
    };
  }, [commit]);

  return state;
}
