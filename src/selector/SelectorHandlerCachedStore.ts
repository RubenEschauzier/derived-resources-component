import { once } from 'node:events';
import type { Representation, ResourceStore } from '@solid/community-server';
import { DC } from '@solid/community-server';
import { getLoggerFor } from 'global-logger-factory';
import { Store } from 'n3';
import type { DerivationConfig } from '../DerivationConfig';
import type { HdtIndexLocator } from '../hdt/HdtIndexLocator';
import type { PooledStore, SelectorStorePool } from '../SelectorStorePool';
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

  /**
   * Builds currently in progress, by selector key
   */
  protected readonly pending: Record<string, Promise<PooledStore> | undefined> = {};

  protected readonly hdtIndex?: HdtIndexLocator;

  /**
   * @param parser - Determines the inputs the selectors select.
   * @param store - Store to read inputs from.
   * @param pool - Pool of the stores built.
   * @param hdtIndex - Finds an HDT index holding the selected inputs. If one is found, the store is
   * only built once an executor asks for it, as executors can query the index instead.
   */
  public constructor(
    parser: SelectorParser,
    store: ResourceStore,
    pool: SelectorStorePool,
    hdtIndex?: HdtIndexLocator,
  ) {
    super(parser, store);
    this.pool = pool;
    this.hdtIndex = hdtIndex;
  }

  public override async handle(config: DerivationConfig): Promise<Representation[]> {
    const index = await this.hdtIndex?.locate(config.selectors);
    if (index) {
      this.logger.debug(`Found HDT index ${index.path} for selectors: [${config.selectors.join(', ')}]`);
      const getStore = async(): Promise<Store> => (await this.getPooledStore(config)).store;
      return [ createStoreRepresentation(getStore, config.identifier, index.modified, index.path) ];
    }
    const pooled = await this.getPooledStore(config);
    return [ createStoreRepresentation(pooled.store, config.identifier, pooled.modified) ];
  }

  /**
   * The pooled store of the selected inputs, built if it is not in the pool yet.
   */
  protected async getPooledStore(config: DerivationConfig): Promise<PooledStore> {
    // Check if the N3.Store is already cached in the pool
    const cached = this.pool.getStore(config.selectors);

    if (cached) {
      this.logger.debug(
        // Not the size: an N3 store counts its quads to report it, and this runs on every hit
        `SelectorStorePool hit for selectors: [${config.selectors.join(', ')}]`,
      );
      return cached;
    }
    // Check if a previous request was already building the cache. If so use that promise
    // instead of restarting it
    const key = this.pool.getSelectorKey(config.selectors);
    let build = this.pending[key];

    if (build) {
      this.logger.debug(
        `SelectorStorePool build in progress for selectors: [${config.selectors.join(', ')}]. Awaiting it...`,
      );
    } else {
      this.logger.debug(
        `SelectorStorePool miss for selectors: [${config.selectors.join(', ')}]. Populating in-memory store...`,
      );
      build = this.populateStore(config, key);
      this.pending[key] = build;
    }

    return build;
  }

  /**
   * Fetches the selected inputs, merges them into one {@link Store} and pools it.
   */
  protected async populateStore(config: DerivationConfig, key: string): Promise<PooledStore> {
    try {
      const pooled = await this.buildStore(config);
      const { store } = pooled;

      this.logger.debug(
        `Successfully loaded the in-memory store for selectors: [${config.selectors.join(', ')}]`,
      );

      this.pool.setStore(config.selectors, pooled);
      return pooled;
    } finally {
      // Cleared only after the pool has been written, so anything arriving from here on finds the
      // finished store instead of starting the build over.
      delete this.pending[key];
    }
  }

  /**
   * Reads the selected inputs into a new {@link Store}.
   */
  protected async buildStore(config: DerivationConfig): Promise<PooledStore> {
    // Import all representation data streams into store, each as soon as it is read, so only a
    // bounded number of inputs is ever open at once.
    // The most recent timestamp of all inputs is kept,
    // as caches further down the chain use it to detect changes in the input data.
    const store = new Store();
    let modified = new Date(0);

    await this.forEachRepresentation(config, async(representation): Promise<void> => {
      const timestamp = representation.metadata.get(DC.terms.modified)?.value;
      if (timestamp) {
        const date = new Date(timestamp);
        if (date > modified) {
          modified = date;
        }
      }
      await once(store.import(representation.data), 'end');
    });

    return { store, modified };
  }
}
