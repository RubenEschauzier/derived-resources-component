import { RepresentationMetadata } from '@solid/community-server';
import { Store } from 'n3';

/**
 * Compares stores and representation metadata by the quads they hold. An N3 store keeps functions bound
 * to itself, which no two stores share, so stores holding the same quads would otherwise never be equal.
 */
function equalQuads(left: unknown, right: unknown): boolean | undefined {
  if (left instanceof RepresentationMetadata && right instanceof RepresentationMetadata) {
    return left.identifier.equals(right.identifier) &&
      equalStores(new Store(left.quads()), new Store(right.quads()));
  }
  if (left instanceof Store && right instanceof Store) {
    return equalStores(left, right);
  }
}

function equalStores(left: Store, right: Store): boolean {
  return left.size === right.size && left.getQuads(null, null, null, null).every((quad): boolean => right.has(quad));
}

// Jest 29.4 added equality testers, but the jest typings in use do not declare them yet
(expect as unknown as { addEqualityTesters: (testers: typeof equalQuads[]) => void })
  .addEqualityTesters([ equalQuads ]);
