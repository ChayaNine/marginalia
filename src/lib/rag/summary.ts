// A document's overview, computed once at upload with no model call:
//
//   abstract  – the document's own abstract, when it has one
//   keyPoints – the most representative sentences (see lib/text/salience.ts),
//               each linked to the chunk and page it comes from
//   outline   – the section headings, with pages
//
// Shown on the document page, and used to answer "what is this about?" questions
// in offline mode. With a real model the same chunks feed an LLM-written overview.

import type { Block } from "@/lib/text/doc-model";
import { CUE_PHRASES, SUMMARY_SECTIONS, pickSalient } from "@/lib/text/salience";
import { splitSentences, wordCount } from "@/lib/text/sentences";
import type { Chunk } from "./chunk";

export type KeyPoint = { text: string; chunkIndex: number | null; page: number | null };
export type OutlineEntry = {
  heading: string;
  level: number;
  page: number | null;
  chunkIndex: number | null;
};
export type DocumentSummary = {
  abstract: string | null;
  keyPoints: KeyPoint[];
  outline: OutlineEntry[];
};

const BACK_MATTER = /^(references|bibliography|works cited|acknowledge?ments?|appendix)/i;
const MAX_ABSTRACT_CHARS = 1800;

function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function findChunk(text: string, chunks: Chunk[]): Chunk | undefined {
  const needle = squash(text).slice(0, 120);
  return chunks.find((c) => squash(c.content).includes(needle));
}

export function summarizeDocument(
  blocks: Block[],
  chunks: Chunk[],
  maxKeyPoints = 5,
): DocumentSummary {
  // Abstract: the paragraphs under an "Abstract" heading.
  let abstract: string | null = null;
  const abstractAt = blocks.findIndex(
    (b) => b.kind === "heading" && /^(abstract|summary)$/i.test(b.text.trim()),
  );
  if (abstractAt >= 0) {
    const parts: string[] = [];
    for (let i = abstractAt + 1; i < blocks.length && blocks[i].kind !== "heading"; i++) {
      if (blocks[i].kind === "paragraph") parts.push(blocks[i].text);
    }
    abstract = parts.join("\n\n").slice(0, MAX_ABSTRACT_CHARS) || null;
  }

  // Outline: section headings (two levels deep).
  const outline: OutlineEntry[] = blocks
    .filter((b) => b.kind === "heading" && (b.level ?? 2) <= 2)
    .slice(0, 60)
    .map((b) => {
      const chunk = chunks.find(
        (c) => c.heading?.split(" › ").includes(b.text) || c.content.includes(b.text),
      );
      return {
        heading: b.text,
        level: b.level ?? 2,
        page: b.page ?? null,
        chunkIndex: chunk?.index ?? null,
      };
    });

  // Key points: salient sentences from the body, excluding the abstract (shown
  // separately) and back matter.
  const candidates: { text: string; bonus: number; page: number | null }[] = [];
  let section = "";
  let inBackMatter = false;
  let inAbstract = false;
  for (const b of blocks) {
    if (b.kind === "heading") {
      section = b.text;
      inBackMatter = BACK_MATTER.test(b.text.trim());
      inAbstract = /^(abstract|summary)$/i.test(b.text.trim());
      continue;
    }
    if (b.kind !== "paragraph" || inBackMatter || (inAbstract && abstract)) continue;
    splitSentences(b.text).forEach((sentence, i) => {
      // "(iii) Based on…" → "Based on…"; the rest is still a verbatim substring.
      const s = sentence.replace(/^\(?([ivx]{1,4}|\d{1,2}|[a-h])\)\s+/i, "");
      const words = wordCount(s);
      if (words < 8 || words > 45 || /https?:\/\/|^\[\d+\]/.test(s)) return;
      let bonus = 1;
      if (SUMMARY_SECTIONS.test(section)) bonus *= 1.2;
      if (CUE_PHRASES.test(s)) bonus *= 1.25;
      if (i === 0) bonus *= 1.05;
      candidates.push({ text: s, bonus, page: b.page ?? null });
    });
  }
  const picked = pickSalient(candidates, maxKeyPoints);
  const keyPoints: KeyPoint[] = picked.map((i) => {
    const c = candidates[i];
    const chunk = findChunk(c.text, chunks);
    return { text: c.text, chunkIndex: chunk?.index ?? null, page: c.page };
  });

  return { abstract, keyPoints, outline };
}

export function parseSummary(json: string | null | undefined): DocumentSummary | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as DocumentSummary;
    return Array.isArray(value.keyPoints) && Array.isArray(value.outline) ? value : null;
  } catch {
    return null;
  }
}
