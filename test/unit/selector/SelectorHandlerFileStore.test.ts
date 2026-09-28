import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { FileIdentifierMapper, ResourceIdentifier, ResourceStore } from '@solid/community-server';
import { BasicRepresentation, INTERNAL_QUADS } from '@solid/community-server';
import { DataFactory } from 'n3';
import type { DerivationConfig } from '../../../src/DerivationConfig';
import { SelectorStorePool } from '../../../src/SelectorStorePool';
import { SelectorHandlerFileStore } from '../../../src/selector/SelectorHandlerFileStore';
import { isStoreRepresentation } from '../../../src/selector/StoreRepresentation';
import type { SelectorParser } from '../../../src/selector/SelectorParser';

const { quad, namedNode, literal } = DataFactory;

describe('SelectorHandlerFileStore', (): void => {
  const base = 'http://example.com/pod/';
  let root: string;
  let store: jest.Mocked<ResourceStore>;
  let parser: jest.Mocked<SelectorParser>;
  let mapper: jest.Mocked<FileIdentifierMapper>;
  let handler: SelectorHandlerFileStore;

  function config(...selectors: string[]): DerivationConfig {
    return {
      identifier: { path: 'http://example.com/derived' },
      selectors,
      filter: 'http://example.com/filter',
      mappings: {},
      metadata: {} as any,
    };
  }

  function nq(subject: string): string {
    return `<http://example.com/${subject}> <http://example.com/p> "o" .\n`;
  }

  beforeEach(async(): Promise<void> => {
    root = mkdtempSync(join(tmpdir(), 'selector-file-store-'));
    mkdirSync(join(root, 'posts', 'deep'), { recursive: true });
    mkdirSync(join(root, 'filters'));
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, 'card$.nq'), nq('card'));
    writeFileSync(join(root, 'posts', 'a.nq'), nq('a'));
    writeFileSync(join(root, 'posts', 'deep', 'b.nq'), nq('b'));
    writeFileSync(join(root, 'filters', 'f.rq'), 'SELECT * WHERE { ?s ?p ?o }');
    writeFileSync(join(root, '.meta'), nq('meta'));
    writeFileSync(join(root, '.hidden', 'c.nq'), nq('hidden'));
    utimesSync(join(root, 'posts', 'a.nq'), new Date('2024-01-01'), new Date('2024-01-01'));
    utimesSync(join(root, 'posts', 'deep', 'b.nq'), new Date('2024-06-01'), new Date('2024-06-01'));
    utimesSync(join(root, 'card$.nq'), new Date('2023-01-01'), new Date('2023-01-01'));

    store = {
      getRepresentation: jest.fn(async(identifier: ResourceIdentifier): Promise<any> =>
        new BasicRepresentation(Readable.from([
          quad(namedNode(identifier.path), namedNode('http://example.com/p'), literal('fallback')),
        ]), identifier, INTERNAL_QUADS)),
    } satisfies Partial<ResourceStore> as any;
    parser = {
      canHandle: jest.fn(),
      handle: jest.fn().mockResolvedValue([{ path: `${base}doc` }]),
      handleSafe: jest.fn(),
    };
    mapper = {
      mapUrlToFilePath: jest.fn(async({ path }: ResourceIdentifier): Promise<any> => {
        if (!path.startsWith(base)) {
          throw new Error('not in this storage');
        }
        return { identifier: { path }, filePath: join(root, path.slice(base.length)), isMetadata: false };
      }),
      mapFilePathToUrl: jest.fn(),
    } satisfies Partial<FileIdentifierMapper> as any;
    handler = new SelectorHandlerFileStore(parser, store, new SelectorStorePool(), mapper);
  });

  afterEach((): void => {
    rmSync(root, { recursive: true, force: true });
  });

  function subjects(representation: any): string[] {
    return representation.store.getSubjects(null, null, null).map((term: any) => term.value).sort();
  }

  it('reads every file a ** selector matches, below any depth, from disk.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}**/*.nq`));
    expect(isStoreRepresentation(representation)).toBe(true);
    expect(subjects(representation)).toEqual([
      'http://example.com/a',
      'http://example.com/b',
      'http://example.com/card',
    ]);
    expect(store.getRepresentation).not.toHaveBeenCalled();
  });

  it('does not select dot files or the directories below dot directories.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}**/*.nq`));
    expect(subjects(representation)).not.toContain('http://example.com/meta');
    expect(subjects(representation)).not.toContain('http://example.com/hidden');
  });

  it('keeps * within a single directory.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}posts/*.nq`));
    expect(subjects(representation)).toEqual([ 'http://example.com/a' ]);
  });

  it('reads a file selected by two selectors once.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}**/*.nq`, `${base}posts/**/*.nq`));
    expect(representation).toBeDefined();
    expect((representation as any).store.size).toBe(3);
  });

  it('dates the store by the most recently modified input.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}**/*.nq`));
    expect(representation.metadata.get(namedNode('http://purl.org/dc/terms/modified'))?.value)
      .toBe(new Date('2024-06-01').toISOString());
  });

  it('selects nothing from a container that does not exist.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}missing/**/*.nq`));
    expect((representation as any).store.size).toBe(0);
  });

  it('falls back to the resource store for a selector without a glob.', async(): Promise<void> => {
    const [ representation ] = await handler.handle(config(`${base}doc`));
    expect(subjects(representation)).toEqual([ `${base}doc` ]);
    expect(store.getRepresentation).toHaveBeenCalledTimes(1);
  });

  it('falls back to the resource store when an input is not in a format it parses.', async(): Promise<void> => {
    await handler.handle(config(`${base}**/*`));
    expect(store.getRepresentation).toHaveBeenCalledTimes(1);
  });

  it('falls back to the resource store for a selector outside the file storage.', async(): Promise<void> => {
    await handler.handle(config('http://other.example/**/*.nq'));
    expect(store.getRepresentation).toHaveBeenCalledTimes(1);
  });
});
