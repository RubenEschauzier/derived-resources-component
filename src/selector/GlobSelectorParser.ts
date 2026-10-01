import type {
  ResourceIdentifier,
  ResourceStore,
} from '@solid/community-server';
import {
  isContainerPath,
  LDP,
} from '@solid/community-server';
import { getLoggerFor } from 'global-logger-factory';
import type { DerivationConfig } from '../DerivationConfig';
import { SelectorParser } from './SelectorParser';
import type { FileIdentifierMapper } from '@solid/community-server';

export interface GlobParameters {
  glob: string;
  head: string;
  tail: string;
  childPaths: string[];
}

/**
 * Interprets selectors as resource identifiers.
 * The selector can contain glob patterns `*` or `**`.
 * How these are interpreted is based on https://www.digitalocean.com/community/tools/glob.
 */
export class GlobSelectorParser extends SelectorParser {
  protected readonly logger = getLoggerFor(this);

  protected readonly store: ResourceStore;

  protected readonly customTypes: Record<string,string> = {
    'nq': 'application/n-quads',
    'rq': 'application/sparql-query',
  };
  protected readonly mapper: FileIdentifierMapper;
  
  /**
   * 
   * @param store 
   * @param customTypes - @range {json} 
   */
  public constructor(
    store: ResourceStore, 
    mapper: FileIdentifierMapper,
    customTypes?: Record<string, string>) {
    super();
    this.store = store;
    this.mapper = mapper;
    if (customTypes){
      this.customTypes = customTypes
    }
  }

  public async handle({ selectors }: DerivationConfig): Promise<ResourceIdentifier[]> {
    return (await Promise.all(selectors.map(async(selector): Promise<ResourceIdentifier[]> =>
      this.handleSelector(selector)))).flat();
  }

  /**
   * The identifiers matching a selector.
   *
   * Every child of a container is handled at once rather than one after the other: building the
   * input of a derived resource walks a whole pod, and awaiting each resource in turn made that walk
   * cost the latency of every lookup in it. The order of the results is still that of the children.
   */
  protected async handleSelector(path: string): Promise<ResourceIdentifier[]> {
    const match = /\*\*?/u.exec(path);
    if (!match) {
      if (await this.store.hasResource({ path })) {
        this.logger.debug(`Returning selector ${path} as an identifier`);
        return [{ path }];
      }
      return [];
    }
    // There is (at least) 1 glob pattern in the path
    const head = path.slice(0, match.index);
    const glob = match[0];
    const tail = path.slice(match.index + glob.length);

    const containerPath = head.slice(0, head.lastIndexOf('/') + 1);
    const container = await this.store.getRepresentation({ path: containerPath }, {});
    const childPaths = container.metadata.getAll(LDP.terms.contains).map((term): string => term.value);
    const params: GlobParameters = { glob, head, tail, childPaths };

    if (!head.endsWith('/') || (tail.length > 0 && !tail.startsWith('/'))) {
      return this.handleInternalGlob(params);
    }
    if (glob === '**') {
      return this.handleDouble(params);
    }
    return this.handleSingle(params);
  }

  /**
   * Handles the case of having a `*` or `**` next to non-`/` characters.
   * E.g., `/foo/*.js`.
   * `**` is treated identical as `*` in this case.
   */
  protected async handleInternalGlob({ glob, head, tail, childPaths }: GlobParameters):
  Promise<ResourceIdentifier[]> {
    const parts = tail.split('/');
    const subTail = parts[0].slice(glob.length) + (parts.length > 1 ? '/' : '');
    // In case there are still characters remaining, we should only find the containers and append them
    const rest = parts.slice(1).join('/');
    // If a filter handles only (e.g.) **/*.nq and our child paths are URLs (without extension)
    // we need to find the contentType of the path, map it to extensions using customTypes
    // and if we get a match run selector again
    const expectedContentType = this.customTypes[subTail];

    this.logger.debug(`Recursively handling all paths starting with "${head}" and ending with "${subTail}"`);
    return this.handleChildren(childPaths.filter((child): boolean => child.startsWith(head)), async(child) => {
      if (child.endsWith(subTail)) {
        return this.handleSelector(`${child}${rest}`);
      }
      if (!expectedContentType) {
        return [];
      }
      const link = await this.mapper.mapUrlToFilePath({ path: child }, false);
      return link.contentType === expectedContentType ? this.handleSelector(`${child}${rest}`) : [];
    });
  }

  /**
   * Handles the case of having a `**` in the path.
   */
  protected async handleDouble({ head, tail, childPaths }: GlobParameters): Promise<ResourceIdentifier[]> {
    const [ withoutGlob, children ] = await Promise.all([
      // Just removing the `**`
      this.handleSelector(`${head}${tail.slice(1)}`),
      this.handleChildren(childPaths, async(child) => {
        if (isContainerPath(child)) {
          this.logger.debug(`Recursively handling all paths matching ${child}**${tail}`);
          return this.handleSelector(`${child}**${tail}`);
        }
        // Only yielding documents here as the containers will be yielded in the recursive call above
        return tail.length === 0 ? this.handleSelector(child) : [];
      }),
    ]);
    return [ ...withoutGlob, ...children ];
  }

  /**
   * Handles the case of having a `*` in the path.
   */
  protected async handleSingle({ tail, childPaths }: GlobParameters): Promise<ResourceIdentifier[]> {
    return this.handleChildren(childPaths, async(child) => {
      if (isContainerPath(child) && tail.length > 0) {
        this.logger.debug(`Recursively handling all paths matching ${child}${tail.slice(1)}`);
        return this.handleSelector(`${child}${tail.slice(1)}`);
      }
      return tail.length === 0 ? this.handleSelector(child) : [];
    });
  }

  /**
   * Handles every child at once, keeping the results in the order of the children.
   */
  protected async handleChildren(
    childPaths: string[],
    handleChild: (child: string) => Promise<ResourceIdentifier[]>,
  ): Promise<ResourceIdentifier[]> {
    return (await Promise.all(childPaths.map(handleChild))).flat();
  }
}
