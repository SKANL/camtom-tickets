import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_ADMIN_SESSION_KEY,
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
  });

  it('keeps the token only in sessionStorage and sends the bearer header', async () => {
    storeAdminToken('secret');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'v2', dashboard: {}, slas: [] }),
    } as Response);

    await updateServerConfig({ dashboard: { title: 'Nuevo' } }, readAdminToken());

    expect(sessionStorage.getItem(CONFIG_ADMIN_SESSION_KEY)).toBe('secret');
    expect(localStorage.getItem(CONFIG_ADMIN_SESSION_KEY)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith('/api/config', expect.objectContaining({
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
