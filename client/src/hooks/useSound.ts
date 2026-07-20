import { useState, useEffect, useCallback, useRef } from 'react';

const MUTE_STORAGE_KEY = 'camtom-sound-muted';

interface SoundHook {
  isMuted: boolean;
  isMuteForced: boolean;
  setMuted: (muted: boolean) => void;
  setMutedOverride: (muted: boolean | null) => void;
  toggleMute: () => void;
  playNewUrgent: () => void;
  playWarning: () => void;
  playBreach: () => void;
  playSuccess: () => void;
  playChime: () => void;
}

export function useSound(): SoundHook {
  const [manualMuted, setManualMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mutedOverride, setMutedOverride] = useState<boolean | null>(null);
  const isMuted = mutedOverride ?? manualMuted;
  const cuelumeRef = useRef<any>(null);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  // Lazy-load cuelume
  useEffect(() => {
    let cancelled = false;
    import('cuelume').then((mod) => {
      if (!cancelled) {
        cuelumeRef.current = mod;
        mod.setEnabled(!isMutedRef.current);
      }
    }).catch((err) => {
      console.warn('[useSound] Failed to load cuelume:', err.message);
    });
    return () => { cancelled = true; };
  }, []);

  // Sync mute state with cuelume
  useEffect(() => {
    if (cuelumeRef.current) {
      cuelumeRef.current.setEnabled(!isMuted);
    }
  }, [isMuted]);

  const setMuted = useCallback((muted: boolean) => {
    setManualMuted(muted);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
    } catch {
      // localStorage may be full or unavailable
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(!manualMuted);
  }, [manualMuted, setMuted]);

  const play = useCallback((soundName: string) => {
    if (isMuted) return;
    try {
      if (cuelumeRef.current) {
        cuelumeRef.current.play(soundName);
      }
    } catch {
      // Sound play failed silently
    }
  }, [isMuted]);

  const playNewUrgent = useCallback(() => play('sparkle'), [play]);
  const playWarning = useCallback(() => play('tick'), [play]);
  const playBreach = useCallback(() => play('press'), [play]);
  const playSuccess = useCallback(() => play('success'), [play]);
  const playChime = useCallback(() => play('chime'), [play]);

  return {
    isMuted,
    isMuteForced: mutedOverride !== null,
    setMuted,
    setMutedOverride,
    toggleMute,
    playNewUrgent,
    playWarning,
    playBreach,
    playSuccess,
    playChime,
  };
}
