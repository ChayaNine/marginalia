// Which sentences best represent a body of text?
//
// Classic extractive summarisation, small enough to read in one sitting:
//   1. Represent each sentence as a TF-IDF vector over stemmed words.
//   2. Score it by cosine similarity to the centroid (the "average" sentence) —
//      sentences about what the whole text is about score high.
//   3. Multiply in caller-supplied bonuses (e.g. "this sentence is in the
//      conclusion", "it says 'we propose'").
//   4. Pick greedily with Maximal Marginal Relevance, so the second pick is not a
//      paraphrase of the first.
//
// Used for document summaries at upload time and by the offline model to answer
// "give me an overview" questions without an LLM.

import { tokenize } from "./tokenize";

export type SalienceInput = { text: string; bonus?: number };

type SparseVector = Map<string, number>;

function cosine(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Returns the indices of up to `k` salient, mutually different sentences, in
 * their original order.
 */
export function pickSalient(sentences: SalienceInput[], k: number, lambda = 0.7): number[] {
  if (k <= 0 || sentences.length === 0) return [];
  const tokens = sentences.map((s) => tokenize(s.text));
  const df = new Map<string, number>();
  for (const t of tokens) for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
  const n = sentences.length;

  const vectors: SparseVector[] = tokens.map((t) => {
    const v: SparseVector = new Map();
    for (const term of t) v.set(term, (v.get(term) ?? 0) + 1);
    for (const [term, tf] of v) v.set(term, tf * Math.log(1 + n / (df.get(term) ?? 1)));
    return v;
  });

  const centroid: SparseVector = new Map();
  for (const v of vectors)
    for (const [term, w] of v) centroid.set(term, (centroid.get(term) ?? 0) + w);

  const relevance = vectors.map((v, i) => cosine(v, centroid) * (sentences[i].bonus ?? 1));
  const chosen: number[] = [];
  const candidates = new Set(sentences.map((_, i) => i).filter((i) => tokens[i].length > 0));

  while (chosen.length < k && candidates.size > 0) {
    let best = -1;
    let bestScore = -Infinity;
    for (const i of candidates) {
      const redundancy = chosen.length
        ? Math.max(...chosen.map((j) => cosine(vectors[i], vectors[j])))
        : 0;
      const score = lambda * relevance[i] - (1 - lambda) * redundancy;
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    if (best < 0) break;
    chosen.push(best);
    candidates.delete(best);
  }
  return chosen.sort((a, b) => a - b);
}

/** Phrases that mark a sentence as a statement of purpose, contribution or finding. */
export const CUE_PHRASES =
  /\b(we (present|propose|introduce|show|find|found|observe|observed|provide|demonstrate|describe)|our (results|findings|analysis|evaluation|dataset|method|approach)|in (summary|conclusion)|key findings?|main contributions?|this (paper|work|study|dataset|report|document|handbook)|the (aim|goal|purpose|objective) of)\b/i;

export const SUMMARY_SECTIONS =
  /\b(abstract|introduction|overview|summary|conclusions?|discussion|results|findings|contributions?)\b/i;
