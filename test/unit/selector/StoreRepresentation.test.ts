import { DC } from '@solid/community-server';
import { DataFactory, Store } from 'n3';
import { createStoreRepresentation, isStoreRepresentation } from '../../../src/selector/StoreRepresentation';

const { quad, namedNode, literal } = DataFactory;

describe('StoreRepresentation', (): void => {
  const identifier = { path: 'http://example.com/derived' };
  const modified = new Date('2024-06-01T00:00:00.000Z');
  let store: Store;

  beforeEach((): void => {
    store = new Store([
      quad(namedNode('http://ex.org/a'), namedNode('http://ex.org/p'), literal('one')),
      quad(namedNode('http://ex.org/b'), namedNode('http://ex.org/p'), literal('two')),
      quad(namedNode('http://ex.org/c'), namedNode('http://ex.org/q'), namedNode('http://ex.org/d')),
    ]);
  });

  it('exposes the store itself and the modified date.', (): void => {
    const representation = createStoreRepresentation(store, identifier, modified);

    expect(isStoreRepresentation(representation)).toBe(true);
    expect(representation.store).toBe(store);
    expect(representation.metadata.contentType).toBe('internal/quads');
    expect(representation.metadata.get(DC.terms.modified)?.value).toBe(modified.toISOString());
  });

  it('streams every quad in the store.', async(): Promise<void> => {
    const representation = createStoreRepresentation(store, identifier, modified);

    const quads: any[] = [];
    for await (const q of representation.data) {
      quads.push(q);
    }

    expect(quads).toHaveLength(3);
    expect(quads.map((q): string => `${q.subject.value} ${q.predicate.value} ${q.object.value}`).sort())
      .toEqual([
        'http://ex.org/a http://ex.org/p one',
        'http://ex.org/b http://ex.org/p two',
        'http://ex.org/c http://ex.org/q http://ex.org/d',
      ]);
  });

  it('does not read the store until the stream is consumed.', (): void => {
    // Consumers holding a StoreRepresentation use `.store` and never touch `.data`, so building
    // the representation must not copy the store. This is the difference between costing nothing
    // and copying every quad of a pod on every request.
    const getQuads = jest.spyOn(store, 'getQuads');
    // Count how many quads are actually pulled out while the representation is merely built
    let pulled = 0;
    const readQuads = jest.spyOn(store, 'readQuads').mockImplementation(function* (): any {
      for (const q of new Store([ ...store ]).getQuads(null, null, null, null)) {
        pulled++;
        yield q;
      }
    });

    createStoreRepresentation(store, identifier, modified);

    expect(getQuads).not.toHaveBeenCalled();
    expect(readQuads).toHaveBeenCalledTimes(1);
    expect(pulled).toBe(0);
  });

  it('reflects later additions to the store, since the stream is lazy.', async(): Promise<void> => {
    const representation = createStoreRepresentation(store, identifier, modified);
    store.addQuad(quad(namedNode('http://ex.org/e'), namedNode('http://ex.org/p'), literal('three')));

    const quads: any[] = [];
    for await (const q of representation.data) {
      quads.push(q);
    }

    // Documents the consequence of laziness rather than endorsing it: the pool treats a pooled
    // store as immutable, so in practice nothing writes to it after it is shared.
    expect(quads).toHaveLength(4);
  });
});
