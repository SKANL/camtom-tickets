import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConfigResponse } from '@camtom/shared';
import { useConfig } from '../useConfig';

const mockConfig: ConfigResponse = {
  slas: [{
    id: 'sla1',
    label: 'Test SLA',
    applicablePriorities: [1],
    maxMinutes: 5,
    warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
  }],
  dashboard: {
    pollingInterval: 30000,
    title: 'Test Dashboard',
    teamMembers: [],
    displayOrder: [1, 2, 3, 4, 0],
    priorityLabels: {},
    stateLabels: {},
    report: { slaWindowHours: 24, enabled: true },
    kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' },
  },
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

    // Cache hydration is synchronous, so team filters can be resolved before tickets paint.
    expect(result.current.config).toEqual(mockConfig);
    expect(result.current.loading).toBe(false);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should have hit cache, but still fetched for version check
    expect(result.current.config).toEqual(mockConfig);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('hydrates stale cached config while refreshing in the background', async () => {
    localStorage.setItem('camtom-config-cache', JSON.stringify({
      version: mockConfig.version,
      data: { slas: mockConfig.slas, dashboard: mockConfig.dashboard },
      cachedAt: Date.now() - 60 * 60 * 1000,
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => mockConfig } as Response);

    const { result } = renderHook(() => useConfig());

    expect(result.current.config).toEqual(mockConfig);
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.config).toEqual(mockConfig);
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

  it('adopts a successful save without shadowing a subsequent authoritative refresh', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => mockConfig,
    } as Response);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.config?.version).toBe(mockConfig.version));

    const saved = {
      ...mockConfig,
      version: 'saved-version',
      dashboard: { ...mockConfig.dashboard, title: 'Saved' },
    };
    act(() => result.current.adoptConfig(saved));
    expect(result.current.config?.dashboard.title).toBe('Saved');
    expect(JSON.parse(localStorage.getItem('camtom-config-cache')!).version).toBe('saved-version');

    const remote = {
      ...saved,
      version: 'remote-version',
      dashboard: { ...saved.dashboard, title: 'Remote refresh' },
    };
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => remote } as Response);
    await act(async () => { await result.current.refetch(); });
    expect(result.current.config?.version).toBe('remote-version');
    expect(result.current.config?.dashboard.title).toBe('Remote refresh');
  });
});
