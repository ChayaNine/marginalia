// Chunking: structured blocks → retrieval passages.
//
// Embedding models and chat models both work best on passages of a few hundred
// tokens, so every document is cut into chunks. How you cut decides what can be
// found: a chunk that starts mid-sentence or mixes two sections retrieves badly
// and reads badly as a citation.
//
// Rules, in priority order:
//   1. A new section (heading) starts a new chunk — unless the current chunk is
//      still tiny, in which case the small section is folded in, heading and all.
//   2. Chunks only ever break between whole sentences (table rows count as
//      sentences). A single sentence longer than the limit is split by words.
//   3. Consecutive chunks in the same section overlap by one sentence, so a
//      statement that depends on the previous sentence keeps its context.
//   4. Every chunk records its section heading path ("III. System Overview ›
//      C. Sensor Calibration") and page range, for retrieval and for citations.
//      When a chunk spans a section boundary (a small section folded in), it is
//      labelled with the section most of its text belongs to.
//
// Sizes are in characters, not tokens: for English prose 1 token ≈ 4 characters,
// which is close enough for sizing and keeps this module dependency-free.

import type { Block } from "@/lib/text/doc-model";
import { splitSentences } from "@/lib/text/sentences";
import { textToBlocks } from "@/lib/text/structure";

export type Chunk = {
  /** 0-based position within the document. */
  index: number;
  content: string;
  /** Section path the chunk belongs to, outermost first, or null before any heading. */
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
};

export type ChunkOptions = {
  /** Upper bound on chunk length, in characters. */
  maxChars?: number;
  /** A chunk shorter than this absorbs the next small section instead of closing. */
  minChars?: number;
  /** Sentences repeated at the start of the next chunk in the same section. */
  overlapSentences?: number;
};

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxChars: 1200, // ≈ 300 tokens
  minChars: 350,
  overlapSentences: 1,
};

const BACK_MATTER =
  /^([\dIVX]+\.?\s+)?(references|bibliography|works cited|acknowledge?ments?|appendix)\b/i;

/** Longest sentence that may be repeated as overlap. */
const MAX_OVERLAP_CHARS = 320;

type Piece = {
  text: string;
  /** Starts a new paragraph (joined with a blank line rather than a space). */
  paragraphStart: boolean;
  /** Starts a new line within a block (table rows). */
  lineStart?: boolean;
  page?: number;
  pageEnd?: number;
  /** A heading folded into a chunk; never used as overlap. */
  isHeading?: boolean;
  /** Section path this piece belongs to. */
  path: string | null;
};

