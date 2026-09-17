import { DataFactory, Store } from 'n3';
import { INTERNAL_QUADS, BasicRepresentation, DC, updateModifiedDate } from '@solid/community-server';
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
  const timestamps: Record<string, Date> = {
    'http://example.com/foo': new Date('2024-01-01T00:00:00.000Z'),
    // The most recent of the two, so this is the one that should end up on the merged representation
    'http://example.com/bar': new Date('2024-06-01T00:00:00.000Z'),
  };
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
        const representation = new BasicRepresentation(Readable.from([ q ]), identifier, INTERNAL_QUADS);
        updateModifiedDate(representation.metadata, timestamps[identifier.path]);
        return representation;
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

  it('exposes the most recent timestamp of all inputs.', async(): Promise<void> => {
    const [ rep ] = await handler.handle(config);

    // Caches further down the chain need this to detect changes in the input data
    expect(rep.metadata.get(DC.terms.modified)?.value)
      .toBe(timestamps['http://example.com/bar'].toISOString());
    expect(pool.getStore(config.selectors)?.modified).toEqual(timestamps['http://example.com/bar']);
  });

  it('returns the cached store directly on a cache hit without querying underlying store.', async(): Promise<void> => {
    const cachedStore = new Store([
      quad(namedNode('http://example.com/preloaded'), namedNode('http://xmlns.com/foaf/0.1/name'), literal('Bob')),
    ]);
    const modified = new Date('2024-03-01T00:00:00.000Z');
    pool.setStore(config.selectors, { store: cachedStore, modified });

    const [ rep ] = await handler.handle(config);
    expect(isStoreRepresentation(rep)).toBe(true);

    if (isStoreRepresentation(rep)) {
      expect(rep.store).toBe(cachedStore);
      expect(rep.store.size).toBe(1);
    }
    // The pooled timestamp is replayed, as the backend is not contacted to get a fresh one
    expect(rep.metadata.get(DC.terms.modified)?.value).toBe(modified.toISOString());

    // Underlying store should NOT have been queried at all!
    expect(store.getRepresentation).not.toHaveBeenCalled();
    expect(parser.handle).not.toHaveBeenCalled();
  });

  it('builds the store once when several requests miss concurrently.', async(): Promise<void> => {
    // Hold the parser open so all three requests are in flight before any build finishes,
    // which is the window in which they would each have started their own.
    let releaseParser: () => void;
    const parserBlocked = new Promise<void>((resolve): void => {
      releaseParser = resolve;
    });
    parser.handle.mockImplementation(async(): Promise<ResourceIdentifier[]> => {
      await parserBlocked;
      return identifiers;
    });

    const pending = [ handler.handle(config), handler.handle(config), handler.handle(config) ];
    releaseParser!();
    const [ first, second, third ] = await Promise.all(pending);

    expect(parser.handle).toHaveBeenCalledTimes(1);
    // Two identifiers, fetched for the single build rather than once per request
    expect(store.getRepresentation).toHaveBeenCalledTimes(2);

    // Every caller still gets its own representation over the one shared store
    for (const [ rep ] of [ first, second, third ]) {
      expect(isStoreRepresentation(rep)).toBe(true);
    }
    expect((first[0] as any).store).toBe((second[0] as any).store);
    expect((second[0] as any).store).toBe((third[0] as any).store);
    expect((first[0] as any).store.size).toBe(2);
  });

  it('lets a later request rebuild after a failed build.', async(): Promise<void> => {
    parser.handle.mockRejectedValueOnce(new Error('selector lookup failed'));

    await expect(handler.handle(config)).rejects.toThrow('selector lookup failed');
    // The failed build must not be left registered, or the pool would never recover
    expect(pool.hasStore(config.selectors)).toBe(false);

    const [ rep ] = await handler.handle(config);
    expect(isStoreRepresentation(rep)).toBe(true);
    expect(pool.hasStore(config.selectors)).toBe(true);
  });
});
