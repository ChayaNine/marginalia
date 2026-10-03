// Keyword retrieval (BM25) and rank fusion.
//
// Why keywords as well as embeddings? Embeddings capture meaning ("how much does
// it cost" ≈ "the fee is"), but they are weak at exact tokens: model numbers
// ("Mid-360"), acronyms ("GICP"), names, figures. BM25 is the opposite. Running
// both and fusing the rankings ("hybrid search") beats either alone — on the
// evaluation set in eval/, noticeably so for technical PDFs.
//
// BM25 in one paragraph: a chunk scores for each query term it contains, weighted
// by how rare the term is across all chunks (IDF), with diminishing returns for
// repeats (k1) and a penalty for long chunks (b).
//
// Reciprocal Rank Fusion: each list contributes 1 / (60 + rank) for each item.
// It only uses ranks, so the two very different score scales never need
// calibrating against each other.

export type Bm25Options = { k1?: number; b?: number };

export type KeywordScore = {
  /** Raw BM25 score (unbounded, comparable only within one query). */
  bm25: number;
  /** Share of the query's IDF weight this chunk covers, 0–1. */
  coverage: number;
};

/**
 * Scores every document (a token list) against the query tokens. Query tokens are
 * de-duplicated; a term that appears in no document contributes nothing.
 */
export function bm25Scores(
  queryTokens: readonly string[],
  documents: readonly (readonly string[])[],
  options: Bm25Options = {},
): KeywordScore[] {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const n = documents.length;
  if (n === 0) return [];

  const terms = [...new Set(queryTokens)];
  const termFrequencies = documents.map((tokens) => {
    const tf = new Map<string, number>();
    for (const token of tokens) if (terms.includes(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
    return tf;
  });

  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = termFrequencies.reduce((count, tf) => count + (tf.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  const totalIdf = terms.reduce((sum, t) => sum + (idf.get(t) ?? 0), 0);
  const avgLength = documents.reduce((sum, d) => sum + d.length, 0) / n || 1;

  return documents.map((tokens, i) => {
    const tf = termFrequencies[i];
    let bm25 = 0;
    let covered = 0;
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const w = idf.get(term) ?? 0;
      bm25 += (w * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * tokens.length) / avgLength));
      covered += w;
    }
    return { bm25, coverage: totalIdf > 0 ? covered / totalIdf : 0 };
  });
}

export const RRF_K = 60;

/**
 * Fuses several rankings (arrays of ids, best first) into one score per id.
 * The result is normalised so an item ranked first in every list scores 1.
 */
export function reciprocalRankFusion(
  rankings: readonly (readonly string[])[],
  k = RRF_K,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  const best = rankings.length / (k + 1);
  for (const [id, score] of fused) fused.set(id, score / best);
  return fused;
}
