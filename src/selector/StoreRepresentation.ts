import { Readable } from 'node:stream';
import type { Representation, ResourceIdentifier } from '@solid/community-server';
import { BasicRepresentation, INTERNAL_QUADS } from '@solid/community-server';
import type { Store } from 'n3';

/**
 * A {@link Representation} that encapsulates an in-memory {@link Store} (N3.Store).
 * Provides direct access to the store for in-memory executors while fulfilling the
 * standard Representation contract with a readable data stream.
 */
export interface StoreRepresentation extends Representation {
  /**
   * The underlying in-memory N3.Store dataset.
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
 * @param store - The populated N3.Store.
 * @param identifier - Target resource identifier for the representation.
 * @returns A new StoreRepresentation whose .data stream reads quads directly from memory.
 */
export function createStoreRepresentation(store: Store, identifier: ResourceIdentifier): StoreRepresentation {
  const stream = Readable.from(store.getQuads(null, null, null, null));
  const representation = <StoreRepresentation> new BasicRepresentation(stream, identifier, INTERNAL_QUADS);
  representation.store = store;
  return representation;
}
