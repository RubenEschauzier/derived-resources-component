import { Readable } from 'node:stream';
import type { Representation, ResourceIdentifier } from '@solid/community-server';
import { BasicRepresentation, INTERNAL_QUADS, updateModifiedDate } from '@solid/community-server';
import type { Quad } from '@rdfjs/types';
import type { Store } from 'n3';

/**
 * A {@link Representation} that encapsulates an in-memory {@link Store} (N3.Store).
 * Provides direct access to the store for in-memory executors while fulfilling the
 * standard Representation contract with a readable data stream.
 *
 * The store can be built lazily, only once an executor asks for it, for data that executors can
 * also answer from an HDT file holding the same data.
 */
export interface StoreRepresentation extends Representation {
  /**
   * The underlying in-memory N3.Store dataset, built on the first call if it was not yet.
   * This store can be shared between representations, so it should never be modified.
   */
  getStore: () => Promise<Store>;
  /**
   * Path of an HDT file holding the same data as the store, which executors can query instead.
   */
  hdtPath?: string;
}

/**
 * Type guard to check if a Representation is a {@link StoreRepresentation}.
 */
export function isStoreRepresentation(representation: Representation): representation is StoreRepresentation {
  return typeof (representation as unknown as { getStore?: unknown }).getStore === 'function';
}

/**
 * Helper to wrap an {@link Store} into a {@link StoreRepresentation}.
 *
 * The modified date is required as caching layers further down the chain
 * use it to determine if their cached entries are still valid.
 *
 * @param store - The populated N3.Store, or a function building it, to only build it once needed.
 * @param identifier - Target resource identifier for the representation.
 * @param modified - The most recent modified date of all the resources that were merged into the store.
 * @param hdtPath - Path of an HDT file holding the same data, if there is one.
 *
 * @returns A new StoreRepresentation whose .data stream reads quads directly from memory.
 */
export function createStoreRepresentation(
  store: Store | (() => Promise<Store>),
  identifier: ResourceIdentifier,
  modified: Date,
  hdtPath?: string,
): StoreRepresentation {
  const getStore = typeof store === 'function' ? store : async(): Promise<Store> => store;
  // The stream only gets the store once it is read, so a representation that is never read in full
  // never needs its store built
  const stream = Readable.from((async function* (): AsyncGenerator<Quad> {
    yield* (await getStore()).readQuads(null, null, null, null);
  })());
  const representation = <StoreRepresentation> new BasicRepresentation(stream, identifier, INTERNAL_QUADS);
  updateModifiedDate(representation.metadata, modified);
  representation.getStore = getStore;
  if (hdtPath) {
    representation.hdtPath = hdtPath;
  }
  return representation;
}
