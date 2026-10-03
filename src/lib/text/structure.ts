// Structured extraction for the non-PDF formats: Markdown, plain text, CSV and
// Word (via the HTML mammoth produces). Each returns Blocks, so headings and tables
// survive into chunking exactly like they do for PDFs.

import { parseCsv } from "@/lib/csv";
import { stripMarkdown } from "@/lib/markdown";
import { formatTableRows, type Block, type ExtractedDocument } from "./doc-model";

/* ---------------------------------------------------------------- markdown */

export function markdownToBlocks(markdown: string): ExtractedDocument {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[] = [];

  const flushParagraph = () => {
    const text = stripMarkdown(paragraph.join("\n"))
      .replace(/\s*\n\s*/g, " ")
      .trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  const flushTable = () => {
    if (table.length) {
      const rows = table
        .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)) // the |---|---| separator row
        .map((l) =>
          l
            .replace(/^\s*\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((c) => stripMarkdown(c).trim()),
        );
      const text = formatTableRows(rows).join("\n");
      if (text) blocks.push({ kind: "table", text });
    }
    table = [];
  };

  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      paragraph.push(line);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const setext =
      i + 1 < lines.length &&
      line.trim() &&
      /^\s*(=+|-{3,})\s*$/.test(lines[i + 1]) &&
      paragraph.length === 0;
    if (heading || setext) {
      flushParagraph();
      flushTable();
      const text = stripMarkdown(heading ? heading[2] : line).trim();
      const level = heading ? heading[1].length : lines[i + 1].trim().startsWith("=") ? 1 : 2;
      if (text) blocks.push({ kind: "heading", text, level });
      if (setext) i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      table.push(line);
      continue;
    }
    flushTable();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    // Each list item is its own paragraph, so items are never glued together.
    if (/^\s*([-*+]|\d{1,3}[.)])\s+/.test(line)) {
      flushParagraph();
      paragraph.push(line);
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushTable();
  return withTitle(blocks);
}

/* -------------------------------------------------------------- plain text */

export function textToBlocks(text: string): ExtractedDocument {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .replace(/^﻿/, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks: Block[] = [];
  paragraphs.forEach((p, i) => {
    const singleLine = !p.includes("\n");
    const looksLikeHeading =
      singleLine &&
      p.length <= 80 &&
      i < paragraphs.length - 1 &&
      !/[.!?,;:]$/.test(p) &&
      /^[\p{Lu}\d]/u.test(p) &&
      p.split(/\s+/).length <= 10;
    if (looksLikeHeading) {
      blocks.push({ kind: "heading", text: p, level: p === p.toUpperCase() ? 1 : 2 });
      return;
    }
    // Keep line breaks only where the lines are list items; otherwise reflow.
    const lines = p.split("\n").map((l) => l.trim());
    const isList = lines.length > 1 && lines.every((l) => /^([-*•]|\d{1,3}[.)])\s+/.test(l));
    blocks.push({ kind: "paragraph", text: isList ? lines.join("\n") : lines.join(" ") });
  });
  // A short first line in a .txt is as likely a section as a title: keep it.
  return { blocks };
}

/* ---------------------------------------------------------------------- csv */

export function csvToBlocks(text: string): ExtractedDocument {
  const { rows } = parseCsv(text);
  if (rows.length === 0) return { blocks: [] };
  return { blocks: [{ kind: "table", text: formatTableRows(rows).join("\n") }] };
}

/* ----------------------------------------------------------- word (as html) */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function htmlToBlocks(html: string): ExtractedDocument {
  const blocks: Block[] = [];
  const element = /<(h[1-6]|p|li|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = element.exec(html))) {
    const tag = m[1].toLowerCase();
    if (tag === "table") {
      const rows: string[][] = [];
      for (const tr of m[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        rows.push(
          [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1])),
        );
      }
      const text = formatTableRows(rows).join("\n");
      if (text) blocks.push({ kind: "table", text });
      continue;
    }
    const text = htmlText(m[2]);
    if (!text) continue;
    if (tag.startsWith("h")) blocks.push({ kind: "heading", text, level: Number(tag[1]) });
    else blocks.push({ kind: "paragraph", text: tag === "li" ? `- ${text}` : text });
  }
  return withTitle(blocks);
}

/**
 * A document's own title — a top-level heading before any body text, when more
 * follows — is lifted out of the blocks (as PDF titles are), so it does not
 * become the root of every section path or the first entry of the outline.
 */
function withTitle(blocks: Block[]): ExtractedDocument {
  const [first, ...rest] = blocks;
  if (first?.kind === "heading" && first.level === 1 && rest.length > 0) {
    // Only when it is the sole level-1 heading; otherwise H1s are real sections.
    if (!rest.some((b) => b.kind === "heading" && b.level === 1))
      return { blocks: rest, title: first.text };
  }
  return { blocks };
}
