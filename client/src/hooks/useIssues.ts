import { useState, useEffect, useRef, useCallback } from 'react';
import { Issue, TicketRow, rowToIssue } from '@camtom/shared';
import { supabase } from '../lib/supabase';

interface IssuesState {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const CACHE_KEY = 'camtom-tickets:issues';

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
  const cached = loadCache();
  const [state, setState] = useState<IssuesState>({
    issues: cached,
    loading: true,
    error: null,
    lastUpdated: cached.length > 0 ? Date.now() : null,
  });
  const mapRef = useRef<Map<string, Issue>>(new Map(cached.map((i) => [i.id, i])));

  const commit = useCallback(() => {
    const issues = Array.from(mapRef.current.values()).sort((a, b) => a.priority - b.priority);
    setState({ issues, loading: false, error: null, lastUpdated: Date.now() });
    saveCache(issues);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.from('tickets').select('*');
      if (cancelled) return;
      if (error) {
        setState((prev) => ({ ...prev, loading: false, error: error.message }));
        return;
      }
      const map = new Map<string, Issue>();
      for (const row of (data as TicketRow[]) ?? []) {
        map.set(row.id, rowToIssue(row));
      }
      mapRef.current = map;
      commit();
    })();

    const channel = supabase
      .channel('tickets-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        (payload) => {
          const map = mapRef.current;
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string })?.id;
            if (id) map.delete(id);
          } else {
            const row = payload.new as TicketRow;
            map.set(row.id, rowToIssue(row));
          }
          commit();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Recovered — clear any lingering connection error.
          setState((prev) => (prev.error ? { ...prev, error: null } : prev));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setState((prev) => ({ ...prev, error: 'Se perdió la conexión en tiempo real — reintentando…' }));
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [commit]);

  return state;
}
