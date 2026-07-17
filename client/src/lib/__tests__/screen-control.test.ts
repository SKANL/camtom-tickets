import { describe, expect, it, vi } from 'vitest';
import {
  deriveScreenDeviceHealth,
  shouldApplyScreenVersion,
  validateAllowedScreenState,
} from '@camtom/shared';
import { createRequestId, requestScreenCaptchaToken } from '../screen-control';
import { shouldAcceptDeviceUpdate } from '../../hooks/useRemoteScreen';

const state = {
  schemaVersion: 1 as const,
  layout: 'single' as const,
  muted: true,
  reloadNonce: 'soft-1',
  panes: {
    left: { teamId: 'a', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'a', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

describe('screen control client contracts', () => {
  it('ignores out-of-order realtime rows and accepts a newer desired version', () => {
    expect(shouldApplyScreenVersion(4, 3)).toBe(false);
    expect(shouldAcceptDeviceUpdate(4, { desired_state: state, state_version: 3 } as any)).toBe(false);
    expect(shouldAcceptDeviceUpdate(4, { desired_state: state, state_version: 5 } as any)).toBe(true);
    expect(shouldAcceptDeviceUpdate(4, { desired_state: null, state_version: 5 } as any)).toBe(false);
  });

  it('validates every pane against the allowed-team scope', () => {
    expect(validateAllowedScreenState(state, ['a'])).toBe(true);
    expect(validateAllowedScreenState({ ...state, panes: { ...state.panes, right: { ...state.panes.right, teamId: 'b' } } }, ['a'])).toBe(false);
  });

  it('derives durable status from heartbeat age and applied version', () => {
    const now = Date.parse('2026-07-16T12:00:00Z');
    expect(deriveScreenDeviceHealth({ lastSeenAt: '2026-07-16T11:59:50Z', stateVersion: 2, lastAppliedVersion: 2, now })).toBe('online');
    expect(deriveScreenDeviceHealth({ lastSeenAt: '2026-07-16T11:59:50Z', stateVersion: 3, lastAppliedVersion: 2, now })).toBe('unstable');
    expect(deriveScreenDeviceHealth({ lastSeenAt: '2026-07-16T11:58:00Z', stateVersion: 2, lastAppliedVersion: 2, now })).toBe('offline');
    expect(deriveScreenDeviceHealth({ lastSeenAt: null, stateVersion: 0, lastAppliedVersion: 0, now })).toBe('stale');
  });

  it('creates UUID request identifiers even without browser-specific APIs', () => {
    expect(createRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns a single-use Turnstile token and removes its temporary widget', async () => {
    const remove = vi.fn();
    const render = vi.fn((_container: HTMLElement, options: any) => {
      queueMicrotask(() => options.callback('captcha-token'));
      return 'widget-1';
    });
    window.turnstile = { render, remove };
    await expect(requestScreenCaptchaToken({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: 'turnstile', captchaSiteKey: 'site-key', configurationError: null,
    })).resolves.toBe('captcha-token');
    expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: 'site-key' }));
    expect(remove).toHaveBeenCalledWith('widget-1');
    delete window.turnstile;
  });

  it('allows CAPTCHA omission only when the server explicitly has no gate', async () => {
    await expect(requestScreenCaptchaToken({
      screenControlEnabled: true, requirePairing: false,
      captchaProvider: null, captchaSiteKey: null, configurationError: null,
    })).resolves.toBeUndefined();
    await expect(requestScreenCaptchaToken({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: null, captchaSiteKey: null, configurationError: 'CAPTCHA requerido',
    })).rejects.toThrow('CAPTCHA requerido');
  });
});
