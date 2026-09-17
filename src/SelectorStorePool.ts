import { getLoggerFor } from '@solid/community-server';
import { LRUCache } from 'lru-cache';
import type { Store } from 'n3';

export interface SelectorStorePoolSettings {
  /**
   * Maximum number of N3.Store instances to keep in memory.
   * Defaults to 50.
   */
  max?: number;
  /**
   * Maximum size of the cache (e.g. estimated quad count).
   */
  maxSize?: number;
  /**
   * Time-to-live in milliseconds for cached stores.
   */
  ttl?: number;
}

/**
 * A cached {@link Store} together with the metadata needed to validate caches further down the chain.
 */
export interface PooledStore {
  /**
   * The populated N3.Store.
   */
  store: Store;
  /**
   * The most recent modified date of all the resources that were merged into the store.
   * This is cached alongside the store as a pool hit never touches the backend again.
   */
  modified: Date;
}

/**
 * Manages an in-memory pool/cache of {@link Store} (N3.Store) instances keyed by selectors.
 *
 * Provides thread-safe, normalized key-based storage, retrieval, and path-based invalidation
 * for preloaded datasets.
 */
export class SelectorStorePool {
  protected readonly logger = getLoggerFor(this);
  protected readonly cache: LRUCache<string, PooledStore>;

  public constructor(settings?: SelectorStorePoolSettings) {
    const max = settings?.max ?? 50;
    const maxSize = settings?.maxSize;
    const ttl = settings?.ttl;

    this.cache = new LRUCache<string, PooledStore>({
      max,
      maxSize,
      ttl,
      ...maxSize ? { sizeCalculation: ({ store }: PooledStore): number => store.size + 1 } : {},
    });
  }

  /**
   * Generates a deterministic, normalized cache key from a list of selectors.
   *
   * @param selectors - Array of selector URI strings or globs.
   * @returns Normalized cache key string.
   */
  public getSelectorKey(selectors: string[]): string {
    return [ ...selectors ].sort().join('|');
  }

  /**
   * Checks if an N3.Store is already cached for the given selectors.
   *
   * @param selectors - Array of selector strings.
   * @returns `true` if the store is present in the cache.
   */
  public hasStore(selectors: string[]): boolean {
    const key = this.getSelectorKey(selectors);
    return this.cache.has(key);
  }

  /**
   * Retrieves an N3.Store for the given selectors from the cache, if present.
   *
   * @param selectors - Array of selector strings.
   * @returns The cached {@link PooledStore}, or `undefined` on a cache miss.
   */
  public getStore(selectors: string[]): PooledStore | undefined {
    const key = this.getSelectorKey(selectors);
    return this.cache.get(key);
  }

  /**
   * Stores an N3.Store in the pool under the given selectors.
   *
   * @param selectors - Array of selector strings.
   * @param pooled - The populated {@link PooledStore} entry to cache.
   */
  public setStore(selectors: string[], pooled: PooledStore): void {
    const key = this.getSelectorKey(selectors);
    this.logger.debug(`Caching N3.Store for selector key: ${key} (size: ${pooled.store.size} quads)`);
    this.cache.set(key, pooled);
  }

  /**
   * Invalidates and removes the cached store for the specified selectors.
   *
   * @param selectors - Array of selector strings.
   * @returns `true` if an entry was removed.
   */
  public invalidate(selectors: string[]): boolean {
    const key = this.getSelectorKey(selectors);
    this.logger.debug(`Invalidating cached store for selector key: ${key}`);
    return this.cache.delete(key);
  }

  /**
   * Invalidates any cached stores whose selector patterns could match a modified resource path.
   *
   * @param modifiedPath - URL/path of the resource that was created, updated, or deleted.
   */
  public invalidateMatchingPath(modifiedPath: string): void {
    for (const key of this.cache.keys()) {
      // Invalidate if the selector key contains the container or path prefix
      if (this.pathMatchesSelectorKey(modifiedPath, key)) {
        this.logger.debug(`Invalidating store "${key}" due to modification at "${modifiedPath}"`);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Checks if a modified path intersects with the selector key.
   */
  protected pathMatchesSelectorKey(modifiedPath: string, selectorKey: string): boolean {
    const selectors = selectorKey.split('|');
    return selectors.some((sel): boolean => {
      // Basic prefix/wildcard match check
      const basePrefix = sel.replace(/\*\*?$/u, '');
      return modifiedPath.startsWith(basePrefix);
    });
  }

  /**
   * Clears all cached stores from memory.
   */
  public clear(): void {
    this.logger.debug('Clearing all cached N3.Stores from SelectorStorePool');
    this.cache.clear();
  }
}
