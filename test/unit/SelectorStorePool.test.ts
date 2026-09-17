import { DataFactory, Store } from 'n3';
import { SelectorStorePool } from '../../src/SelectorStorePool';

const { quad, namedNode, literal } = DataFactory;

describe('SelectorStorePool', (): void => {
  const modified = new Date('2024-01-01T00:00:00.000Z');
  let pool: SelectorStorePool;

  beforeEach((): void => {
    pool = new SelectorStorePool({ max: 10, maxSize: 1000 });
  });

  it('normalizes selector keys deterministically.', (): void => {
    const key1 = pool.getSelectorKey([ 'http://example.com/b', 'http://example.com/a' ]);
    const key2 = pool.getSelectorKey([ 'http://example.com/a', 'http://example.com/b' ]);
    expect(key1).toBe(key2);
    expect(key1).toBe('http://example.com/a|http://example.com/b');
  });

  it('stores and retrieves stores.', (): void => {
    const selectors = [ 'http://example.com/data/*' ];
    const store = new Store([
      quad(namedNode('http://example.com/s'), namedNode('http://example.com/p'), literal('o')),
    ]);

    expect(pool.hasStore(selectors)).toBe(false);
    expect(pool.getStore(selectors)).toBeUndefined();

    pool.setStore(selectors, { store, modified });
    expect(pool.hasStore(selectors)).toBe(true);
    expect(pool.getStore(selectors)?.store).toBe(store);
    expect(pool.getStore(selectors)?.modified).toBe(modified);
  });

  it('invalidates a specific selector key.', (): void => {
    const selectors = [ 'http://example.com/data/*' ];
    const store = new Store();
    pool.setStore(selectors, { store, modified });
    expect(pool.hasStore(selectors)).toBe(true);

    expect(pool.invalidate(selectors)).toBe(true);
    expect(pool.hasStore(selectors)).toBe(false);
  });

  it('invalidates matching paths.', (): void => {
    const selectors = [ 'http://example.com/data/**' ];
    const store = new Store();
    pool.setStore(selectors, { store, modified });

    expect(pool.hasStore(selectors)).toBe(true);

    // Modifying an unrelated path should not invalidate
    pool.invalidateMatchingPath('http://example.com/other/file.ttl');
    expect(pool.hasStore(selectors)).toBe(true);

    // Modifying a matching path should invalidate
    pool.invalidateMatchingPath('http://example.com/data/sub/item.ttl');
    expect(pool.hasStore(selectors)).toBe(false);
  });

  it('clears all stores.', (): void => {
    pool.setStore([ 'http://example.com/1' ], { store: new Store(), modified });
    pool.setStore([ 'http://example.com/2' ], { store: new Store(), modified });
    expect(pool.hasStore([ 'http://example.com/1' ])).toBe(true);

    pool.clear();
    expect(pool.hasStore([ 'http://example.com/1' ])).toBe(false);
    expect(pool.hasStore([ 'http://example.com/2' ])).toBe(false);
  });
});
