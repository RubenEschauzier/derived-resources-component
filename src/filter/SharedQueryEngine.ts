import { QueryEngine } from '@comunica/query-sparql-hdt';

/**
 * A single Comunica engine for every executor that runs queries, so it is only set up once rather
 * than once per executor or per request.
 *
 * Its sources can be RDF/JS stores as well as HDT files. Comunica opens an HDT file for each query,
 * which only maps the file and its prebuilt index into memory.
 */
export class SharedQueryEngine {
  public readonly engine = new QueryEngine();
}
