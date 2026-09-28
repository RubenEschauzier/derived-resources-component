import type { Representation, ResourceStore } from '@solid/community-server';
import { INTERNAL_QUADS } from '@solid/community-server';
import type { DerivationConfig } from '../DerivationConfig';
import { SelectorHandler } from './SelectorHandler';
import type { SelectorParser } from './SelectorParser';

/**
 * Determines all the input resources by calling a {@link SelectorParser}
 * and then acquires their representations through the {@link ResourceStore}.
 */
export class BaseSelectorHandler extends SelectorHandler {
  protected readonly parser: SelectorParser;
  protected readonly store: ResourceStore;

  public constructor(parser: SelectorParser, store: ResourceStore) {
    super();
    this.parser = parser;
    this.store = store;
  }

  public async canHandle(config: DerivationConfig): Promise<void> {
    return this.parser.canHandle(config);
  }

  /**
   * How many input representations are requested at once. They were requested one after the
   * other, which made reading the inputs of a derived resource cost the latency of every read.
   */
  protected readonly concurrency = 16;

  public async handle(config: DerivationConfig): Promise<Representation[]> {
    const representations: Representation[] = [];
    await this.forEachRepresentation(config, async(representation, index): Promise<void> => {
      representations[index] = representation;
    });
    return representations;
  }

  /**
   * Hands every input representation to the consumer, with a bounded number read at once. The next
   * representation is only requested once the consumer is done with the previous one, so consumers
   * that drain the data bound the number of inputs open at the same time.
   */
  protected async forEachRepresentation(
    config: DerivationConfig,
    consume: (representation: Representation, index: number) => Promise<void>,
  ): Promise<void> {
    const identifiers = await this.parser.handle(config);
    let next = 0;
    const read = async(): Promise<void> => {
      while (next < identifiers.length) {
        const index = next++;
        const representation = await this.store.getRepresentation(
          identifiers[index],
          { type: { [INTERNAL_QUADS]: 1 }},
        );
        await consume(representation, index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, identifiers.length) }, read));
  }
}
