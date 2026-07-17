import { describe, expect, it } from 'vitest';
import type { ConfigResponse } from '@camtom/shared';
import { buildPairingRateParams, derivePairingCode, filterConfigForScreen, getScreenControlFeatures, hashPairingCode, normalizePairingCode } from '../screen-control';

const secret = 'test-secret-with-at-least-thirty-two-characters';

describe('screen control security helpers', () => {
  it('derives replay-safe six-digit codes without persisting plaintext', () => {
    const first = derivePairingCode('user-1', 'request-1', 0, secret);
    expect(first).toMatch(/^\d{6}$/);
    expect(derivePairingCode('user-1', 'request-1', 0, secret)).toBe(first);
    expect(derivePairingCode('user-1', 'request-1', 1, secret)).not.toBe(first);
    expect(hashPairingCode(first, secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode(first, secret)).not.toContain(first);
    expect(normalizePairingCode(' 123-456 ')).toBe('123456');
    expect(normalizePairingCode('not-a-code')).toBe('invalid');
  });

  it('filters configuration to a device allowed-team scope', () => {
    const settings = { filter: 'active-states' as const, timer: true, slas: [], teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, zoneLabels: { new: '', active: '', done: '' }, displayOptions: {} };
    const config = {
      version: 'v1', slas: [],
      dashboard: { pollingInterval: 1, title: 'x', teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, teams: [{ id: 'a', name: 'A', filter: 'active-states', timer: true }, { id: 'b', name: 'B', filter: 'active-states', timer: true }], activeTeamId: 'b' },
      configV2: { schemaVersion: 2, global: { title: 'x', pollingInterval: 1 }, teams: { a: settings, b: settings } },
    } satisfies ConfigResponse;
    const filtered = filterConfigForScreen(config, ['a']);
    expect(filtered.dashboard.teams?.map((team) => team.id)).toEqual(['a']);
    expect(filtered.dashboard.activeTeamId).toBe('a');
    expect(Object.keys(filtered.configV2?.teams ?? {})).toEqual(['a']);
  });

  it('keeps UID rotation constrained by trusted-IP and conservative global buckets', () => {
    const first = buildPairingRateParams('start', { authUserId: 'uid-1', trustedIp: '203.0.113.10' }, secret);
    const rotated = buildPairingRateParams('start', { authUserId: 'uid-2', trustedIp: '203.0.113.10' }, secret);
    const noPlatformIp = buildPairingRateParams('start', { authUserId: 'uid-3' }, secret);
    expect(first.p_uid_hash).not.toBe(rotated.p_uid_hash);
    expect(first.p_ip_hash).toBe(rotated.p_ip_hash);
    expect(first.p_global_hash).toBe(rotated.p_global_hash);
    expect(noPlatformIp.p_ip_hash).toBeNull();
    expect(noPlatformIp.p_global_hash).toBe(first.p_global_hash);
    expect(Object.values(first).join(':')).not.toContain('203.0.113.10');
  });

  it('requires Turnstile for pairing and for all production anonymous screen Auth', () => {
    expect(getScreenControlFeatures({ SCREEN_CONTROL_ENABLED: 'true', SCREEN_REQUIRE_PAIRING: 'true' })).toMatchObject({
      captchaProvider: null, captchaSiteKey: null,
      configurationError: expect.stringContaining('CAPTCHA Turnstile'),
    });
    expect(getScreenControlFeatures({ VERCEL_ENV: 'production', SCREEN_CONTROL_ENABLED: 'true' })).toMatchObject({
      configurationError: expect.stringContaining('CAPTCHA Turnstile'),
    });
    expect(getScreenControlFeatures({
      NODE_ENV: 'production', SCREEN_CONTROL_ENABLED: 'true', SCREEN_REQUIRE_PAIRING: 'true',
      SCREEN_CAPTCHA_PROVIDER: 'turnstile', SCREEN_CAPTCHA_SITE_KEY: 'public-site-key',
    })).toEqual({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: 'turnstile', captchaSiteKey: 'public-site-key', configurationError: null,
    });
  });
});
