/**
 * Resolve the non-persistent mute override applied on top of the user's stored
 * manual preference. Explicit screen state (remote or local) wins over team
 * automation; disabling automation releases the override and restores the
 * manual preference.
 */
export function resolveMuteOverride(
  screenMuted: boolean | undefined,
  autoMute: boolean,
): boolean | null {
  if (typeof screenMuted === 'boolean') return screenMuted;
  return autoMute ? true : null;
}
