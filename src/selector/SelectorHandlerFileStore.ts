import type { Dirent } from 'node:fs';
import { createReadStream, promises as fsPromises } from 'node:fs';
import { once } from 'node:events';
import { join, relative, sep } from 'node:path';
import type { FileIdentifierMapper, ResourceStore } from '@solid/community-server';
import { getLoggerFor } from 'global-logger-factory';
import { Store, StreamParser } from 'n3';
import type { DerivationConfig } from '../DerivationConfig';
import type { HdtIndexLocator } from '../hdt/HdtIndexLocator';
import type { PooledStore, SelectorStorePool } from '../SelectorStorePool';
import { SelectorHandlerCachedStore } from './SelectorHandlerCachedStore';
import type { SelectorParser } from './SelectorParser';

/**
 * The RDF serializations read straight from disk, by file extension.
 */
const FORMATS: Record<string, string> = {
  '.nq': 'application/n-quads',
  '.nt': 'application/n-triples',
  '.ttl': 'text/turtle',
  '.trig': 'application/trig',
};

/**
 * A {@link SelectorHandlerCachedStore} that builds its stores by reading the selected files from
 * disk itself, for selectors whose inputs live in the file backend.
 *
 * Going through the {@link ResourceStore} costs a container read per container and a full request
 * per input — identifier validation, metadata, content negotiation — only to end up parsing the
 * file into the store. Walking the directory and parsing the files directly skips all of that, so a
 * store costs little more than reading and parsing its inputs once.
 *
 * A selector is resolved to a directory with the {@link FileIdentifierMapper}, and the part of it
 * after that directory is matched against the relative paths of the files below it, extension
 * included, as that is what the selector's extension stands for. Dot files are never selected, as
 * they hold the auxiliary resources that containment does not list either. Selectors that cannot be
 * resolved this way, or inputs in another format, fall back to the {@link ResourceStore}.
 */
export class SelectorHandlerFileStore extends SelectorHandlerCachedStore {
  protected readonly logger = getLoggerFor(this);
  protected readonly mapper: FileIdentifierMapper;

  /**
   * @param parser - Determines the inputs the selectors select, for selectors not resolved on disk.
   * @param store - Store to read those inputs from.
   * @param pool - Pool of the stores built.
   * @param mapper - Maps selectors to the directories they select from.
   * @param hdtIndex - Finds an HDT index holding the selected inputs, see {@link SelectorHandlerCachedStore}.
   */
  public constructor(parser: SelectorParser, store: ResourceStore, pool: SelectorStorePool,
    mapper: FileIdentifierMapper, hdtIndex?: HdtIndexLocator) {
    super(parser, store, pool, hdtIndex);
    this.mapper = mapper;
  }

  protected override async buildStore(config: DerivationConfig): Promise<PooledStore> {
    const files = await this.selectFiles(config.selectors);
    if (!files) {
      return super.buildStore(config);
    }

    const store = new Store();
    let modified = new Date(0);
    let next = 0;
    const read = async(): Promise<void> => {
      while (next < files.length) {
        const file = files[next++];
        const [ stats ] = await Promise.all([
          fsPromises.stat(file.path),
          once(store.import(createReadStream(file.path).pipe(new StreamParser({ format: file.format }))), 'end'),
        ]);
        if (stats.mtime > modified) {
          modified = stats.mtime;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, files.length) }, read));
    this.logger.debug(`Read ${files.length} files into a store`);
    return { store, modified };
  }

  /**
   * The files every selector selects, or undefined if any of them cannot be resolved on disk.
   */
  protected async selectFiles(selectors: string[]): Promise<{ path: string; format: string }[] | undefined> {
    const perSelector = await Promise.all(selectors.map(async(selector) => this.selectorFiles(selector)));
    if (perSelector.some(files => !files)) {
      return undefined;
    }
    // A file selected by two selectors is read once
    const seen = new Set<string>();
    return perSelector.flat().filter((file): boolean => {
      if (seen.has(file!.path)) {
        return false;
      }
      seen.add(file!.path);
      return true;
    }) as { path: string; format: string }[];
  }

  protected async selectorFiles(selector: string): Promise<{ path: string; format: string }[] | undefined> {
    const globStart = selector.search(/[*?]/u);
    if (globStart < 0) {
      return undefined;
    }
    const containerUrl = selector.slice(0, selector.lastIndexOf('/', globStart) + 1);
    const pattern = this.globToRegExp(selector.slice(containerUrl.length));

    let directory: string;
    try {
      directory = (await this.mapper.mapUrlToFilePath({ path: containerUrl }, false)).filePath;
    } catch {
      return undefined;
    }

    let entries: Dirent[];
    try {
      entries = await fsPromises.readdir(directory, { recursive: true, withFileTypes: true });
    } catch (error: unknown) {
      // A container that does not exist selects nothing
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const files: { path: string; format: string }[] = [];
    for (const entry of entries) {
      // Only files are inputs; a directory whose name happens to match is skipped
      if (!entry.isFile()) {
        continue;
      }
      // The typings in use predate `parentPath`, which replaced `path` on Node 20.12
      const { parentPath, path: legacyPath } = entry as Dirent & { parentPath?: string; path?: string };
      const path = join(parentPath ?? legacyPath!, entry.name);
      const relativePath = relative(directory, path).split(sep).join('/');
      if (relativePath.split('/').some(segment => segment.startsWith('.')) || !pattern.test(relativePath)) {
        continue;
      }
      const extension = /\.[^./]+$/u.exec(relativePath)?.[0].toLowerCase();
      const format = extension ? FORMATS[extension] : undefined;
      // A selected input this handler cannot parse itself is left to the resource store
      if (!format) {
        return undefined;
      }
      files.push({ path, format });
    }
    return files;
  }

  /**
   * A regular expression for a relative glob: `**` crosses directories, `*` and `?` do not.
   */
  protected globToRegExp(glob: string): RegExp {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
      const char = glob[i];
      if (char === '*' && glob[i + 1] === '*') {
        // `**/` also matches no directory at all
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else if (char === '*') {
        source += '[^/]*';
      } else if (char === '?') {
        source += '[^/]';
      } else {
        source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
      }
    }
    return new RegExp(`^${source}$`, 'u');
  }
}
