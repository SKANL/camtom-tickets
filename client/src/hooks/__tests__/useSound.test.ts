import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSound } from '../useSound';

const soundModule = vi.hoisted(() => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release, setEnabled: vi.fn(), play: vi.fn() };
});

vi.mock('cuelume', async () => {
  await soundModule.gate;
  return { setEnabled: soundModule.setEnabled, play: soundModule.play };
});

describe('useSound mute overrides', () => {
  beforeEach(() => {
    localStorage.clear();
    soundModule.setEnabled.mockClear();
  });

  it('applies the latest mute state when the lazy sound module resolves', async () => {
    const { result } = renderHook(() => useSound());
    act(() => result.current.setMutedOverride(true));
    act(() => soundModule.release());
    await waitFor(() => expect(soundModule.setEnabled).toHaveBeenCalledWith(false));
    expect(soundModule.setEnabled.mock.calls.at(-1)?.[0]).toBe(false);
  });

  it('restores the persisted manual preference when automatic mute is disabled', () => {
    const { result } = renderHook(() => useSound());
    act(() => result.current.setMuted(false));
    act(() => result.current.setMutedOverride(true));
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isMuteForced).toBe(true);

    act(() => result.current.setMutedOverride(null));
    expect(result.current.isMuted).toBe(false);
    expect(result.current.isMuteForced).toBe(false);
    expect(localStorage.getItem('camtom-sound-muted')).toBe('false');
  });

  it('supports an explicit unmuted override without rewriting manual storage', () => {
    localStorage.setItem('camtom-sound-muted', 'true');
    const { result } = renderHook(() => useSound());
    act(() => result.current.setMutedOverride(false));
    expect(result.current.isMuted).toBe(false);
    expect(localStorage.getItem('camtom-sound-muted')).toBe('true');
  });
});
