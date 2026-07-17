import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('hosted screen-control probe contract', () => {
  const source = readFileSync(resolve(__dirname, '../scripts/screen-control-hosted-probe.ts'), 'utf8');

  it('uses admin-provisioned magic-link sessions instead of consuming interactive CAPTCHA tokens', () => {
    expect(source).toContain('admin.auth.admin.createUser');
    expect(source).toContain('admin.auth.admin.generateLink');
    expect(source).toContain("verifyOtp({ token_hash: tokenHash, type: 'magiclink' })");
    expect(source).not.toContain('signInWithPassword');
    expect(source).not.toContain('signInAnonymously');
    expect(source).not.toContain('captchaToken');
  });

  it('registers each synthetic user before session acquisition and retains strict cleanup', () => {
    const firstCreated = source.indexOf('const firstCreated = await admin.auth.admin.createUser');
    const firstRegistered = source.indexOf('resources.firstUserId = firstCreated.data.user.id');
    const firstSession = source.indexOf('resources.firstClient = await adminLinkClient');
    const secondCreated = source.indexOf('const secondCreated = await admin.auth.admin.createUser');
    const secondRegistered = source.indexOf('resources.secondUserId = secondCreated.data.user.id');
    const secondSession = source.indexOf('const secondClient = await adminLinkClient');
    expect(firstCreated).toBeGreaterThan(source.indexOf('try {'));
    expect(firstRegistered).toBeGreaterThan(firstCreated);
    expect(firstSession).toBeGreaterThan(firstRegistered);
    expect(secondRegistered).toBeGreaterThan(secondCreated);
    expect(secondSession).toBeGreaterThan(secondRegistered);
    expect(source).toContain('const cleanupFailures = await cleanupScreenProbeResources(resources)');
    expect(source).toContain('if (primaryFailure || cleanupFailures.length > 0)');
    expect(source.indexOf('changeWaiter = await waitForProbeSubscription')).toBeLessThan(
      source.indexOf('await changeWaiter.promise'),
    );
    expect(source).toContain('changeWaiter?.cancel()');
  });
});
