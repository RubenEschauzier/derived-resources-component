import { Readable } from 'node:stream';
import type { Quad, Term } from '@rdfjs/types';
import type { Representation } from '@solid/community-server';
import {
  BasicRepresentation,
  createErrorMessage,
  getLoggerFor,
  INTERNAL_QUADS,
  InternalServerError,
  NotImplementedHttpError,
} from '@solid/community-server';
import { LRUCache } from 'lru-cache';
import { DataFactory } from 'n3';
import { Parser } from 'sparqljs';
import { DERIVED_TYPES } from '../Vocabularies';
import type { N3FilterExecutorInput } from './N3FilterExecutor';
import { N3FilterExecutor } from './N3FilterExecutor';

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const SPARQL_JSON = 'application/sparql-results+json';

/**
 * The three positions of a triple pattern, in the order a wildcard projection lists them.
 */
const POSITIONS = [ 'subject', 'predicate', 'object' ] as const;
type Position = typeof POSITIONS[number];

interface PatternPlan {
  /**
   * Terms to match on, with `null` for a position that holds a variable.
   */
  match: Record<Position, Term | null>;
  /**
   * Positions that must carry equal terms, because the pattern repeats a variable across them.
   * `getQuads` cannot express this, so matches are filtered afterwards.
   */
  equalities: [Position, Position][];
  /**
   * Where each variable of the pattern sits. A variable repeated in the pattern is listed once,
   * at its first position, since every occurrence is bound to the same term.
   */
  variables: Map<string, Position>;
}

interface SelectPlan extends PatternPlan {
  queryType: 'SELECT';
  /**
   * The projected variables, in result order.
   */
  projection: { name: string; position: Position }[];
  distinct: boolean;
}

interface ConstructPlan extends PatternPlan {
  queryType: 'CONSTRUCT';
  /**
   * The template triple, as a constant term per position or the pattern position to copy from.
   */
  template: Record<Position, { constant: Term } | { from: Position }>;
}

type Plan = SelectPlan | ConstructPlan;

/**
 * Applies a SPARQL filter that reduces to a single triple pattern, by matching the pattern against
 * the N3.js store directly instead of running a query engine over it.
 */
export class SparqlPatternFilterExecutor extends N3FilterExecutor<string> {
  protected readonly logger = getLoggerFor(this);
  protected readonly parser = new Parser();
  /**
   * Plans by query string. `canHandle` and `handle` are separate calls on every request, and the
   * same filter recurs for every resource derived from a template, so the parse is worth keeping.
   */
  protected readonly plans: LRUCache<string, Plan>;

  public constructor(cacheSettings?: { max?: number }) {
    super();
    this.plans = new LRUCache<string, Plan>({ max: cacheSettings?.max ?? 100 });
  }

  public async canHandle({ filter }: N3FilterExecutorInput): Promise<void> {
    if (!filter.type.equals(DERIVED_TYPES.terms.Sparql)) {
      throw new NotImplementedHttpError('Only SPARQL filters are supported.');
    }
    if (!this.getPlan(filter.data as string)) {
      throw new NotImplementedHttpError('Only single triple pattern SELECT/CONSTRUCT is supported.');
    }
  }

  public async handle({ filter, data, config }: N3FilterExecutorInput): Promise<Representation> {
    const query = filter.data as string;
    const plan = this.getPlan(query);
    if (!plan) {
      throw new InternalServerError('Calling handle before calling canHandle');
    }

    try {
      // `null` for the graph matches quads in every graph, which is what the query engine does
      // when the store is handed to it as a single source.
      const matches = data.getQuads(plan.match.subject, plan.match.predicate, plan.match.object, null)
        .filter((quad): boolean => this.satisfiesEqualities(quad, plan));

      if (plan.queryType === 'CONSTRUCT') {
        return new BasicRepresentation(
          Readable.from(this.buildQuads(matches, plan)),
          config.identifier,
          INTERNAL_QUADS,
        );
      }
      return new BasicRepresentation(
        Readable.from(this.serializeBindings(matches, plan)),
        config.identifier,
        SPARQL_JSON,
      );
    } catch (error: unknown) {
      throw new InternalServerError(
        `There was a problem applying the filter while generating the derived resource: ${createErrorMessage(error)}`,
      );
    }
  }

  protected getPlan(query: string): Plan | undefined {
    const cached = this.plans.get(query);
    if (cached) {
      return cached;
    }
    const plan = this.buildPlan(query);
    if (plan) {
      this.plans.set(query, plan);
    }
    return plan;
  }

  /**
   * Interprets the query, or returns `undefined` if any part of it falls outside the subset.
   */
  protected buildPlan(query: string): Plan | undefined {
    let parsed: any;
    try {
      parsed = this.parser.parse(query);
    } catch (error: unknown) {
      this.logger.debug(`Not a valid SPARQL query: ${createErrorMessage(error)}`);
      return;
    }

    // Solution modifiers and dataset clauses change which or how many solutions come out, and none
    // of them are implemented here.
    if (parsed.type !== 'query' || parsed.limit !== undefined || parsed.offset !== undefined ||
      parsed.order || parsed.group || parsed.having || parsed.from || parsed.values) {
      return;
    }
    if (!Array.isArray(parsed.where) || parsed.where.length !== 1 || parsed.where[0].type !== 'bgp') {
      return;
    }
    const triples = parsed.where[0].triples;
    if (!Array.isArray(triples) || triples.length !== 1) {
      return;
    }

    const pattern = this.readPattern(triples[0]);
    if (!pattern) {
      return;
    }

    if (parsed.queryType === 'CONSTRUCT') {
      return this.buildConstructPlan(parsed, pattern);
    }
    if (parsed.queryType === 'SELECT') {
      return this.buildSelectPlan(parsed, pattern);
    }
  }

