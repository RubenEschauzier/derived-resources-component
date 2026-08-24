import { once } from 'node:events';
import type { Representation, ResourceStore } from '@solid/community-server';
import { getLoggerFor } from '@solid/community-server';
import { Store } from 'n3';
import type { DerivationConfig } from '../DerivationConfig';
import type { SelectorStorePool } from '../SelectorStorePool';
import { BaseSelectorHandler } from './BaseSelectorHandler';
import type { SelectorParser } from './SelectorParser';
import { createStoreRepresentation } from './StoreRepresentation';

/**
 * A {@link SelectorHandler} that uses a {@link SelectorStorePool} to cache in-memory
 * {@link Store} instances for requested selectors.
 *
 * Extends {@link BaseSelectorHandler} as a fallback: on a cache miss, it fetches the
 * input representations from the underlying store, imports them into a new N3.Store,
 * caches the populated store in the pool, and returns a {@link StoreRepresentation}.
 */
export class SelectorHandlerCachedStore extends BaseSelectorHandler {
  protected readonly logger = getLoggerFor(this);
  protected readonly pool: SelectorStorePool;

  public constructor(parser: SelectorParser, store: ResourceStore, pool: SelectorStorePool) {
    super(parser, store);
    this.pool = pool;
  }

  public override async handle(config: DerivationConfig): Promise<Representation[]> {
    // Check if the N3.Store is already cached in the pool
    let store = this.pool.getStore(config.selectors);

    if (store) {
      this.logger.debug(
        `SelectorStorePool hit for selectors: [${config.selectors.join(', ')}] (size: ${store.size} quads)`,
      );
      return [ createStoreRepresentation(store, config.identifier) ];
    }

    this.logger.debug(
      `SelectorStorePool miss for selectors: [${config.selectors.join(', ')}]. Populating in-memory store...`,
    );

    const fileRepresentations = await super.handle(config);

    // Import all representation data streams into store
    store = new Store();
    const importPromises: Promise<unknown>[] = [];

    for (const representation of fileRepresentations) {
      const emitter = store.import(representation.data);
      importPromises.push(once(emitter, 'end'));
    }

    await Promise.all(importPromises);

    this.logger.debug(
      `Successfully loaded ${store.size} quads into in-memory store for selectors: [${config.selectors.join(', ')}]`,
    );

    this.pool.setStore(config.selectors, store);
    return [ createStoreRepresentation(store, config.identifier) ];
  }
}
