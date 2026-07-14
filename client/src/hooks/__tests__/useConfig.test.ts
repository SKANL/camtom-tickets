import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useConfig } from '../useConfig';

const mockConfig = {
  slas: [{ id: 'sla1', label: 'Test SLA', applicablePriorities: [1], maxMinutes: 5, warningThreshold: 0.2 }],
  dashboard: { pollingInterval: 30000, title: 'Test Dashboard' },
  version: 'abc123def456',
};

describe('useConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('fetches config from API on mount', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockConfig,
    } as Response);

    const { result } = renderHook(() => useConfig());

    expect(fetchSpy).toHaveBeenCalledWith('/api/config');
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.config).toEqual(mockConfig);
    expect(result.current.error).toBeNull();
  });

  it('caches config in localStorage and returns cached version on reload', async () => {
    localStorage.setItem('camtom-config-cache', JSON.stringify({
      version: mockConfig.version,
      data: { slas: mockConfig.slas, dashboard: mockConfig.dashboard },
      cachedAt: Date.now(),
    }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockConfig,
    } as Response);

    const { result } = renderHook(() => useConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should have hit cache, but still fetched for version check
    expect(result.current.config).toEqual(mockConfig);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when cached version differs from server', async () => {
    const oldConfig = { ...mockConfig, version: 'oldversion123' };
    localStorage.setItem('camtom-config-cache', JSON.stringify({
      version: oldConfig.version,
      data: { slas: oldConfig.slas, dashboard: oldConfig.dashboard },
      cachedAt: Date.now(),
    }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockConfig,
    } as Response);

    const { result } = renderHook(() => useConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.config?.version).toBe('abc123def456');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sets error state on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConfig());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.config).toBeNull();
  });

  it('handles non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const { result } = renderHook(() => useConfig());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.config).toBeNull();
  });

  it('returns config from cache when fetch fails but cache exists', async () => {
    localStorage.setItem('camtom-config-cache', JSON.stringify({
      version: mockConfig.version,
      data: { slas: mockConfig.slas, dashboard: mockConfig.dashboard },
      cachedAt: Date.now(),
    }));

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should fall back to cached config (silent — no error surfaced)
    expect(result.current.config).toEqual(mockConfig);
    expect(result.current.error).toBeNull();
  });
});
