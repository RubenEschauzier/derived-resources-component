import { DataFactory, Store } from 'n3';
import { INTERNAL_QUADS, BasicRepresentation } from '@solid/community-server';
import type { ResourceIdentifier, ResourceStore } from '@solid/community-server';
import { Readable } from 'node:stream';
import type { DerivationConfig } from '../../../src/DerivationConfig';
import { SelectorStorePool } from '../../../src/SelectorStorePool';
import { SelectorHandlerCachedStore } from '../../../src/selector/SelectorHandlerCachedStore';
import { isStoreRepresentation } from '../../../src/selector/StoreRepresentation';
import type { SelectorParser } from '../../../src/selector/SelectorParser';

const { quad, namedNode, literal } = DataFactory;

describe('SelectorHandlerCachedStore', (): void => {
  const identifiers: ResourceIdentifier[] = [
    { path: 'http://example.com/foo' },
    { path: 'http://example.com/bar' },
  ];
  const config: DerivationConfig = {
    identifier: { path: 'http://example.com/derived' },
    selectors: [ 'http://example.com/data/*' ],
    filter: 'http://example.com/filter',
    mappings: {},
    metadata: {} as any,
  };

  let store: jest.Mocked<ResourceStore>;
  let parser: jest.Mocked<SelectorParser>;
  let pool: SelectorStorePool;
  let handler: SelectorHandlerCachedStore;

  beforeEach(async(): Promise<void> => {
    store = {
      getRepresentation: jest.fn(async(identifier: ResourceIdentifier): Promise<any> => {
        const q = quad(namedNode(identifier.path), namedNode('http://xmlns.com/foaf/0.1/name'), literal('Alice'));
        return new BasicRepresentation(Readable.from([ q ]), identifier, INTERNAL_QUADS);
      }),
    } satisfies Partial<ResourceStore> as any;

    parser = {
      canHandle: jest.fn(),
      handle: jest.fn().mockResolvedValue(identifiers),
      handleSafe: jest.fn().mockResolvedValue(identifiers),
    };

    pool = new SelectorStorePool();
    handler = new SelectorHandlerCachedStore(parser, store, pool);
  });

  it('populates and caches the store in the pool on a cache miss.', async(): Promise<void> => {
    expect(pool.hasStore(config.selectors)).toBe(false);

    const [ rep ] = await handler.handle(config);
    expect(isStoreRepresentation(rep)).toBe(true);

    if (isStoreRepresentation(rep)) {
      expect(rep.store.size).toBe(2);
      expect(rep.store.countQuads(namedNode('http://example.com/foo'), null, null, null)).toBe(1);
      expect(rep.store.countQuads(namedNode('http://example.com/bar'), null, null, null)).toBe(1);
    }

    expect(pool.hasStore(config.selectors)).toBe(true);
    expect(store.getRepresentation).toHaveBeenCalledTimes(2);
  });

  it('returns the cached store directly on a cache hit without querying underlying store.', async(): Promise<void> => {
    const cachedStore = new Store([
      quad(namedNode('http://example.com/preloaded'), namedNode('http://xmlns.com/foaf/0.1/name'), literal('Bob')),
    ]);
    pool.setStore(config.selectors, cachedStore);

    const [ rep ] = await handler.handle(config);
    expect(isStoreRepresentation(rep)).toBe(true);

    if (isStoreRepresentation(rep)) {
      expect(rep.store).toBe(cachedStore);
      expect(rep.store.size).toBe(1);
    }

    // Underlying store should NOT have been queried at all!
    expect(store.getRepresentation).not.toHaveBeenCalled();
    expect(parser.handle).not.toHaveBeenCalled();
  });
});
