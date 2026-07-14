import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Cache, TTL_MS } from '../cache';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new Cache<string>(60_000); // 60s TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('expires entries after TTL', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // Advance time past TTL
    vi.advanceTimersByTime(60_001);
    expect(cache.get('key1')).toBeNull();
  });

  it('does not expire entries before TTL', () => {
    cache.set('key1', 'value1');
    vi.advanceTimersByTime(59_000);
    expect(cache.get('key1')).toBe('value1');
  });

  it('deletes entries', () => {
    cache.set('key1', 'value1');
    cache.delete('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('clears all entries', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });

  it('reports correct size', () => {
    expect(cache.size).toBe(0);
    cache.set('key1', 'value1');
    expect(cache.size).toBe(1);
    cache.set('key2', 'value2');
    expect(cache.size).toBe(2);
  });

  it('lists keys', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    const keys = cache.keys();
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
    expect(keys.length).toBe(2);
  });

  it('reports age of entries', () => {
    cache.set('key1', 'value1');
    expect(cache.age('key1')).toBe(0);

    vi.advanceTimersByTime(30_000);
    expect(cache.age('key1')).toBe(30_000);
  });

  it('returns -1 age for missing keys', () => {
    expect(cache.age('nonexistent')).toBe(-1);
  });

  it('overwrites existing keys', () => {
    cache.set('key1', 'value1');
    cache.set('key1', 'value2');
    expect(cache.get('key1')).toBe('value2');
  });

  it('has() returns correct boolean', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('has() respects TTL', () => {
    cache.set('key1', 'value1');
    vi.advanceTimersByTime(60_001);
    expect(cache.has('key1')).toBe(false);
  });
});
