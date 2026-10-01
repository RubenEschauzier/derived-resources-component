import {
  INTERNAL_QUADS,
  NotImplementedHttpError,
  readableToQuads,
  readableToString,
  RepresentationMetadata,
} from '@solid/community-server';
import { join } from 'node:path';
import { DataFactory, Store } from 'n3';
import type { N3FilterExecutorInput } from '../../../src/filter/N3FilterExecutor';
import { SharedQueryEngine } from '../../../src/filter/SharedQueryEngine';
import { SparqlFilterExecutor } from '../../../src/filter/SparqlFilterExecutor';
import { DERIVED_TYPES } from '../../../src/Vocabularies';

const { literal } = DataFactory;
const { namedNode } = DataFactory;

describe('SparqlFilterExecutor', (): void => {
  let input: N3FilterExecutorInput;
  const executor = new SparqlFilterExecutor();

  beforeEach(async(): Promise<void> => {
    input = {
      config: {
        identifier: { path: 'path' },
        mappings: {},
        selectors: [],
        filter: 'filter',
        metadata: new RepresentationMetadata(),
      },
      getData: async(): Promise<Store> => new Store([
        DataFactory.quad(namedNode('http://example.com/foo'), namedNode('http://xmlns.com/foaf/0.1/name'), literal('name')),
        DataFactory.quad(namedNode('http://example.com/foo'), namedNode('http://xmlns.com/foaf/0.1/knows'), literal('other-name')),
      ]),
      filter: {
        data: `
          PREFIX foaf: <http://xmlns.com/foaf/0.1/>
          CONSTRUCT { ?s foaf:name ?o }
          WHERE {
            ?s foaf:name ?o.
          }`,
        type: DERIVED_TYPES.terms.Sparql,
        metadata: new RepresentationMetadata(),
      },
    };
  });

  it('can only handle SPARQL query filters.', async(): Promise<void> => {
    await expect(executor.canHandle(input)).resolves.toBeUndefined();

    input.filter.type = DERIVED_TYPES.terms.String;
    await expect(executor.canHandle(input)).rejects.toThrow(NotImplementedHttpError);
  });

  it('executes the SPARQL query.', async(): Promise<void> => {
    const result = await executor.handle(input);
    expect(result.metadata.contentType).toBe(INTERNAL_QUADS);
    const store = await readableToQuads(result.data);
    expect(store.countQuads(null, null, null, null)).toBe(1);
    expect(store.countQuads(namedNode('http://example.com/foo'), namedNode('http://xmlns.com/foaf/0.1/name'), literal('name'), null)).toBe(1);
  });

  describe('with the data held in an HDT file', (): void => {
    const hdtPath = join(__dirname, '../../assets/hdt/.index.hdt');
    const shared = new SharedQueryEngine();
    const hdtExecutor = new SparqlFilterExecutor(shared);

    it('queries the file without building the store.', async(): Promise<void> => {
      const getData = jest.fn(async(): Promise<Store> => new Store());
      const result = await hdtExecutor.handle({ ...input, getData, hdtPath });
      const store = await readableToQuads(result.data);
      expect(store.countQuads(null, null, null, null)).toBe(3);
      expect(store.countQuads(namedNode('http://example.com/pod/alice'), null, literal('Alice'), null)).toBe(1);
      expect(getData).not.toHaveBeenCalled();
    });

    it('returns bindings of a SELECT query as SPARQL results JSON.', async(): Promise<void> => {
      input.filter.data = `SELECT ?friend WHERE { <http://example.com/pod/alice> <http://xmlns.com/foaf/0.1/knows> ?friend }`;
      const result = await hdtExecutor.handle({ ...input, hdtPath });
      expect(result.metadata.contentType).toBe('application/sparql-results+json');
      const json = JSON.parse(await readableToString(result.data));
      expect(json.results.bindings).toEqual([{ friend: { type: 'uri', value: 'http://example.com/pod/bob' }}]);
    });
  });
});
