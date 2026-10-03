// Hybrid ranking: embeddings + keywords, fused. Pure (no database), so it is
// unit-tested directly; src/lib/rag/retrieve.ts feeds it rows from SQLite.

import { tokenize } from "@/lib/text/tokenize";
import { bm25Scores, reciprocalRankFusion } from "./bm25";
import type { RetrievedChunk } from "./citations";
import { cosineSimilarity } from "./similarity";

export type RankCandidate = Omit<RetrievedChunk, "score" | "vectorScore" | "keywordScore"> & {
  embedding: Float32Array;
  /** Keyword tokens of the chunk (title + heading + content); computed if absent. */
  tokens?: string[];
};

export type RankOptions = {
  k: number;
  /** How many of each ranking take part in the fusion. */
  depth?: number;
};

/** Reference lists match every keyword in the field and rarely answer anything. */
const REFERENCES_HEADING = /(^|› )([\dIVX]+\.?\s+)?(references|bibliography|works cited)$/i;
const ASKS_ABOUT_REFERENCES =
  /\b(references?|cit(e|es|ed|ation|ations)|bibliography|et al|prior work|related work)\b/i;
const REFERENCES_PENALTY = 0.5;

export function rankChunks(
  candidates: readonly RankCandidate[],
  queryVector: Float32Array,
  query: string,
  options: RankOptions,
): RetrievedChunk[] {
  const { k } = options;
  const depth = options.depth ?? 50;
  if (k <= 0 || candidates.length === 0) return [];

  const vectorScores = candidates.map((c) => cosineSimilarity(queryVector, c.embedding));
  const keyword = bm25Scores(
    tokenize(query),
    candidates.map((c) => c.tokens ?? tokenize(keywordText(c))),
  );

  const byVector = order(vectorScores).slice(0, depth);
  const byKeyword = order(keyword.map((s) => s.bm25))
    .filter((i) => keyword[i].bm25 > 0)
    .slice(0, depth);
  const fused = reciprocalRankFusion([byVector.map(String), byKeyword.map(String)]);

  const penalise = !ASKS_ABOUT_REFERENCES.test(query);
  const results = [...fused.entries()].map(([key, score]) => {
    const i = Number(key);
    const c = candidates[i];
    const isReferences = penalise && c.heading !== null && REFERENCES_HEADING.test(c.heading);
    const { embedding: _embedding, tokens: _tokens, ...chunk } = c;
    return {
      ...chunk,
      score: isReferences ? score * REFERENCES_PENALTY : score,
      vectorScore: vectorScores[i],
      keywordScore: keyword[i].coverage,
      position: i,
    };
  });

  results.sort(
    (a, b) => b.score - a.score || b.vectorScore - a.vectorScore || a.position - b.position,
  );
  return results.slice(0, k).map(({ position: _position, ...chunk }) => chunk);
}

/** The text a chunk is keyword-indexed by. Mirrors contextualText() in chunk.ts. */
export function keywordText(
  c: Pick<RankCandidate, "documentTitle" | "heading" | "content">,
): string {
  return [c.documentTitle, c.heading, c.content].filter(Boolean).join("\n");
}

/** Indices sorted by score, best first; ties keep their original order. */
function order(scores: number[]): number[] {
  return scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.i);
}
