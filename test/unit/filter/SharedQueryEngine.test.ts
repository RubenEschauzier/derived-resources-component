import { join } from 'node:path';
import { DataFactory, Store } from 'n3';
import { SharedQueryEngine } from '../../../src/filter/SharedQueryEngine';

const { namedNode, literal, quad } = DataFactory;

const FOAF = 'http://xmlns.com/foaf/0.1/';
// Holds names for alice, bob and a blank node, alice knows bob, and bob knows himself
const hdtPath = join(__dirname, '../../assets/hdt/.index.hdt');
const query = `SELECT ?name WHERE { <http://example.com/pod/alice> <${FOAF}knows> ?friend . ?friend <${FOAF}name> ?name }`;

describe('A SharedQueryEngine', (): void => {
  const { engine } = new SharedQueryEngine();

  async function names(source: any): Promise<(string | undefined)[]> {
    const bindings = await engine.queryBindings(query, { sources: [ source ]});
    return (await bindings.toArray()).map((binding): string | undefined => binding.get('name')?.value);
  }

  it('queries HDT files.', async(): Promise<void> => {
    await expect(names({ type: 'hdt', value: hdtPath })).resolves.toEqual([ 'Bob' ]);
  });

  it('queries stores.', async(): Promise<void> => {
    const store = new Store([
      quad(namedNode('http://example.com/pod/alice'), namedNode(`${FOAF}knows`), namedNode('http://example.com/pod/carol')),
      quad(namedNode('http://example.com/pod/carol'), namedNode(`${FOAF}name`), literal('Carol')),
    ]);
    await expect(names(store)).resolves.toEqual([ 'Carol' ]);
  });
});