export function chunkBlocks(blocks: Block[], options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_OPTIONS.maxChars;
  const minChars = options.minChars ?? DEFAULT_CHUNK_OPTIONS.minChars;
  const overlapSentences = options.overlapSentences ?? DEFAULT_CHUNK_OPTIONS.overlapSentences;
  if (!Number.isInteger(maxChars) || maxChars < 40)
    throw new Error("maxChars must be an integer >= 40");
  if (minChars < 0 || minChars >= maxChars)
    throw new Error("minChars must be >= 0 and below maxChars");
  if (overlapSentences < 0) throw new Error("overlapSentences must be >= 0");

  const chunks: Chunk[] = [];
  const path: string[] = []; // heading path by level
  let pieces: Piece[] = [];
  /** How many leading pieces of the open chunk are overlap carried from the last one. */
  let carried = 0;

  const currentPath = () =>
    path.filter(Boolean).length ? path.filter(Boolean).slice(-2).join(" › ") : null;
  const length = () => render(pieces).length;

  const flush = (carryOverlap: boolean) => {
    if (pieces.length === 0) return;
    const content = render(pieces);
    const pages = pieces
      .flatMap((p) => [p.page, p.pageEnd])
      .filter((n): n is number => typeof n === "number");
    chunks.push({
      index: chunks.length,
      content,
      heading: majorityPath(pieces),
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
    });
    const carry: Piece[] = [];
    if (carryOverlap && overlapSentences > 0) {
      for (let i = pieces.length - 1; i >= 0 && carry.length < overlapSentences; i--) {
        if (pieces[i].isHeading || pieces[i].text.length > MAX_OVERLAP_CHARS) break;
        carry.unshift({
          ...pieces[i],
          paragraphStart: carry.length === 0 ? true : pieces[i].paragraphStart,
        });
      }
    }
    pieces = carry;
    carried = carry.length;
  };

  const add = (piece: Piece) => {
    const separator = pieces.length === 0 ? 0 : piece.paragraphStart ? 2 : 1; // "\n\n", or " " / "\n"
    if (pieces.length > 0 && length() + separator + piece.text.length > maxChars) {
      flush(true);
      // A carried-over sentence alone may not leave room; drop it rather than overflow.
      if (pieces.length && length() + 2 + piece.text.length > maxChars) pieces = [];
      if (pieces.length === 0) carried = 0;
    }
    pieces.push(pieces.length === 0 ? { ...piece, paragraphStart: true } : piece);
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;

    if (block.kind === "heading") {
      const level = Math.max(1, Math.min(6, block.level ?? 2));
      // Overlap only makes sense inside a section: drop it at a section boundary.
      if (pieces.length === carried) {
        pieces = [];
        carried = 0;
      }
      // Small sections are folded into the next chunk, but the end of the body
      // never merges into the reference list or appendix.
      if (length() >= minChars || (pieces.length > 0 && BACK_MATTER.test(text))) flush(false);
      path.length = level - 1;
      path[level - 1] = text;
      if (pieces.length > 0) {
        pieces.push({
          text,
          paragraphStart: true,
          page: block.page,
          pageEnd: block.pageEnd,
          isHeading: true,
          path: currentPath(),
        });
      }
      continue;
    }

    const units =
      block.kind === "table"
        ? text
            .split("\n")
            .map((r) => r.trim())
            .filter(Boolean)
        : splitSentences(text);
    units.forEach((unit, i) => {
      const parts = unit.length > maxChars ? splitWords(unit, maxChars) : [unit];
      parts.forEach((part, j) => {
        add({
          text: part,
          // Table rows each start a line; prose sentences flow within a paragraph.
          paragraphStart: i === 0 && j === 0,
          lineStart: block.kind === "table" && j === 0,
          page: block.page,
          pageEnd: block.pageEnd,
          path: currentPath(),
        });
      });
    });
  }
  flush(false);
  return chunks;
}

/** Convenience for plain text (used by tests and by callers without structure). */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  return chunkBlocks(textToBlocks(text).blocks, options);
}

/** The section path that most of the chunk's text belongs to (earliest on a tie). */
function majorityPath(pieces: Piece[]): string | null {
  const chars = new Map<string | null, number>();
  for (const p of pieces) chars.set(p.path, (chars.get(p.path) ?? 0) + p.text.length);
  let best: string | null = null;
  let bestChars = -1;
  for (const [path, n] of chars) {
    if (n > bestChars) [best, bestChars] = [path, n];
  }
  return best;
}

function render(pieces: Piece[]): string {
  let out = "";
  pieces.forEach((p, i) => {
    if (i === 0) out = p.text;
    else out += (p.paragraphStart ? "\n\n" : p.lineStart ? "\n" : " ") + p.text;
  });
  return out;
}

function splitWords(sentence: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) pieces.push(buffer);
    buffer = "";
  };
  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    if (word.length > maxChars) {
      flush();
      for (let i = 0; i < word.length; i += maxChars) pieces.push(word.slice(i, i + maxChars));
      continue;
    }
    const candidate = buffer ? `${buffer} ${word}` : word;
    if (candidate.length > maxChars) {
      flush();
      buffer = word;
    } else buffer = candidate;
  }
  flush();
  return pieces;
}

/**
 * The text a chunk is embedded and keyword-indexed with: document title and
 * section path first, so "What does section C say about calibration?" and
 * passages that never repeat their section's name can still be found.
 */
export function contextualText(
  chunk: Pick<Chunk, "content" | "heading">,
  documentTitle?: string,
): string {
  const context = [documentTitle, chunk.heading].filter(Boolean).join(" — ");
  return context ? `${context}\n\n${chunk.content}` : chunk.content;
}
