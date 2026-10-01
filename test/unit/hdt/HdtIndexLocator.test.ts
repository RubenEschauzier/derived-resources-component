import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileIdentifierMapper, ResourceIdentifier } from '@solid/community-server';
import { HdtIndexLocator } from '../../../src/hdt/HdtIndexLocator';

describe('An HdtIndexLocator', (): void => {
  const base = 'http://example.com/pods/';
  let root: string;
  let mapper: jest.Mocked<FileIdentifierMapper>;
  let locator: HdtIndexLocator;

  beforeEach(async(): Promise<void> => {
    root = mkdtempSync(join(tmpdir(), 'hdt-index-locator-'));
    mkdirSync(join(root, 'alice'));
    mkdirSync(join(root, 'bob'));
    writeFileSync(join(root, 'alice', '.index.hdt'), '');
    utimesSync(join(root, 'alice', '.index.hdt'), new Date('2024-06-01'), new Date('2024-06-01'));

    mapper = {
      mapUrlToFilePath: jest.fn(async({ path }: ResourceIdentifier): Promise<any> => {
        if (!path.startsWith(base)) {
          throw new Error('not in this storage');
        }
        return { identifier: { path }, filePath: join(root, path.slice(base.length)), isMetadata: false };
      }),
      mapFilePathToUrl: jest.fn(),
    } satisfies Partial<FileIdentifierMapper> as any;
    locator = new HdtIndexLocator(mapper);
  });

  afterEach((): void => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the index of a directory whose every document is selected.', async(): Promise<void> => {
    await expect(locator.locate([ `${base}alice/**/*.nq`, `${base}alice/**/*.ttl` ])).resolves.toEqual({
      path: join(root, 'alice', '.index.hdt'),
      modified: new Date('2024-06-01'),
    });
  });

  it('finds nothing for a directory without an index.', async(): Promise<void> => {
    await expect(locator.locate([ `${base}bob/**/*.nq` ])).resolves.toBeUndefined();
  });

  it('finds nothing for selectors selecting only part of a directory.', async(): Promise<void> => {
    await expect(locator.locate([ `${base}alice/posts/*.nq` ])).resolves.toBeUndefined();
    await expect(locator.locate([ `${base}alice/**/*.nq`, `${base}alice/profile/card` ])).resolves.toBeUndefined();
  });

  it('finds nothing for selectors of several directories.', async(): Promise<void> => {
    await expect(locator.locate([ `${base}alice/**/*.nq`, `${base}bob/**/*.nq` ])).resolves.toBeUndefined();
  });

  it('finds nothing for a directory outside the file storage.', async(): Promise<void> => {
    await expect(locator.locate([ 'http://other.example/**/*.nq' ])).resolves.toBeUndefined();
  });

  it('uses the configured index name.', async(): Promise<void> => {
    writeFileSync(join(root, 'bob', 'pod.hdt'), '');
    locator = new HdtIndexLocator(mapper, 'pod.hdt');
    await expect(locator.locate([ `${base}bob/**/*.nq` ])).resolves
      .toMatchObject({ path: join(root, 'bob', 'pod.hdt') });
  });
});
