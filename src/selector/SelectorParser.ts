import type { ResourceIdentifier } from '@solid/community-server';
import { AsyncHandler } from 'asynchronous-handlers';
import type { DerivationConfig } from '../DerivationConfig';

/**
 * Determines which resources should be selected based on the selector info.
 */
export abstract class SelectorParser extends AsyncHandler<DerivationConfig, ResourceIdentifier[]> {}
