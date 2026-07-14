import { useState, useEffect, useRef, useCallback } from 'react';
import { Issue } from '@camtom/shared';

interface IssuesState {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const POLL_INTERVAL_MS = 30_000;
const SSE_RECONNECT_BASE = 1000;
const SSE_RECONNECT_MAX = 30_000;

export function useIssues() {
  const [state, setState] = useState<IssuesState>({
    issues: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const issuesMapRef = useRef<Map<string, Issue>>(new Map());

  const applyDelta = useCallback((data: { added?: Issue[]; updated?: Issue[]; removed?: string[]; assignmentTimestamps?: Record<string, string> }) => {
    const map = issuesMapRef.current;

    if (data.removed) {
      for (const id of data.removed) {
        map.delete(id);
      }
    }

    if (data.updated) {
      for (const issue of data.updated) {
        // Merge assignmentTimestamp into the issue if present
        if (data.assignmentTimestamps?.[issue.id]) {
          issue.assignedAt = data.assignmentTimestamps[issue.id];
        }
        map.set(issue.id, issue);
      }
    }

    if (data.added) {
      for (const issue of data.added) {
        // Merge assignmentTimestamp for added issues
        if (data.assignmentTimestamps?.[issue.id]) {
          issue.assignedAt = data.assignmentTimestamps[issue.id];
        }
        map.set(issue.id, issue);
      }
    }

    const sortedIssues = Array.from(map.values()).sort(
      (a, b) => a.priority - b.priority,
    );

    setState({
      issues: sortedIssues,
      loading: false,
      error: null,
      lastUpdated: Date.now(),
    });
  }, []);

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch('/api/issues');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const map = new Map<string, Issue>();
      for (const issue of data.issues) {
        map.set(issue.id, issue);
      }
      issuesMapRef.current = map;

      const sorted = Array.from(map.values()).sort(
        (a, b) => a.priority - b.priority,
      );

      setState({
        issues: sorted,
        loading: false,
        error: null,
        lastUpdated: Date.now(),
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message,
      }));
    }
  }, []);

  const connectSSE = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const es = new EventSource('/api/events');
      eventSourceRef.current = es;

      es.addEventListener('connected', () => {
        console.log('[useIssues] SSE connected');
        reconnectAttemptRef.current = 0;
      });

      es.addEventListener('delta', (event) => {
        try {
          const data = JSON.parse(event.data);
          applyDelta(data);

          // Stop polling since SSE is working
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        } catch (err) {
          console.error('[useIssues] Failed to parse delta event:', err);
        }
      });

      es.addEventListener('heartbeat', () => {
        // Heartbeat keeps connection alive; no action needed
      });

      es.onerror = () => {
        console.warn('[useIssues] SSE error, falling back to polling');
        es.close();
        eventSourceRef.current = null;

        // Fall back to polling
        startPolling();

        // Attempt reconnection with exponential backoff
        scheduleReconnect();
      };

      // Initial fetch to get all issues (SSE will send deltas after)
      fetchIssues();
    } catch (err: any) {
      console.error('[useIssues] Failed to create EventSource:', err.message);
      startPolling();
    }
  }, [applyDelta, fetchIssues]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    fetchIssues();
    pollTimerRef.current = setInterval(fetchIssues, POLL_INTERVAL_MS);
  }, [fetchIssues]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    const delay = Math.min(
      SSE_RECONNECT_BASE * Math.pow(2, reconnectAttemptRef.current),
      SSE_RECONNECT_MAX,
    );
    reconnectAttemptRef.current += 1;

    console.log(`[useIssues] Reconnecting SSE in ${delay}ms (attempt ${reconnectAttemptRef.current})`);

    reconnectTimerRef.current = setTimeout(() => {
      // Stop polling before reconnecting via SSE
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      connectSSE();
    }, delay);
  }, [connectSSE]);

  useEffect(() => {
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connectSSE]);

  return state;
}
