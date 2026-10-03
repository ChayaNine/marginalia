// Vector similarity.
//
// Retrieval ranks chunks by cosine similarity between the question's embedding and
// each chunk's embedding: 1 = same direction, 0 = unrelated, -1 = opposite.
// OpenAI embeddings are already unit-length, so cosine equals the dot product, but
// we compute the norms anyway so the code is correct for any provider.

export function dot(a: Float32Array, b: Float32Array): number {
  assertSameLength(a, b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function norm(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum);
}

/** Returns a new unit-length vector. A zero vector stays zero (no NaNs). */
export function normalize(a: Float32Array): Float32Array {
  const n = norm(a);
  const out = new Float32Array(a.length);
  if (n === 0) return out;
  for (let i = 0; i < a.length; i++) out[i] = a[i] / n;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  assertSameLength(a, b);
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return 0;
  // Clamp: floating point can nudge the result a hair outside [-1, 1].
  return Math.max(-1, Math.min(1, dot(a, b) / denominator));
}

export type Scored<T> = { item: T; score: number };

/**
 * Highest-scoring `k` items, best first. Ties keep their original order (stable),
 * which keeps results deterministic for tests and for the user.
 *
 * This sorts everything, which is O(n log n). For the few thousand chunks a
 * personal knowledge base holds this is instant; at hundreds of thousands you would
 * switch to a vector index (pgvector, sqlite-vec) — see NOTES.md.
 */
export function topK<T>(items: readonly T[], score: (item: T) => number, k: number): Scored<T>[] {
  if (k <= 0) return [];
  const scored = items.map((item, index) => ({ item, score: score(item), index }));
  scored.sort((x, y) => y.score - x.score || x.index - y.index);
  return scored.slice(0, k).map(({ item, score }) => ({ item, score }));
}

function assertSameLength(a: Float32Array, b: Float32Array): void {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}. ` +
        "Were these embedded with different models?",
    );
  }
}
