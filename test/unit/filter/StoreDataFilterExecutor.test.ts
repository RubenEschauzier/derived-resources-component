import {
  BasicRepresentation,
  INTERNAL_QUADS,
  NotImplementedHttpError,
  RepresentationMetadata,
} from '@solid/community-server';
import { DataFactory, Store } from 'n3';
import type { FilterExecutorInput } from '../../../src/filter/FilterExecutor';
import type { N3FilterExecutor } from '../../../src/filter/N3FilterExecutor';
import { createStoreRepresentation } from '../../../src/selector/StoreRepresentation';
import { StoreDataFilterExecutor } from '../../../src/filter/StoreDataFilterExecutor';
import { DERIVED_TYPES } from '../../../src/Vocabularies';

describe('StoreDataFilterExecutor', (): void => {
  const representation = 'representation';
  const quad1 = DataFactory.quad(
    DataFactory.namedNode('s1'),
    DataFactory.namedNode('p1'),
    DataFactory.namedNode('o1'),
  );
  const quad2 = DataFactory.quad(
    DataFactory.namedNode('s2'),
    DataFactory.namedNode('p2'),
    DataFactory.namedNode('o2'),
  );
  let input: FilterExecutorInput;
  let source: jest.Mocked<N3FilterExecutor>;
  let executor: StoreDataFilterExecutor;

  beforeEach(async(): Promise<void> => {
    input = {
      filter: {
        data: 'data',
        type: DERIVED_TYPES.terms.String,
        metadata: new RepresentationMetadata(),
      },
      config: {
        mappings: {},
        selectors: [],
        filter: 'filter',
        identifier: { path: 'path' },
        metadata: new RepresentationMetadata(),
      },
      representations: [
        new BasicRepresentation([ quad1 ], INTERNAL_QUADS),
        new BasicRepresentation([ quad2 ], INTERNAL_QUADS),
      ],
    };

    source = {
      canHandle: jest.fn(),
      handle: jest.fn().mockResolvedValue(representation),
    } satisfies Partial<N3FilterExecutor> as any;

    executor = new StoreDataFilterExecutor(source);
  });

  it('rejects non-RDF representations.', async(): Promise<void> => {
    input.representations.push(new BasicRepresentation('', 'text/plain'));
    await expect(executor.canHandle(input)).rejects.toThrow(NotImplementedHttpError);
  });

  it('can handle input if its source can handle it.', async(): Promise<void> => {
    await expect(executor.canHandle(input)).resolves.toBeUndefined();
    expect(source.canHandle).toHaveBeenLastCalledWith({ ...input, getData: expect.any(Function), hdtPath: undefined });
    await expect(source.canHandle.mock.calls[0][0].getData()).resolves.toEqual(new Store());

    const error = new Error('bad data');
    source.canHandle.mockRejectedValueOnce(error);
    await expect(executor.canHandle(input)).rejects.toThrow(error);
  });

  it('passes a store with the streamed quads to the source.', async(): Promise<void> => {
    await expect(executor.handle(input)).resolves.toBe(representation);
    expect(source.handle).toHaveBeenLastCalledWith({ ...input, getData: expect.any(Function) });
    await expect(source.handle.mock.calls[0][0].getData()).resolves.toEqual(new Store([ quad1, quad2 ]));
  });

  it('passes a single store on without building it, along with the HDT file of its data.', async(): Promise<void> => {
    const build = jest.fn(async(): Promise<Store> => new Store([ quad1 ]));
    const identifier = { path: 'http://example.com/d' };
    input.representations = [ createStoreRepresentation(build, identifier, new Date(), '/pod/.index.hdt') ];

    await expect(executor.canHandle(input)).resolves.toBeUndefined();
    expect(source.canHandle.mock.calls[0][0].hdtPath).toBe('/pod/.index.hdt');
    await expect(executor.handle(input)).resolves.toBe(representation);
    expect(source.handle.mock.calls[0][0].hdtPath).toBe('/pod/.index.hdt');
    expect(build).not.toHaveBeenCalled();
    await expect(source.handle.mock.calls[0][0].getData()).resolves.toEqual(new Store([ quad1 ]));
  });
});
