import { Readable } from 'node:stream';
import type { Representation, ResourceIdentifier } from '@solid/community-server';
import { BasicRepresentation, INTERNAL_QUADS, updateModifiedDate } from '@solid/community-server';
import type { Store } from 'n3';

/**
 * A {@link Representation} that encapsulates an in-memory {@link Store} (N3.Store).
 * Provides direct access to the store for in-memory executors while fulfilling the
 * standard Representation contract with a readable data stream.
 */
export interface StoreRepresentation extends Representation {
  /**
   * The underlying in-memory N3.Store dataset.
   * This store can be shared between representations, so it should never be modified.
   */
  store: Store;
}

/**
 * Type guard to check if a Representation is a {@link StoreRepresentation}.
 */
export function isStoreRepresentation(representation: Representation): representation is StoreRepresentation {
  return typeof (representation as unknown as { store?: unknown }).store === 'object' &&
    (representation as unknown as { store?: unknown }).store !== null;
}

/**
 * Helper to wrap an {@link Store} into a {@link StoreRepresentation}.
 *
 * The modified date is required as caching layers further down the chain
 * use it to determine if their cached entries are still valid.
 *
 * @param store - The populated N3.Store.
 * @param identifier - Target resource identifier for the representation.
 * @param modified - The most recent modified date of all the resources that were merged into the store.
 * @returns A new StoreRepresentation whose .data stream reads quads directly from memory.
 */
export function createStoreRepresentation(
  store: Store,
  identifier: ResourceIdentifier,
  modified: Date,
): StoreRepresentation {
  const stream = Readable.from(store.readQuads(null, null, null, null));
  const representation = <StoreRepresentation> new BasicRepresentation(stream, identifier, INTERNAL_QUADS);
  updateModifiedDate(representation.metadata, modified);
  representation.store = store;
  return representation;
}
