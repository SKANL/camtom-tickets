import { describe, expect, it } from 'vitest';
import { loadControlSelection, saveControlSelection } from '../control-selection';

describe('controller device selection persistence', () => {
  it('treats unavailable, cleared, or throwing storage as optional', () => {
    expect(loadControlSelection(undefined)).toEqual([]);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadControlSelection(throwing)).toEqual([]);
    expect(() => saveControlSelection(['device'], throwing)).not.toThrow();
  });

  it('persists only unique device IDs', () => {
    let value: string | null = null;
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    saveControlSelection(['tv-1', 'tv-1', 'tv-2'], storage);
    expect(loadControlSelection(storage)).toEqual(['tv-1', 'tv-2']);
    expect(value).not.toContain('secret');
  });
});