  /**
   * Splits a triple into the terms to match on and the variables to bind, or `undefined` if it
   * holds anything other than variables and ground terms.
   */
  protected readPattern(triple: any): PatternPlan | undefined {
    const match: Record<Position, Term | null> = { subject: null, predicate: null, object: null };
    const variables = new Map<string, Position>();
    const seen = new Map<string, Position>();
    const equalities: [Position, Position][] = [];

    for (const position of POSITIONS) {
      const term: Term | undefined = triple[position];
      // A property path parses to an object rather than a term, and a nested triple to a Quad.
      if (!term?.termType || term.termType === 'Quad') {
        return;
      }
      if (term.termType === 'Variable') {
        const first = seen.get(term.value);
        if (first) {
          equalities.push([ first, position ]);
        } else {
          seen.set(term.value, position);
          variables.set(term.value, position);
        }
        continue;
      }
      if (term.termType !== 'NamedNode' && term.termType !== 'Literal' && term.termType !== 'BlankNode') {
        return;
      }
      match[position] = term;
    }

    return { match, equalities, variables };
  }

  protected buildConstructPlan(parsed: any, pattern: PatternPlan): ConstructPlan | undefined {
    if (!Array.isArray(parsed.template) || parsed.template.length !== 1) {
      return;
    }
    const triple = parsed.template[0];
    const template: Partial<ConstructPlan['template']> = {};

    for (const position of POSITIONS) {
      const term: Term | undefined = triple[position];
      if (!term?.termType || term.termType === 'Quad') {
        return;
      }
      if (term.termType === 'Variable') {
        const from = pattern.variables.get(term.value);
        // A template variable the pattern never binds produces no triple for that solution.
        // Rather than implement that, leave the query to the engine.
        if (!from) {
          return;
        }
        template[position] = { from };
        continue;
      }
      // A blank node in a template must be freshly minted per solution, which this does not do.
      if (term.termType === 'BlankNode') {
        return;
      }
      template[position] = { constant: term };
    }

    return { ...pattern, queryType: 'CONSTRUCT', template: <ConstructPlan['template']> template };
  }

  protected buildSelectPlan(parsed: any, pattern: PatternPlan): SelectPlan | undefined {
    const variables = parsed.variables;
    if (!Array.isArray(variables) || variables.length === 0) {
      return;
    }

    let projection: { name: string; position: Position }[];
    if (variables.length === 1 && variables[0]?.termType === 'Wildcard') {
      projection = [ ...pattern.variables.entries() ]
        .map(([ name, position ]): { name: string; position: Position } => ({ name, position }))
        .sort((a, b): number => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
    } else {
      projection = [];
      for (const variable of variables) {
        // An expression or aggregate carries a `expression` field instead of being a plain term.
        if (variable?.termType !== 'Variable') {
          return;
        }
        const position = pattern.variables.get(variable.value);
        // Projecting a variable the pattern does not bind is legal but always unbound; not worth
        // implementing here.
        if (!position) {
          return;
        }
        projection.push({ name: variable.value, position });
      }
    }

    if (projection.length === 0) {
      return;
    }

    return { ...pattern, queryType: 'SELECT', projection, distinct: parsed.distinct === true };
  }

  protected satisfiesEqualities(quad: Quad, plan: PatternPlan): boolean {
    return plan.equalities.every(([ left, right ]): boolean => quad[left].equals(quad[right]));
  }

  protected* buildQuads(matches: Quad[], plan: ConstructPlan): Iterable<Quad> {
    for (const match of matches) {
      yield DataFactory.quad(
        <any> this.templateTerm(match, plan.template.subject),
        <any> this.templateTerm(match, plan.template.predicate),
        <any> this.templateTerm(match, plan.template.object),
      );
    }
  }

  protected templateTerm(quad: Quad, slot: { constant: Term } | { from: Position }): Term {
    return 'constant' in slot ? slot.constant : quad[slot.from];
  }

  /**
   * Streams SPARQL results JSON, a chunk at a time rather than as one string, so a large result
   * set does not have to be held in memory twice.
   */
  protected* serializeBindings(matches: Quad[], plan: SelectPlan): Iterable<string> {
    const names = plan.projection.map(({ name }): string => name);
    yield `{"head":{"vars":${JSON.stringify(names)}},"results":{"bindings":[`;

    const seen = plan.distinct ? new Set<string>() : undefined;
    let first = true;
    for (const match of matches) {
      const row: Record<string, unknown> = {};
      for (const { name, position } of plan.projection) {
        row[name] = this.termToJson(match[position]);
      }
      const serialized = JSON.stringify(row);
      if (seen) {
        if (seen.has(serialized)) {
          continue;
        }
        seen.add(serialized);
      }
      yield first ? serialized : `,${serialized}`;
      first = false;
    }

    yield ']}}';
  }

  protected termToJson(term: Term): Record<string, string> {
    switch (term.termType) {
      case 'NamedNode':
        return { type: 'uri', value: term.value };
      case 'BlankNode':
        return { type: 'bnode', value: term.value };
      case 'Literal': {
        const literal = <any> term;
        if (literal.language) {
          return { type: 'literal', value: term.value, 'xml:lang': literal.language };
        }
        const datatype = literal.datatype?.value;
        if (datatype && datatype !== XSD_STRING) {
          return { type: 'literal', value: term.value, datatype };
        }
        return { type: 'literal', value: term.value };
      }
      default:
        throw new InternalServerError(`Cannot serialize term of type ${term.termType}`);
    }
  }
}
