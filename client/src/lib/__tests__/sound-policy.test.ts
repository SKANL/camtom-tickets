import { describe, expect, it } from 'vitest';
import { resolveMuteOverride } from '../sound-policy';

describe('sound policy', () => {
  it('gives explicit local or remote screen state precedence over automatic mute', () => {
    expect(resolveMuteOverride(false, true)).toBe(false);
    expect(resolveMuteOverride(true, false)).toBe(true);
  });

  it('forces mute only while team automation is enabled', () => {
    expect(resolveMuteOverride(undefined, true)).toBe(true);
    expect(resolveMuteOverride(undefined, false)).toBeNull();
  });
});
