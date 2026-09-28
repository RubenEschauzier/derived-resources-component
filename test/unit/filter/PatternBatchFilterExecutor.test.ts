import { Readable } from 'node:stream';
import type { Quad } from '@rdfjs/types';
import {
  BadRequestHttpError,
  BasicRepresentation,
  INTERNAL_QUADS,
  NotImplementedHttpError,
  readableToQuads,
  RepresentationMetadata,
} from '@solid/community-server';
import { DataFactory, Parser, Store } from 'n3';
import type { FilterExecutorInput } from '../../../src/filter/FilterExecutor';
import { PatternBatchFilterExecutor } from '../../../src/filter/PatternBatchFilterExecutor';
import type { QueryResourceIdentifier } from '../../../src/QueryResourceIdentifier';
import { createStoreRepresentation } from '../../../src/selector/StoreRepresentation';
import { DERIVED_TYPES } from '../../../src/Vocabularies';

const { namedNode } = DataFactory;
const EX = 'http://example.com/';

describe('PatternBatchFilterExecutor', (): void => {
  let quads: Quad[];
  let executor: PatternBatchFilterExecutor;

  function input(query: Record<string, string>, fromStore = true): FilterExecutorInput {
    const identifier: QueryResourceIdentifier = { path: `${EX}derived`, query };
    return {
      config: { identifier, selectors: [], filter: 'patterns', mappings: {}, metadata: new RepresentationMetadata() },
      filter: { type: DERIVED_TYPES.terms.PatternBatch, data: '', checksum: '', metadata: new RepresentationMetadata() },
      representations: fromStore ?
          [ createStoreRepresentation(new Store(quads), { path: `${EX}input` }, new Date()) ] :
          [
            new BasicRepresentation(Readable.from(quads.slice(0, 3)), { path: `${EX}a` }, INTERNAL_QUADS),
            new BasicRepresentation(Readable.from(quads.slice(3)), { path: `${EX}b` }, INTERNAL_QUADS),
          ],
    };
  }

  async function results(query: Record<string, string>, fromStore = true): Promise<string[]> {
    const representation = await executor.handle(input(query, fromStore));
    expect(representation.metadata.contentType).toBe(INTERNAL_QUADS);
    const found: string[] = [];
    for await (const quad of representation.data) {
      found.push(`${(quad as Quad).subject.value} ${(quad as Quad).predicate.value} ${(quad as Quad).object.value}`);
    }
    return found;
  }

  beforeEach(async(): Promise<void> => {
    quads = new Parser().parse(`
      @prefix : <${EX}>.
      :foo :likes :apples; :knows :bar.
      :bar :likes :pears; :knows :bar.
      <${EX}g> { :baz :likes :plums. }
    `);
    executor = new PatternBatchFilterExecutor(3);
  });

  it('only handles pattern batch filters.', async(): Promise<void> => {
    await expect(executor.canHandle(input({ p0: `${EX}likes` }))).resolves.toBeUndefined();
    const other = input({});
    other.filter.type = DERIVED_TYPES.terms.QPF;
    await expect(executor.canHandle(other)).rejects.toThrow(NotImplementedHttpError);
  });

  it('returns the matches of every pattern, pattern after pattern.', async(): Promise<void> => {
    await expect(results({ s1: `${EX}bar`, p1: `${EX}knows`, p0: `${EX}likes`, o0: `${EX}apples` })).resolves.toEqual([
      `${EX}foo ${EX}likes ${EX}apples`,
      `${EX}bar ${EX}knows ${EX}bar`,
    ]);
  });

  it('treats variables and omitted positions as matching anything, in every graph.', async(): Promise<void> => {
    await expect(results({ s0: '?s', p0: `${EX}likes` })).resolves.toEqual([
      `${EX}foo ${EX}likes ${EX}apples`,
      `${EX}bar ${EX}likes ${EX}pears`,
      `${EX}baz ${EX}likes ${EX}plums`,
    ]);
  });

  it('only matches the default graph when asked for it.', async(): Promise<void> => {
    await expect(results({ p0: `${EX}likes`, g0: 'urn:default' })).resolves.toEqual([
      `${EX}foo ${EX}likes ${EX}apples`,
      `${EX}bar ${EX}likes ${EX}pears`,
    ]);
  });

  it('requires a repeated variable to bind the same term.', async(): Promise<void> => {
    await expect(results({ s0: '?x', p0: `${EX}knows`, o0: '?x' })).resolves.toEqual([
      `${EX}bar ${EX}knows ${EX}bar`,
    ]);
  });

  it('returns a quad once for every pattern it matches.', async(): Promise<void> => {
    const found = await results({ p0: `${EX}likes`, s1: `${EX}foo` });
    expect(found.filter(quad => quad === `${EX}foo ${EX}likes ${EX}apples`)).toHaveLength(2);
  });

  it('matches inputs that are not a pooled store.', async(): Promise<void> => {
    await expect(results({ p0: `${EX}knows` }, false)).resolves.toEqual([
      `${EX}foo ${EX}knows ${EX}bar`,
      `${EX}bar ${EX}knows ${EX}bar`,
    ]);
  });

  it('rejects a request without patterns.', async(): Promise<void> => {
    await expect(executor.handle(input({ other: 'x' }))).rejects.toThrow(BadRequestHttpError);
  });

  it('rejects a request with more patterns than allowed.', async(): Promise<void> => {
    await expect(executor.handle(input({ p0: 'a', p1: 'b', p2: 'c', p3: 'd' }))).rejects.toThrow(BadRequestHttpError);
  });

  it('can be read into quads by the rest of the server.', async(): Promise<void> => {
    const representation = await executor.handle(input({ p0: `${EX}likes` }));
    const store = await readableToQuads(representation.data);
    expect(store.countQuads(null, namedNode(`${EX}likes`), null, null)).toBe(3);
  });
});
