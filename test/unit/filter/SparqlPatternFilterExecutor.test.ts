import { QueryEngine } from '@comunica/query-sparql';
import { RepresentationMetadata, readableToString } from '@solid/community-server';
import { DataFactory, Store } from 'n3';
import type { DerivationConfig } from '../../../src/DerivationConfig';
import type { Filter } from '../../../src/filter/Filter';
import { SparqlPatternFilterExecutor } from '../../../src/filter/SparqlPatternFilterExecutor';
import { DERIVED_TYPES } from '../../../src/Vocabularies';

const { quad, namedNode, literal, blankNode, variable } = DataFactory;

const P = 'http://ex.org/p';
const Q = 'http://ex.org/q';

function sparqlFilter(query: string): Filter<string> {
  return {
    data: query,
    type: DERIVED_TYPES.terms.Sparql,
    checksum: query,
    metadata: new RepresentationMetadata(),
  };
}

const config: DerivationConfig = {
  identifier: { path: 'http://example.com/derived' },
  selectors: [ 'http://example.com/data/*' ],
  filter: 'http://example.com/filter',
  mappings: {},
  metadata: {} as any,
};

describe('SparqlPatternFilterExecutor', (): void => {
  let executor: SparqlPatternFilterExecutor;
  let data: Store;

  beforeEach((): void => {
    executor = new SparqlPatternFilterExecutor();
    data = new Store([
      quad(namedNode('http://ex.org/a'), namedNode(P), literal('one')),
      quad(namedNode('http://ex.org/b'), namedNode(P), literal('two', 'en')),
      quad(namedNode('http://ex.org/c'), namedNode(P), namedNode('http://ex.org/d')),
      quad(namedNode('http://ex.org/a'), namedNode(Q), literal('7', namedNode('http://www.w3.org/2001/XMLSchema#integer'))),
      quad(blankNode('b1'), namedNode(P), literal('blank')),
      // A quad whose subject and object are the same term, for the repeated-variable case
      quad(namedNode('http://ex.org/self'), namedNode(Q), namedNode('http://ex.org/self')),
    ]);
  });

  async function run(query: string): Promise<string> {
    const filter = sparqlFilter(query);
    await executor.canHandle({ config, filter, data });
    const representation = await executor.handle({ config, filter, data });
    return readableToString(representation.data);
  }

  async function rejects(query: string): Promise<void> {
    await expect(executor.canHandle({ config, filter: sparqlFilter(query), data })).rejects.toThrow();
  }

  describe('the subset it claims', (): void => {
    it('rejects filters that are not SPARQL.', async(): Promise<void> => {
      const filter = { ...sparqlFilter('SELECT * WHERE { ?s ?p ?o }'), type: DERIVED_TYPES.terms.Shacl };
      await expect(executor.canHandle({ config, filter, data })).rejects.toThrow();
    });

    it.each([
      [ 'a join', `SELECT * WHERE { ?s <${P}> ?o . ?o <${Q}> ?x }` ],
      [ 'a limit', `SELECT * WHERE { ?s <${P}> ?o } LIMIT 1` ],
      [ 'an offset', `SELECT * WHERE { ?s <${P}> ?o } OFFSET 1` ],
      [ 'an order by', `SELECT * WHERE { ?s <${P}> ?o } ORDER BY ?o` ],
      [ 'a filter', `SELECT * WHERE { ?s <${P}> ?o . FILTER(?o != "one") }` ],
      [ 'an optional', `SELECT * WHERE { ?s <${P}> ?o OPTIONAL { ?s <${Q}> ?x } }` ],
      [ 'a graph', `SELECT * WHERE { GRAPH ?g { ?s <${P}> ?o } }` ],
      [ 'a property path', `SELECT * WHERE { ?s <${P}>/<${Q}> ?o }` ],
      [ 'an aggregate', `SELECT (COUNT(?o) AS ?n) WHERE { ?s <${P}> ?o }` ],
      [ 'an ask query', `ASK { ?s <${P}> ?o }` ],
      [ 'a construct with two template triples', `CONSTRUCT { ?s <${P}> ?o . ?s <${Q}> ?o } WHERE { ?s <${P}> ?o }` ],
      [ 'a construct binding an unmatched variable', `CONSTRUCT { ?x <${P}> ?o } WHERE { ?s <${P}> ?o }` ],
      [ 'a construct minting a blank node', `CONSTRUCT { _:x <${P}> ?o } WHERE { ?s <${P}> ?o }` ],
      [ 'a projection of an unbound variable', `SELECT ?missing WHERE { ?s <${P}> ?o }` ],
    ])('leaves %s to the full engine.', async(_name, query): Promise<void> => {
      await rejects(query);
    });
  });

  describe('results', (): void => {
    // The point of this executor is to be indistinguishable from the engine it bypasses, so the
    // expectations are taken from that engine rather than written by hand.
    const engine = new QueryEngine();

    async function constructQuads(query: string): Promise<any[]> {
      const filter = sparqlFilter(query);
      await executor.canHandle({ config, filter, data });
      const representation = await executor.handle({ config, filter, data });
      const quads: any[] = [];
      for await (const q of representation.data) {
        quads.push(q);
      }
      return quads;
    }

    /**
     * Blank node labels are scoped to the document and carry no meaning, and the engine relabels
     * them (`b1` becomes `bc_0_b1`) where matching the store directly does not. Canonicalise them
     * to their order of first appearance so the comparison is about the RDF, not the labelling.
     */
    const normalize = (quads: any[]): string[] => {
      const labels = new Map<string, string>();
      const term = (t: any): string => {
        if (t.termType !== 'BlankNode') {
          return t.value;
        }
        if (!labels.has(t.value)) {
          labels.set(t.value, `_:b${labels.size}`);
        }
        return labels.get(t.value)!;
      };
      return quads.map((q): string => `${term(q.subject)} ${term(q.predicate)} ${term(q.object)}`).sort();
    };

    it.each([
      [ 'construct echoing its pattern', `CONSTRUCT { ?s <${P}> ?o } WHERE { ?s <${P}> ?o }` ],
      [ 'construct rewriting the predicate', `CONSTRUCT { ?s <${Q}> ?o } WHERE { ?s <${P}> ?o }` ],
      [ 'construct reordering terms', `CONSTRUCT { ?o <${P}> ?s } WHERE { ?s <${P}> ?o }` ],
      [ 'construct with a bound object', `CONSTRUCT { ?s <${P}> <http://ex.org/d> } WHERE { ?s <${P}> <http://ex.org/d> }` ],
      [ 'construct with a repeated variable', `CONSTRUCT { ?x <${Q}> ?x } WHERE { ?x <${Q}> ?x }` ],
    ])('matches the engine for a %s.', async(_name, query): Promise<void> => {
      const mine = await constructQuads(query);
      const theirs = await (await engine.queryQuads(query, { sources: [ data ]})).toArray();
      expect(normalize(mine)).toEqual(normalize(theirs));
    });

    it.each([
      [ 'a plain pattern', `SELECT ?s ?o WHERE { ?s <${P}> ?o }` ],
      [ 'a wildcard', `SELECT * WHERE { ?s <${P}> ?o }` ],
      [ 'a narrowed projection', `SELECT ?o WHERE { ?s <${P}> ?o }` ],
      [ 'a distinct projection', `SELECT DISTINCT ?p WHERE { ?s ?p ?o }` ],
      [ 'a repeated variable', 'SELECT ?x WHERE { ?x ?p ?x }' ],
    ])('matches the engine bindings for %s.', async(_name, query): Promise<void> => {
      const mine = JSON.parse(await run(query));
      const theirs = JSON.parse(
        await readableToString((await engine.resultToString(
          await engine.query(query, { sources: [ data ]}),
          'application/sparql-results+json',
        )).data as any),
      );

      // Compared as a set: bindings are keyed by name in SPARQL results JSON, so neither the
      // order of `head.vars` nor the field order inside a term is significant, and the engine's
      // happens to differ from pattern order for a wildcard. What must match is the solutions.
      expect([ ...mine.head.vars ].sort()).toEqual([ ...theirs.head.vars ].sort());
      // Key order within a term object is not significant either, so compare canonically rather
      // than pinning this executor to the engine's field order.
      const canonical = (value: any): any => Array.isArray(value) ?
        value.map(canonical) :
        (value && typeof value === 'object' ?
          Object.fromEntries(Object.keys(value).sort().map((k): [string, any] => [ k, canonical(value[k]) ])) :
          value);
      // Same reason as the quad comparison: the engine relabels blank nodes, so compare their
      // presence and type rather than their arbitrary labels.
      const blind = (b: any): any => Object.fromEntries(Object.entries(b).map(([ k, v ]: [string, any]): [string, any] =>
        [ k, v.type === 'bnode' ? { type: 'bnode' } : v ]));
      const key = (b: any): string => JSON.stringify(canonical(blind(b)));
      expect(mine.results.bindings.map(key).sort()).toEqual(theirs.results.bindings.map(key).sort());
    });

    it('returns quads for a construct.', async(): Promise<void> => {
      const filter = sparqlFilter(`CONSTRUCT { ?s <${P}> ?o } WHERE { ?s <${P}> ?o }`);
      await executor.canHandle({ config, filter, data });
      const representation = await executor.handle({ config, filter, data });
      expect(representation.metadata.contentType).toBe('internal/quads');

      const quads: any[] = [];
      for await (const q of representation.data) {
        quads.push(q);
      }
      expect(quads).toHaveLength(4);
      expect(quads.map((q): string => q.object.value).sort()).toEqual([ 'blank', 'http://ex.org/d', 'one', 'two' ]);
    });

    it('projects and types bindings for a select.', async(): Promise<void> => {
      const result = JSON.parse(await run(`SELECT ?s ?o WHERE { ?s <${P}> ?o }`));

      expect(result.head.vars).toEqual([ 's', 'o' ]);
      expect(result.results.bindings).toHaveLength(4);

      const bySubject = Object.fromEntries(
        result.results.bindings.map((b: any): [string, any] => [ b.s.value, b.o ]),
      );
      // A plain literal carries no datatype, a language literal carries xml:lang,
      // an IRI object is a uri, and a blank node subject stays a bnode.
      expect(bySubject['http://ex.org/a']).toEqual({ type: 'literal', value: 'one' });
      expect(bySubject['http://ex.org/b']).toEqual({ type: 'literal', value: 'two', 'xml:lang': 'en' });
      expect(bySubject['http://ex.org/c']).toEqual({ type: 'uri', value: 'http://ex.org/d' });
      expect(result.results.bindings.some((b: any): boolean => b.s.type === 'bnode')).toBe(true);
    });

    it('keeps a typed literal datatype.', async(): Promise<void> => {
      const result = JSON.parse(await run(`SELECT ?o WHERE { ?s <${Q}> ?o }`));
      expect(result.results.bindings).toContainEqual({
        o: { type: 'literal', value: '7', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      });
    });

    it('lists wildcard variables in pattern order.', async(): Promise<void> => {
      const result = JSON.parse(await run(`SELECT * WHERE { ?subj <${P}> ?obj }`));
      expect(result.head.vars).toEqual([ 'subj', 'obj' ]);
      expect(result.results.bindings).toHaveLength(4);
    });

    it('projects a subset of the pattern variables.', async(): Promise<void> => {
      const result = JSON.parse(await run(`SELECT ?o WHERE { ?s <${P}> ?o }`));
      expect(result.head.vars).toEqual([ 'o' ]);
      expect(result.results.bindings.every((b: any): boolean => Object.keys(b).length === 1)).toBe(true);
    });

    it('honours DISTINCT on the projected tuple.', async(): Promise<void> => {
      // Two subjects share the predicate, so projecting only it yields one row under DISTINCT
      const all = JSON.parse(await run(`SELECT ?p WHERE { ?s ?p ?o }`));
      const distinct = JSON.parse(await run(`SELECT DISTINCT ?p WHERE { ?s ?p ?o }`));
      expect(all.results.bindings.length).toBeGreaterThan(distinct.results.bindings.length);
      expect(distinct.results.bindings).toHaveLength(2);
    });

    it('requires repeated variables to match the same term.', async(): Promise<void> => {
      // Only the self-referencing quad satisfies ?x ?p ?x
      const result = JSON.parse(await run('SELECT ?x WHERE { ?x ?p ?x }'));
      expect(result.results.bindings).toEqual([
        { x: { type: 'uri', value: 'http://ex.org/self' }},
      ]);
    });

    it('returns an empty result set when nothing matches.', async(): Promise<void> => {
      const result = JSON.parse(await run('SELECT ?s WHERE { ?s <http://ex.org/absent> ?o }'));
      expect(result.head.vars).toEqual([ 's' ]);
      expect(result.results.bindings).toEqual([]);
    });
  });

  it('reuses the parsed plan across calls.', async(): Promise<void> => {
    const query = `SELECT * WHERE { ?s <${P}> ?o }`;
    const spy = jest.spyOn((executor as any).parser, 'parse');
    await run(query);
    await run(query);
    // canHandle and handle each ask for the plan, across two requests: still parsed once
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fails if handle is called without canHandle.', async(): Promise<void> => {
    const filter = sparqlFilter(`SELECT * WHERE { ?s <${P}> ?o } LIMIT 1`);
    await expect(executor.handle({ config, filter, data })).rejects.toThrow('Calling handle before calling canHandle');
  });
});
