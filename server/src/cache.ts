const TTL_MS = 60_000;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private defaultTTL: number;

  constructor(defaultTTL: number = TTL_MS) {
    this.defaultTTL = defaultTTL;
  }

  set(key: string, data: T, ttl?: number): void {
    this.store.set(key, {
      data,
      cachedAt: Date.now(),
    });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.cachedAt;
    if (age >= this.defaultTTL) {
      this.store.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /** Get entry age in ms. Returns -1 if key doesn't exist. */
  age(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return -1;
    return Date.now() - entry.cachedAt;
  }
}

export const issuesCache = new Cache<any[]>(TTL_MS);
export const metadataCache = new Cache<any>(5 * 60 * 1000); // 5 minute TTL
export { Cache, TTL_MS };
