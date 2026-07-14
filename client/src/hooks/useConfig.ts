import { useState, useEffect, useCallback } from 'react';
import { ConfigResponse } from '@camtom/shared';

const CACHE_KEY = 'camtom-config-cache';

interface ConfigCache {
  version: string;
  data: Omit<ConfigResponse, 'version'>;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useConfig() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConfigResponse = await res.json();

      // Check localStorage cache
      const cached = loadCache();
      if (cached && cached.version === data.version) {
        // Cache hit — use cached data (already in state from previous load)
        setConfig(data);
        setLoading(false);
        return data;
      }

      // Cache miss or new version — save to cache
      saveCache({
        version: data.version,
        data: { slas: data.slas, dashboard: data.dashboard },
        cachedAt: Date.now(),
      });

      setConfig(data);
      setLoading(false);
      return data;
    } catch (err: any) {
      // Try loading from cache as fallback
      const cached = loadCache();
      if (cached) {
        setConfig({ ...cached.data, version: cached.version });
        setError(null); // Silent fallback — cached data is better than nothing
      } else {
        setError(err.message);
      }
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchConfig();

    // Periodic refresh every 5 minutes
    const interval = setInterval(fetchConfig, CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  return { config, loading, error, refetch: fetchConfig };
}

function loadCache(): ConfigCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache: ConfigCache = JSON.parse(raw);
    // Check TTL
    if (Date.now() - cache.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function saveCache(cache: ConfigCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be full or unavailable
  }
}
