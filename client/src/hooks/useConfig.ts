import { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigResponse } from '@camtom/shared';

const CACHE_KEY = 'camtom-config-cache';

interface ConfigCache {
  version: string;
  data: Omit<ConfigResponse, 'version'>;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useConfig() {
  const initialConfigRef = useRef<ConfigResponse | null | undefined>(undefined);
  if (initialConfigRef.current === undefined) initialConfigRef.current = configFromCache(loadCache());

  const [config, setConfig] = useState<ConfigResponse | null>(initialConfigRef.current);
  const [loading, setLoading] = useState(initialConfigRef.current === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConfigResponse = await res.json();

      saveCache({
        version: data.version,
        data: { slas: data.slas, dashboard: data.dashboard },
        cachedAt: Date.now(),
      });

      setConfig(data);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return data;
    } catch (err: any) {
      const fallback = configFromCache(loadCache());
      if (fallback) {
        setConfig((current) => current ?? fallback);
        setError(null); // Silent fallback — cached data is better than nothing
      } else {
        setError(err.message);
      }
      setLoading(false);
      setRefreshing(false);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchConfig();

    // Periodic refresh every 5 minutes
    const interval = setInterval(fetchConfig, CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  return { config, loading, refreshing, error, refetch: fetchConfig };
}

function loadCache(): ConfigCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: ConfigCache = JSON.parse(raw);
    if (!cache?.version || !cache?.data?.dashboard || !Array.isArray(cache?.data?.slas)) return null;
    return cache; // stale config is still safe for first paint while the request refreshes it
  } catch {
    return null;
  }
}

function configFromCache(cache: ConfigCache | null): ConfigResponse | null {
  return cache ? { ...cache.data, version: cache.version } : null;
}

function saveCache(cache: ConfigCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be full or unavailable
  }
}
