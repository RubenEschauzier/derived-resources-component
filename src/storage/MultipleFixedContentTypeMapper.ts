import { promises as fsPromises } from 'node:fs';
import type {
  ResourceIdentifier,
  ResourceLink,
} from '@solid/community-server';
import {
  BaseFileIdentifierMapper,
  getExtension,
  NotFoundHttpError,
  TEXT_TURTLE,
} from '@solid/community-server';
import mime from 'mime';

/**
 * A hybrid mapper that performs sequential O(1) lookups for known extensions,
 * falling back to the standard ExtensionBasedMapper for everything else.
 */
export class MultipleFixedContentTypeMapper extends BaseFileIdentifierMapper {
  // Prioritized list of extensions to check for extensionless URLs
  private readonly fastExtensions = [ '.nq', '.rq', '.txt', '.ttl', '.jsonld' ];
  // Mapping extensions to types
  private readonly customTypes: Record<string, string> = {
    nq: 'application/n-quads',
    rq: 'application/sparql-query',
    txt: 'text/plain',
    ttl: 'text/turtle',
    jsonld: 'application/ld+json',
    meta: TEXT_TURTLE,
  };

  /**
   * @param base - The base URL.
   * @param rootFilepath - The root file path.
   * @param customTypes - Custom extension/content-type pairs. @range {json}
   */
  public constructor(
    base: string,
    rootFilepath: string,
    customTypes?: Record<string, string>,
  ) {
    super(base, rootFilepath);
    if (customTypes) {
      this.customTypes = customTypes;
    }
  }

  protected async getContentTypeFromPath(filePath: string): Promise<string> {
    const extension = getExtension(filePath).toLowerCase();
    if (this.customTypes[extension]) {
      return this.customTypes[extension];
    }
    const mimeType = mime.lookup(extension);
    if (mimeType) {
      return mimeType;
    }

    return super.getContentTypeFromPath(filePath);
  }

  protected async mapUrlToDocumentPath(
    identifier: ResourceIdentifier,
    filePath: string,
    contentType?: string,
  ): Promise<ResourceLink> {
    const extension = getExtension(filePath);

    if (!contentType && !extension && !filePath.endsWith('/')) {
      // The multiple checks loop
      for (const ext of this.fastExtensions) {
        const testPath = `${filePath}${ext}`;
        try {
          const stats = await fsPromises.stat(testPath);
          if (stats.isFile()) {
            // We use the parent class method so it automatically looks at the
            // customTypes JSON dictionary to figure out the correct Content-Type.
            const mappedContentType = await this.getContentTypeFromPath(testPath);
            return {
              identifier,
              filePath: testPath,
              contentType: mappedContentType,
              isMetadata: this.isMetadataPath(filePath),
            };
          }
        } catch {
          // File with this extension doesn't exist, instantly try the next one
        }
      }
    }
    return super.mapUrlToDocumentPath(identifier, filePath, contentType);
  }

  protected async getDocumentUrl(relative: string): Promise<string> {
    let path = relative;
    if (!this.isMetadataPath(path)) {
      let strippedPath = false;
      for (const pathSuffix of this.fastExtensions) {
        if (path.endsWith(pathSuffix)) {
          path = path.slice(0, -pathSuffix.length);
          strippedPath = true;
        }
      }
      if (!strippedPath) {
        throw new NotFoundHttpError(
          `File ${path} is not part of the file storage at ${this.rootFilepath}`,
        );
      }
    }
    return super.getDocumentUrl(path);
  }
}
