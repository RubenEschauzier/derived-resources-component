import { NotImplementedHttpError, RepresentationMetadata } from '@solid/community-server';
import type { DerivationConfig } from '../../../../src/DerivationConfig';
import { PatternBatchFilterParser } from '../../../../src/filter/parser/PatternBatchFilterParser';
import type { QueryResourceIdentifier } from '../../../../src/QueryResourceIdentifier';
import { DERIVED_TYPES } from '../../../../src/Vocabularies';

describe('PatternBatchFilterParser', (): void => {
  let config: DerivationConfig;
  const parser = new PatternBatchFilterParser();

  beforeEach(async(): Promise<void> => {
    config = {
      identifier: { path: 'http://example.com/', query: { p0: 'http://example.com/p' }} as QueryResourceIdentifier,
      filter: ' patterns\n',
      mappings: {},
      selectors: [],
      metadata: new RepresentationMetadata(),
    };
  });

  it('only accepts pattern batch filters.', async(): Promise<void> => {
    await expect(parser.canHandle(config)).resolves.toBeUndefined();

    config.filter = 'qpf';
    await expect(parser.canHandle(config)).rejects.toThrow(NotImplementedHttpError);
  });

  it('returns a pattern batch filter keyed by the query parameters.', async(): Promise<void> => {
    await expect(parser.handle(config)).resolves.toEqual({
      type: DERIVED_TYPES.terms.PatternBatch,
      data: '',
      checksum: '{"p0":"http://example.com/p"}',
      metadata: new RepresentationMetadata(),
    });
  });

  it('uses a fixed checksum without query parameters.', async(): Promise<void> => {
    config.identifier = { path: 'http://example.com/' };
    await expect(parser.handle(config)).resolves.toEqual(expect.objectContaining({ checksum: 'patterns' }));
  });
});
