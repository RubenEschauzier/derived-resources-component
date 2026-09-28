import { NotImplementedHttpError, RepresentationMetadata } from '@solid/community-server';
import type { DerivationConfig } from '../../DerivationConfig';
import { isQueryResourceIdentifier } from '../../QueryResourceIdentifier';
import { DERIVED_TYPES } from '../../Vocabularies';
import type { Filter } from '../Filter';
import { FilterParser } from './FilterParser';

/**
 * Parses a pattern batch filter: a filter consisting of just the string `patterns`.
 * As with QPF, the patterns themselves come from the query parameters of the request, so the filter
 * carries no data and its checksum is determined by those parameters.
 */
export class PatternBatchFilterParser extends FilterParser {
  public async canHandle({ filter }: DerivationConfig): Promise<void> {
    if (filter.trim() !== 'patterns') {
      throw new NotImplementedHttpError('Only pattern batch filter bodies are supported.');
    }
  }

  public async handle(config: DerivationConfig): Promise<Filter<string>> {
    return {
      type: DERIVED_TYPES.terms.PatternBatch,
      data: '',
      checksum: isQueryResourceIdentifier(config.identifier) ? JSON.stringify(config.identifier.query) : 'patterns',
      metadata: new RepresentationMetadata(),
    };
  }
}
