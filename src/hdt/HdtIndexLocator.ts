import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import type { FileIdentifierMapper } from '@solid/community-server';

/**
 * The selectors, relative to a directory, whose inputs an HDT index in that directory holds: every
 * RDF document below it.
 */
const INDEXED_SELECTORS = [ '**/*.nq', '**/*.ttl' ];

export interface HdtIndex {
  /**
   * Path of the HDT file.
   */
  path: string;
  /**
   * When the HDT file was last written.
   */
  modified: Date;
}

/**
 * Finds the HDT index holding the inputs of a derived resource: a file in the top-level directory
 * of its pod, named `.index.hdt` by default, which holds every RDF document below that directory.
 *
 * An index is only used if it holds exactly what the selectors select, so only for selectors that
 * select every document below one directory. It is not kept in sync with those documents: it has
 * to be rebuilt when they change.
 */
export class HdtIndexLocator {
  protected readonly mapper: FileIdentifierMapper;
  protected readonly indexName: string;

  /**
   * @param mapper - Maps the directory the selectors select from to its path on disk.
   * @param indexName - File name of the index in that directory.
   */
  public constructor(mapper: FileIdentifierMapper, indexName = '.index.hdt') {
    this.mapper = mapper;
    this.indexName = indexName;
  }

  /**
   * The index holding exactly what the selectors select, if there is one.
   */
  public async locate(selectors: string[]): Promise<HdtIndex | undefined> {
    const directories = new Set<string>();
    for (const selector of selectors) {
      const indexed = INDEXED_SELECTORS.find((tail): boolean => selector.endsWith(`/${tail}`));
      if (!indexed) {
        return;
      }
      directories.add(selector.slice(0, -indexed.length));
    }
    // Selectors of several directories would need several indexes
    if (directories.size !== 1) {
      return;
    }

    const [ directory ] = directories;
    let path: string;
    try {
      path = join((await this.mapper.mapUrlToFilePath({ path: directory }, false)).filePath, this.indexName);
    } catch {
      return;
    }
    try {
      return { path, modified: (await fsPromises.stat(path)).mtime };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}
