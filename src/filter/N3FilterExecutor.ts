import type { Representation } from '@solid/community-server';
import { AsyncHandler } from 'asynchronous-handlers';
import type { Store } from 'n3';
import type { DerivationConfig } from '../DerivationConfig';
import type { Filter } from './Filter';

export interface N3FilterExecutorInput<T = unknown> {
  /**
   * Config of the derived resource.
   */
  config: DerivationConfig;
  /**
   * Filter object to apply.
   */
  filter: Filter<T>;
  /**
   * N3.js store containing the triples to apply the filter to. It may only be built once asked for.
   */
  getData: () => Promise<Store>;
  /**
   * Path of an HDT file holding the same triples, which executors can query instead.
   */
  hdtPath?: string;
}

/**
 * Similar to a {@link FilterExecutor} but takes an N3.js store as input instead.
 */
export abstract class N3FilterExecutor<T = unknown> extends AsyncHandler<N3FilterExecutorInput<T>, Representation> {}
