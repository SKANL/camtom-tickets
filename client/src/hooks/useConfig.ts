import { useState, useEffect, useCallback, useRef } from 'react';
import { ConfigResponse, validateConfigV2 } from '@camtom/shared';

const CACHE_KEY = 'camtom-config-cache';

interface ConfigCache {
  version: string;
  data: Omit<ConfigResponse, 'version'>;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useConfig(enabled = true) {
  const initialConfigRef = useRef<ConfigResponse | null | undefined>(undefined);
  if (initialConfigRef.current === undefined) initialConfigRef.current = enabled ? configFromCache(loadCache()) : null;

  const [config, setConfig] = useState<ConfigResponse | null>(initialConfigRef.current);
  const [loading, setLoading] = useState(initialConfigRef.current === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adoptConfig = useCallback((data: ConfigResponse) => {
    validateConfigResponse(data);
    saveCache({
      version: data.version,
      data: { slas: data.slas, dashboard: data.dashboard, ...(data.configV2 ? { configV2: data.configV2 } : {}) },
      cachedAt: Date.now(),
    });
    setConfig(data);
    setLoading(false);
    setError(null);
  }, []);

  const fetchConfig = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConfigResponse = await res.json();
      adoptConfig(data);
      setRefreshing(false);
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
  }, [adoptConfig]);

  useEffect(() => {
    if (!enabled) return;
    fetchConfig();

    // Periodic refresh every 5 minutes
    const interval = setInterval(fetchConfig, CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, [enabled, fetchConfig]);

  return { config, loading, refreshing, error, refetch: fetchConfig, adoptConfig };
}

function validateConfigResponse(data: ConfigResponse): void {
  if (!data?.version || !data.dashboard || !Array.isArray(data.slas)) {
    throw new Error('Invalid configuration response');
  }
  if (data.configV2) {
    const errors = validateConfigV2(data.configV2, (data.dashboard.teams ?? []).map((team) => team.id));
    if (errors.length > 0) throw new Error(`Invalid configuration: ${errors.join('; ')}`);
  }
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
