import { useState, useEffect, useRef } from 'react';
import { MetadataCatalog } from '@camtom/shared';

const METADATA_STORAGE_KEY = 'camtom-metadata-cache';

interface MetadataCache {
  catalog: MetadataCatalog;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MetadataState {
  catalog: MetadataCatalog | null;
  loading: boolean;
  error: string | null;
}

const emptyCatalog: MetadataCatalog = {
  teams: [],
  projects: [],
  users: [],
  workflowStates: [],
  labels: [],
  cycles: [],
};

export function useMetadata(): MetadataState & { refetch: () => void } {
  const [state, setState] = useState<MetadataState>({
    catalog: null,
    loading: true,
    error: null,
  });
  const fetchRef = useRef<number>(0);

  const fetchMetadata = async (fetchId: number) => {
    try {
      // Check localStorage cache first
      const cached = loadCache();
      if (cached) {
        setState({ catalog: cached.catalog, loading: false, error: null });
        // If still fresh, skip network fetch
        if (Date.now() - cached.cachedAt < CACHE_TTL_MS) {
          return;
        }
      }

      const res = await fetch('/api/metadata');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (fetchRef.current !== fetchId) return; // stale

      const catalog: MetadataCatalog = {
        teams: data.teams ?? [],
        projects: data.projects ?? [],
        users: data.users ?? [],
        workflowStates: data.workflowStates ?? [],
        labels: data.labels ?? [],
        cycles: data.cycles ?? [],
      };

      saveCache({ catalog, cachedAt: Date.now() });

      setState({ catalog, loading: false, error: null });
    } catch (err: any) {
      if (fetchRef.current !== fetchId) return;
      // If we have stale cache, keep using it
      if (!state.catalog) {
        setState((prev) => ({ ...prev, loading: false, error: err.message }));
      }
    }
  };

  useEffect(() => {
    const id = ++fetchRef.current;
    fetchMetadata(id);

    // Periodic refresh
    const interval = setInterval(() => {
      const id2 = ++fetchRef.current;
      fetchMetadata(id2);
    }, CACHE_TTL_MS);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = () => {
    const id = ++fetchRef.current;
    fetchMetadata(id);
  };

  return { ...state, refetch };
}

function loadCache(): MetadataCache | null {
  try {
    const raw = localStorage.getItem(METADATA_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(cache: MetadataCache): void {
  try {
    localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be full
  }
}
