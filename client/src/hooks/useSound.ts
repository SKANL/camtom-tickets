import { useState, useEffect, useCallback, useRef } from 'react';

const MUTE_STORAGE_KEY = 'camtom-sound-muted';

interface SoundHook {
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  playNewUrgent: () => void;
  playWarning: () => void;
  playBreach: () => void;
  playSuccess: () => void;
  playChime: () => void;
}

export function useSound(): SoundHook {
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const cuelumeRef = useRef<any>(null);

  // Lazy-load cuelume
  useEffect(() => {
    let cancelled = false;
    import('cuelume').then((mod) => {
      if (!cancelled) {
        cuelumeRef.current = mod;
        mod.setEnabled(!isMuted);
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
    setIsMuted(muted);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
    } catch {
      // localStorage may be full or unavailable
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(!isMuted);
  }, [isMuted, setMuted]);

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
    setMuted,
    toggleMute,
    playNewUrgent,
    playWarning,
    playBreach,
    playSuccess,
    playChime,
  };
}
