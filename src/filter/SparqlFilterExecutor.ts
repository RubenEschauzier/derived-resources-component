import { on } from 'node:events';
import { Readable } from 'node:stream';
import type { QueryEngine } from '@comunica/query-sparql-hdt';
import type { Quad } from '@rdfjs/types';
import type {
  Representation,
} from '@solid/community-server';
import {
  APPLICATION_JSON,
  BasicRepresentation,
  createErrorMessage,
  INTERNAL_QUADS,
  InternalServerError,
  NotImplementedHttpError,
} from '@solid/community-server';
import { getLoggerFor } from 'global-logger-factory';
import type * as asyncIt from 'asynciterator';
import { DERIVED_TYPES } from '../Vocabularies';
import type { N3FilterExecutorInput } from './N3FilterExecutor';
import { N3FilterExecutor } from './N3FilterExecutor';
import { SharedQueryEngine } from './SharedQueryEngine';

/**
 * Applies a SPARQL filter to an N3.js store, or to the HDT file holding the same data if there is one,
 * so the store does not need to be built.
 */
export class SparqlFilterExecutor extends N3FilterExecutor<string> {
  protected readonly logger = getLoggerFor(this);
  protected readonly engine: QueryEngine;

  /**
   * @param engine - Engine to run the queries with, shared with the other executors that run queries.
   */
  public constructor(engine?: SharedQueryEngine) {
    super();
    this.engine = (engine ?? new SharedQueryEngine()).engine;
  }

  public async canHandle({ filter }: N3FilterExecutorInput): Promise<void> {
    if (!filter.type.equals(DERIVED_TYPES.terms.Sparql)) {
      throw new NotImplementedHttpError('Only SPARQL filters are supported.');
    }
  }

  public async handle({ filter, getData, hdtPath, config }: N3FilterExecutorInput): Promise<Representation> {
    const query = filter.data as string;
    this.logger.debug(`Using filter with contents ${query}`);

    try {
      const source = hdtPath ? { type: 'hdt', value: hdtPath } : await getData();
      const resultTest = await this.engine.query(query, { sources: [ source ]});
      if (resultTest.resultType === 'bindings'){
        const mediaType = 'application/sparql-results+json'; 
        const { data } = await this.engine.resultToString(resultTest, mediaType);        
        return new BasicRepresentation(
          Readable.from(data),
          config.identifier,
          mediaType
        );
      }
      else if (resultTest.resultType === 'quads'){
        return new BasicRepresentation(
          Readable.from(this.convertAsyncIterator(await resultTest.execute())),
          config.identifier,
          INTERNAL_QUADS,
        );
      }
      throw new Error(`ASK or UPDATE queries are not supported, got: ${resultTest.resultType}`);
      // const result = await this.engine.queryQuads(query, { sources: [ data ]});
      // return new BasicRepresentation(
      //   Readable.from(this.convertAsyncIterator(result)),
      //   config.identifier,
      //   INTERNAL_QUADS,
      // );
    } catch (error: unknown) {
      throw new InternalServerError(
        `There was a problem applying the filter while generating the derived resource: ${createErrorMessage(error)}`,
      );
    }
  }

  /**
   * Converts a stream from the AsyncIterator library to an async generator.
   */
  protected async* convertAsyncIterator(it: asyncIt.AsyncIterator<Quad>): AsyncIterable<Quad> {
    const dataIt = on(it, 'data');
    // eslint-disable-next-line ts/no-misused-promises
    it.on('end', async(): Promise<void> => {
      await dataIt.return!();
    });
    for await (const data of dataIt) {
      yield* data;
    }
  }
}
