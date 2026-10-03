// Citation verification.
//
// A language model will happily "quote" text that is not in the source. We do not
// take its word for it: every quote is checked against the chunk it claims to come
// from, after normalising whitespace, case and typographic quotes. A citation whose
// quote is not found is kept but flagged `verified: false`, so the reviewer sees
// exactly which claims still need a human eye.

import type { RawCitation } from "@/lib/ai/provider";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  /** Section path the passage sits in, if the document has headings. */
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  /**
   * Overall relevance, 0–1: the fused rank of the meaning-based and keyword
   * rankings (1 = ranked first by both). For overview passages, 1.
   */
  score: number;
  /** Cosine similarity between the question's and the passage's embeddings. */
  vectorScore: number;
  /** Share of the question's (IDF-weighted) keywords the passage contains, 0–1. */
  keywordScore: number;
};

export type ResolvedCitation = {
  order: number;
  /** 1-based source number as shown to the model and in [n] markers. */
  source: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  quote: string;
  verified: boolean;
};

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyQuote(quote: string, content: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 3) return false;
  return normalizeForMatch(content).includes(q);
}

/**
 * Maps the model's raw citations onto the chunks we actually showed it. Citations
 * pointing at a source number we never sent are dropped; duplicates collapse.
 */
export function resolveCitations(
  raw: RawCitation[],
  sources: RetrievedChunk[],
): ResolvedCitation[] {
  const seen = new Set<string>();
  const resolved: ResolvedCitation[] = [];

  for (const citation of raw) {
    const chunk = sources[citation.source - 1];
    if (!chunk || !Number.isInteger(citation.source) || citation.source < 1) continue;

    const quote = citation.quote.trim();
    const key = `${citation.source}|${normalizeForMatch(quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    resolved.push({
      order: resolved.length,
      source: citation.source,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      quote,
      verified: verifyQuote(quote, chunk.content),
    });
  }
  return resolved;
}

/** Source numbers referenced by [n] markers in the answer text, e.g. "… [1][3]." */
export function citedSourceNumbers(answer: string): number[] {
  const numbers = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,3})\]/g)) numbers.add(Number(match[1]));
  return [...numbers].sort((a, b) => a - b);
}
