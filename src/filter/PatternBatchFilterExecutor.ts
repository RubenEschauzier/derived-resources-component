import { once } from 'node:events';
import { Readable } from 'node:stream';
import type { Quad, Term } from '@rdfjs/types';
import type { Representation } from '@solid/community-server';
import {
  BadRequestHttpError,
  BasicRepresentation,
  INTERNAL_QUADS,
  NotImplementedHttpError,
} from '@solid/community-server';
import { fromFile } from 'hdt';
import { DataFactory, Store } from 'n3';
import { stringToTerm } from 'rdf-string';
import { isQueryResourceIdentifier } from '../QueryResourceIdentifier';
import { isStoreRepresentation } from '../selector/StoreRepresentation';
import { DERIVED_TYPES } from '../Vocabularies';
import type { FilterExecutorInput } from './FilterExecutor';
import { FilterExecutor } from './FilterExecutor';

const POSITIONS = [ 'subject', 'predicate', 'object', 'graph' ] as const;
type Position = typeof POSITIONS[number];
const PARAMETERS: Record<string, Position> = { s: 'subject', p: 'predicate', o: 'object', g: 'graph' };

// The graph term a request uses to ask for the default graph only, as in the QPF interface
const DEFAULT_GRAPH_PARAMETER = 'urn:default';

/**
 * A pattern of a batch: the terms to match on, with `null` for a variable or an omitted position.
 */
interface BatchPattern {
  match: Record<Position, Term | null>;
  /**
   * Positions that must carry equal terms, because the pattern repeats a variable across them.
   */
  equalities: [Position, Position][];
}

/**
 * A {@link FilterExecutor} answering several independent quad patterns in one request.
 *
 * Link traversal asks a pod's derived resources for several single patterns at once, one for each
 * kind of link it follows. As separate requests each of them pays for a full request on the server,
 * which costs far more than matching the pattern itself. Here they share one: the patterns come from
 * the query string as `s0`, `p0`, `o0`, `g0`, `s1`, ..., every term in the syntax of `rdf-string`
 * (`?x` for a variable), with an omitted position matching anything. Each pattern is matched against
 * the store of the selected inputs, and the matches are returned as one quad stream, pattern after
 * pattern. A quad matching several patterns is returned once for each of them.
 *
 * As in {@link SparqlPatternFilterExecutor}, a pattern without a graph matches quads in every graph.
 *
 * Inputs held in an HDT file are matched by looking the patterns up in that file, so their store does
 * not need to be built. This is done with the HDT library directly rather than through a query engine,
 * which costs several times more per pattern than the lookup itself.
 */
export class PatternBatchFilterExecutor extends FilterExecutor {
  protected readonly maxPatterns: number;

  /**
   * @param maxPatterns - The most patterns one request may hold, which also bounds the length of its URL.
   */
  public constructor(maxPatterns = 20) {
    super();
    this.maxPatterns = maxPatterns;
  }

  public async canHandle({ filter }: FilterExecutorInput): Promise<void> {
    if (!filter.type.equals(DERIVED_TYPES.terms.PatternBatch)) {
      throw new NotImplementedHttpError('Only pattern batch filter bodies are supported.');
    }
  }

  public async handle({ representations, config }: FilterExecutorInput): Promise<Representation> {
    const patterns = this.parsePatterns(isQueryResourceIdentifier(config.identifier) ? config.identifier.query : {});
    const [ representation ] = representations;
    if (representations.length === 1 && isStoreRepresentation(representation) && representation.hdtPath) {
      return new BasicRepresentation(
        Readable.from(this.matchAllHdt(representation.hdtPath, patterns)),
        config.identifier,
        INTERNAL_QUADS,
      );
    }
    const store = await this.getStore(representations);
    return new BasicRepresentation(Readable.from(this.matchAll(store, patterns)), config.identifier, INTERNAL_QUADS);
  }

  protected async* matchAllHdt(hdtPath: string, patterns: BatchPattern[]): AsyncIterable<Quad> {
    // Opening the file only maps it into memory, so it is opened for every batch rather than kept open
    const document = await fromFile(hdtPath);
    try {
      for (const { match, equalities } of patterns) {
        // An HDT file only holds a default graph
        if (match.graph && match.graph.termType !== 'DefaultGraph') {
          continue;
        }
        const { triples } = await document.searchTriples(
          match.subject ?? undefined,
          match.predicate ?? undefined,
          match.object ?? undefined,
        );
        for (const quad of triples) {
          if (equalities.every(([ left, right ]): boolean => quad[left].equals(quad[right]))) {
            yield quad;
          }
        }
      }
    } finally {
      await document.close();
    }
  }

  protected* matchAll(store: Store, patterns: BatchPattern[]): Iterable<Quad> {
    for (const { match, equalities } of patterns) {
      for (const quad of store.getQuads(match.subject, match.predicate, match.object, match.graph)) {
        if (equalities.every(([ left, right ]): boolean => quad[left].equals(quad[right]))) {
          yield quad;
        }
      }
    }
  }

  /**
   * The store to match against: the pooled store if the inputs come as one, else one holding them all.
   */
  protected async getStore(representations: Representation[]): Promise<Store> {
    if (representations.length === 1 && isStoreRepresentation(representations[0])) {
      return representations[0].getStore();
    }
    const store = new Store();
    await Promise.all(representations.map(async(representation): Promise<unknown> =>
      once(store.import(representation.data), 'end')));
    return store;
  }

  /**
   * The patterns in the query parameters, in the order of their index.
   */
  protected parsePatterns(query: Record<string, string>): BatchPattern[] {
    const byIndex = new Map<number, Partial<Record<Position, string>>>();
    for (const [ key, value ] of Object.entries(query)) {
      const parameter = /^([spog])(\d+)$/u.exec(key);
      if (parameter) {
        const index = Number(parameter[2]);
        byIndex.set(index, { ...byIndex.get(index), [PARAMETERS[parameter[1]]]: value });
      }
    }
    if (byIndex.size === 0) {
      throw new BadRequestHttpError('A pattern batch needs at least one pattern, given as s0, p0, o0 and/or g0.');
    }
    if (byIndex.size > this.maxPatterns) {
      throw new BadRequestHttpError(`A pattern batch holds at most ${this.maxPatterns} patterns, got ${byIndex.size}.`);
    }
    return [ ...byIndex.entries() ]
      .sort(([ left ], [ right ]): number => left - right)
      .map(([ , terms ]): BatchPattern => this.toPattern(terms));
  }

  protected toPattern(terms: Partial<Record<Position, string>>): BatchPattern {
    const match = { subject: null, predicate: null, object: null, graph: null } as Record<Position, Term | null>;
    const variables = new Map<string, Position>();
    const equalities: [Position, Position][] = [];
    for (const position of POSITIONS) {
      const value = terms[position];
      if (value === undefined || value === '') {
        continue;
      }
      if (position === 'graph' && value === DEFAULT_GRAPH_PARAMETER) {
        match.graph = DataFactory.defaultGraph();
        continue;
      }
      const term = stringToTerm(value);
      if (term.termType === 'Variable') {
        // A variable repeated within the pattern binds the same term at every position it is in
        const first = variables.get(term.value);
        if (first) {
          equalities.push([ first, position ]);
        } else {
          variables.set(term.value, position);
        }
        continue;
      }
      match[position] = term;
    }
    return { match, equalities };
  }
}
