import { MultipleFixedContentTypeMapper } from '../../../src/storage/MultipleFixedContentTypeMapper';

describe('A MultipleFixedContentTypeMapper', (): void => {
  const base = 'http://example.com/';
  const rootFilepath = '/data/';
  let mapper: MultipleFixedContentTypeMapper;

  beforeEach(async(): Promise<void> => {
    mapper = new MultipleFixedContentTypeMapper(base, rootFilepath);
  });

  it('maps known documents to their URL without extension.', async(): Promise<void> => {
    await expect(mapper.mapFilePathToUrl('/data/pod/posts.nq', false)).resolves.toMatchObject({
      identifier: { path: 'http://example.com/pod/posts' },
      contentType: 'application/n-quads',
      isMetadata: false,
    });
  });

  it('still treats metadata files as metadata.', async(): Promise<void> => {
    await expect(mapper.mapFilePathToUrl('/data/pod/.meta', false)).resolves.toMatchObject({
      isMetadata: true,
    });
  });

  it('treats HDT indexes and their own indexes as metadata, so they are not listed.', async(): Promise<void> => {
    for (const file of [ '/data/pod/.index.hdt', '/data/pod/.index.hdt.index.v1-1' ]) {
      await expect(mapper.mapFilePathToUrl(file, false)).resolves.toMatchObject({ isMetadata: true });
    }
  });

  it('does not map other unknown files.', async(): Promise<void> => {
    await expect(mapper.mapFilePathToUrl('/data/pod/archive.zip', false))
      .rejects.toThrow('not part of the file storage');
  });
});
