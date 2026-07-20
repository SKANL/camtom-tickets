import { describe, expect, it } from 'vitest';
import { constantTimeSecretHash, compareSecretHash, signSession, verifySession } from '../signed-session';

describe('signed sessions', () => {
  const secret = 'a-secret-long-enough-for-production-tests';

  it('authenticates purpose-bound, expiring tokens and rejects tampering', () => {
    const now = Date.now();
    const token = signSession({ kind: 'display', issuedAt: now, expiresAt: now + 60_000, deviceId: 'device' }, secret);
    expect(verifySession(token, secret, 'display', now)?.deviceId).toBe('device');
    expect(verifySession(token, secret, 'admin', now)).toBeNull();
    expect(verifySession(`${token}x`, secret, 'display', now)).toBeNull();
    expect(verifySession(token, secret, 'display', now + 60_001)).toBeNull();
    expect(verifySession(token, `${secret}-rotated`, 'display', now)).toBeNull();
  });

  it('stores only a purpose-bound hash of installation secrets', () => {
    const raw = 'raw-installation-secret';
    const hash = constantTimeSecretHash(raw, secret, 'display-installation-v2');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw);
    expect(compareSecretHash(raw, hash, secret, 'display-installation-v2')).toBe(true);
    expect(compareSecretHash(`${raw}x`, hash, secret, 'display-installation-v2')).toBe(false);
    expect(compareSecretHash(raw, hash, secret, 'another-purpose')).toBe(false);
  });
});
