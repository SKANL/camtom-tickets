import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigAdminError,
  readAdminToken,
  storeAdminToken,
  updateServerConfig,
} from '../config-admin';

describe('config admin client', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    storeAdminToken('');
  });

  it('keeps the token only in module memory and sends the bearer header', async () => {
    storeAdminToken('secret');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'v2', dashboard: {}, slas: [] }),
    } as Response);

    await updateServerConfig({ dashboard: { title: 'Nuevo' } }, readAdminToken());

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(fetchSpy).toHaveBeenCalledWith('/api/config', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
    }));
  });

  it('clears the session token and reports a clear error after 401', async () => {
    storeAdminToken('expired');
    localStorage.setItem('camtom-settings-overrides', '{"title":"Local"}');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response);

    await expect(updateServerConfig({}, 'expired')).rejects.toEqual(
      expect.objectContaining<Partial<ConfigAdminError>>({ status: 401 }),
    );
    expect(readAdminToken()).toBe('');
    expect(localStorage.getItem('camtom-settings-overrides')).toBe('{"title":"Local"}');
  });
});
