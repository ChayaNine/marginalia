// Layout-aware PDF text extraction.
//
// PDF has no paragraphs, no reading order and no headings: just glyph runs at
// x/y positions. The old extractor asked pdf.js for "the text" and got one string
// with a hard line break after every printed line, figure axis labels mixed into
// the prose, and two-column pages interleaved however the producer wrote them.
// Every later step inherited that mess.
//
// This module rebuilds the document from positions:
//
//   items ──▶ lines (same baseline) ──▶ columns (find the gutter) ──▶ reading order
//         ──▶ paragraphs (gaps, indents, sentence ends) ──▶ headings / tables / captions
//         ──▶ cleanup (running headers, page numbers, figure labels, hyphenation)
//
// Everything is heuristic — PDFs vary wildly — but each heuristic is small, named
// and tested (tests/pdf-layout.test.ts) against generated PDFs with known layout.

import { getDocumentProxy } from "unpdf";
import { formatTableRows, type Block, type ExtractedDocument } from "./doc-model";

/* ------------------------------------------------------------------ types */

type Item = { text: string; x: number; y: number; w: number; size: number; font: string };

type Line = {
  page: number;
  /** "L"/"R" = left/right column of a two-column page, "F" = full width. */
  side: "L" | "R" | "F";
  x0: number;
  x1: number;
  y: number;
  size: number;
  font: string;
  /** The line's cells: one entry per run of text separated by a wide gap. */
  cells: string[];
  /** True when every glyph uses one font that differs from the body font. */
  distinctFont: boolean;
};

type PageLayout = { lines: Line[]; width: number; height: number };

/* --------------------------------------------------------------- constants */

/** Gap (in multiples of font size) that separates table cells / columns. */
const CELL_GAP = 1.5;
/** Words that commonly form hyphenated compounds; keep the hyphen at a line break. */
/** Second halves that almost always belong to a hyphenated compound ("LiDAR-based"). */
const COMPOUND_SUFFIXES = new Set([
  "based",
  "level",
  "like",
  "specific",
  "driven",
  "free",
  "aware",
  "oriented",
  "scale",
  "related",
  "dependent",
  "independent",
  "friendly",
  "ready",
  "sized",
  "shaped",
  "wide",
  "rich",
  "intensive",
  "efficient",
  "aided",
  "enabled",
  "assisted",
  "centric",
  "agnostic",
  "defined",
  "made",
  "built",
  "known",
  "term",
  "time",
  "range",
  "resolution",
  "frequency",
  "dimensional",
  "order",
  "art",
]);
const COMPOUND_PREFIXES = new Set([
  "well",
  "self",
  "non",
  "multi",
  "real",
  "high",
  "low",
  "long",
  "short",
  "state",
  "two",
  "three",
  "four",
  "five",
  "single",
  "cross",
  "end",
  "user",
  "time",
  "close",
  "open",
  "half",
  "full",
  "low",
  "high",
  "top",
  "bottom",
  "front",
  "back",
  "side",
  "world",
  "data",
  "sensor",
  "general",
  "large",
  "small",
  "hand",
  "pre",
  "post",
  "anti",
  "semi",
  "sub",
  "co",
]);

/* -------------------------------------------------------------- public API */

export async function extractPdfLayout(bytes: Uint8Array): Promise<ExtractedDocument> {
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: PageLayout[] = [];
  const rawItems: Item[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str || !raw.str.trim()) continue;
      const [a, b, c, d, x, y] = raw.transform as number[];
      // Rotated text (margin stamps like an arXiv id, rotated axis titles) is never prose.
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue;
      const size = Math.hypot(c, d) || raw.height || 0;
      if (size <= 0) continue;
      items.push({ text: raw.str, x, y, w: raw.width, size, font: raw.fontName });
    }
    rawItems.push(items);
    pages.push({ lines: [], width: viewport.width, height: viewport.height });
  }
  await pdf.loadingTask.destroy(); // free the worker-side document

  const bodySize = dominantSize(rawItems.flat());
  const bodyFont = dominantFont(rawItems.flat(), bodySize);

  for (let i = 0; i < pages.length; i++) {
    pages[i].lines = buildLines(rawItems[i], i + 1, pages[i].width, bodyFont);
  }

  removeRunningHeadersAndFooters(pages);

  const vocabulary = buildVocabulary(pages);
  const title = detectTitle(pages[0], bodySize);
  const laid: LaidBlock[] = [];
  for (const page of pages) laid.push(...pageToBlocks(page, bodySize, vocabulary, title));
  let blocks = mergeContinuations(laid, vocabulary);
  blocks = dropLabelHeadings(blocks);
  blocks = splitAbstract(blocks);
  blocks = demoteFrontMatter(blocks);

  return { blocks: blocks.filter((b) => b.text.trim().length > 0), pageCount: pages.length, title };
}

/* ------------------------------------------------------------------- lines */

function dominantSize(items: Item[]): number {
  const weight = new Map<number, number>();
  for (const it of items) {
    const key = Math.round(it.size * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + it.text.length);
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, w] of weight) if (w > bestWeight) [best, bestWeight] = [size, w];
  return best;
}

function dominantFont(items: Item[], bodySize: number): string {
  const weight = new Map<string, number>();
  for (const it of items) {
    if (Math.abs(it.size - bodySize) > 0.6) continue;
    weight.set(it.font, (weight.get(it.font) ?? 0) + it.text.length);
  }
  let best = "";
  let bestWeight = -1;
  for (const [font, w] of weight) if (w > bestWeight) [best, bestWeight] = [font, w];
  return best;
}

/** Groups a page's items into lines, deciding the column layout first. */
function buildLines(items: Item[], page: number, width: number, bodyFont: string): Line[] {
  // 1. Cluster items that share a baseline (superscripts sit within half a size).
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const anchor = row ? row.reduce((m, r) => (r.size > m.size ? r : m)) : null;
    if (anchor && Math.abs(anchor.y - it.y) <= 0.5 * Math.max(anchor.size, it.size)) row.push(it);
    else rows.push([it]);
  }

  // 2. Find a column gutter, if this is a two-column page.
  const columns = findColumns(rows, width);
  const gutter = columns?.gutter ?? null;

  // 3. Split each row by side of the gutter, then into cells by wide gaps.
  const lines: Line[] = [];
  for (const row of rows) {
    const bySide = new Map<Line["side"], Item[]>();
    const xs = row.map((r) => [r.x, r.x + r.w] as const);
    let crosses = gutter !== null && xs.some(([a, b]) => a < gutter - 3 && b > gutter + 3);
    if (columns && !crosses) {
      // A row whose parts reach into the gutter from either side is one full-width row
      // (a table header, a wide equation), not two column lines that share a baseline.
      const leftParts = xs.filter(([a, b]) => (a + b) / 2 < columns.gutter);
      const rightParts = xs.filter(([a, b]) => (a + b) / 2 >= columns.gutter);
      if (leftParts.length && rightParts.length) {
        const leftEnd = Math.max(...leftParts.map(([, b]) => b));
        const rightStart = Math.min(...rightParts.map(([a]) => a));
        crosses = leftEnd > columns.leftEdge + 2 || rightStart < columns.rightEdge - 2;
      }
    }
    for (const it of row) {
      const side: Line["side"] =
        gutter === null || crosses ? "F" : it.x + it.w / 2 < gutter ? "L" : "R";
      if (!bySide.has(side)) bySide.set(side, []);
      bySide.get(side)!.push(it);
    }
    for (const [side, group] of bySide) {
      const line = assembleLine(group, page, side, bodyFont);
      if (line) lines.push(line);
    }
  }
  return lines;
}

type Columns = { gutter: number; leftEdge: number; rightEdge: number };

/**
 * Finds a column gutter, or null for single-column pages.
 *
 * Works on individual glyph runs (pdf.js items), not on reassembled lines: a PDF
 * producer positions each column separately, so runs stay inside their column,
 * while the gap between two columns can be narrower than the gap between table
 * cells and so cannot be found by looking at whitespace alone. Uses the page's own
 * dominant font size, so a reference list set smaller than the body still counts.
 */
function findColumns(rows: Item[][], width: number): Columns | null {
  const items = rows.flat().filter((r) => r.text.trim().length >= 3);
  if (items.length === 0) return null;
  const pageSize = dominantSize(items);
  const runs = items
    .filter((r) => Math.abs(r.size - pageSize) <= 1)
    .map((r) => ({ x0: r.x, x1: r.x + r.w }));
  if (runs.length < 12) return null;

  let best: number | null = null;
  let bestCrossing = Infinity;
  for (let x = Math.round(width * 0.35); x <= width * 0.65; x += 1) {
    const crossing = runs.filter((f) => f.x0 < x - 1 && f.x1 > x + 1).length;
    const closer = best !== null && Math.abs(x - width / 2) < Math.abs(best - width / 2);
    if (crossing < bestCrossing || (crossing === bestCrossing && closer)) {
      bestCrossing = crossing;
      best = x;
    }
  }
  if (best === null) return null;
  const g = best;
  const left = runs.filter((f) => f.x1 <= g);
  const right = runs.filter((f) => f.x0 >= g);
  const isTwoColumn =
    bestCrossing <= runs.length * 0.08 &&
    left.length >= runs.length * 0.2 &&
    right.length >= runs.length * 0.2;
  if (!isTwoColumn) return null;
  const percentile = (xs: number[], p: number) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  return {
    gutter: g,
    // Near-extremes rather than medians: hanging-indent lists push most lines inward.
    leftEdge: percentile(
      left.map((r) => r.x1),
      0.98,
    ), // right edge of the left column
    rightEdge: percentile(
      right.map((r) => r.x0),
      0.02,
    ), // left edge of the right column
  };
}

function assembleLine(
  items: Item[],
  page: number,
  side: Line["side"],
  bodyFont: string,
): Line | null {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const visible = sorted.filter((it) => it.text.trim());
  if (visible.length === 0) return null;

  const cells: string[] = [];
  let cell = "";
  let prevEnd: number | null = null;
  let prevSize = visible[0].size;
  for (const it of visible) {
    const gap = prevEnd === null ? 0 : it.x - prevEnd;
    if (prevEnd !== null && gap > CELL_GAP * Math.max(prevSize, it.size)) {
      cells.push(cell);
      cell = "";
    } else if (
      prevEnd !== null &&
      gap > 0.12 * it.size &&
      !/\s$/.test(cell) &&
      !/^\s/.test(it.text)
    ) {
      cell += " ";
    }
    cell += it.text;
    prevEnd = it.x + it.w;
    prevSize = it.size;
  }
  cells.push(cell);

  const cleaned = cells.map(cleanText).filter((c) => c.length > 0);
  if (cleaned.length === 0) return null;

  // The size that covers most of the line's text decides its size.
  const bySize = new Map<number, number>();
  for (const it of visible) bySize.set(it.size, (bySize.get(it.size) ?? 0) + it.text.length);
  const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const fonts = new Set(visible.map((it) => it.font));
  const font = visible[0].font;

  return {
    page,
    side,
    x0: visible[0].x,
    x1: Math.max(...visible.map((it) => it.x + it.w)),
    y: visible.reduce((m, it) => (it.size > m.size ? it : m)).y,
    size,
    font,
    cells: cleaned,
    distinctFont: fonts.size === 1 && font !== bodyFont,
  };
}

/** LaTeX-produced PDFs often draw accents as separate spacing glyphs before the letter. */
const SPACING_TO_COMBINING: Record<string, string> = {
  "˜": "\u0303",
  "´": "\u0301",
  "¨": "\u0308",
  ˆ: "\u0302",
  ˇ: "\u030C",
  "˘": "\u0306",
  "˚": "\u030A",
};

/** Ligatures, spacing diacritics ("Pe˜na" → "Peña"), soft hyphens, odd spaces. */
export function cleanText(text: string): string {
  return text
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/ı(?=[\u0300-\u036f])/g, "i")
    .replace(/[˜´¨ˆˇ˘˚]\s?([\p{L}])/gu, (_m, letter: string, offset: number, whole: string) => {
      const base = letter === "ı" ? "i" : letter;
      return `${base}${SPACING_TO_COMBINING[whole[offset]]}`;
    })
    .replace(/(?<=\p{L})`([A-Za-z])/gu, "$1\u0300")
    .normalize("NFC")
    .replace(/­/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[  -​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineText(line: Line): string {
  return line.cells.join(line.cells.length > 1 ? " | " : "");
}

/* ------------------------------------------------- headers, footers, title */

function normalizeForRepeat(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function removeRunningHeadersAndFooters(pages: PageLayout[]): void {
  const inMargin = (line: Line, page: PageLayout) =>
    line.y > page.height * 0.92 || line.y < page.height * 0.08;

  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      if (!inMargin(line, page)) continue;
      const key = normalizeForRepeat(lineText(line));
      if (!seen.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      seen.add(key);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.4));
  for (const page of pages) {
    page.lines = page.lines.filter((line) => {
      if (!inMargin(line, page)) return true;
      const text = lineText(line);
      if (/^(page\s*)?#?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(text.trim())) return false; // page number
      return pages.length < 3 || (counts.get(normalizeForRepeat(text)) ?? 0) < threshold;
    });
  }
}

function detectTitle(page: PageLayout | undefined, bodySize: number): string | undefined {
  if (!page || page.lines.length === 0) return undefined;
  const top = page.lines.filter((l) => l.y > page.height * 0.55);
  if (top.length === 0) return undefined;
  const maxSize = Math.max(...top.map((l) => l.size));
  if (maxSize < bodySize * 1.4) return undefined;
  const titleLines = top.filter((l) => Math.abs(l.size - maxSize) < 0.5).sort((a, b) => b.y - a.y);
  const title = titleLines.map(lineText).join(" ").replace(/\s+/g, " ").trim();
  return title.length >= 10 && title.length <= 250 ? title : undefined;
}

/* --------------------------------------------------------- reading order */

/** Orders a page's lines: full-width bands split the page; inside a band, left column then right. */
function readingOrder(lines: Line[]): { line: Line; region: number }[] {
  const sorted = [...lines].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const out: { line: Line; region: number }[] = [];
  let region = 0;
  let left: Line[] = [];
  let right: Line[] = [];
  const flushColumns = () => {
    if (left.length) {
      region++;
      for (const l of left) out.push({ line: l, region });
    }
    if (right.length) {
      region++;
      for (const l of right) out.push({ line: l, region });
    }
    left = [];
    right = [];
  };
  for (const line of sorted) {
    if (line.side === "F") {
      flushColumns();
      if (out.length === 0 || out[out.length - 1].line.side !== "F") region++;
      out.push({ line, region });
    } else if (line.side === "L") left.push(line);
    else right.push(line);
  }
  flushColumns();
  return out;
}

/* ------------------------------------------------------------- paragraphs */

const LIST_MARKER = /^(\(?([ivx]{1,5}|[a-h]|\d{1,2})\)|\[\d{1,3}\]\s|[•▪◦●‣∙]|[-–]\s)/i;
const SECTION_NAMES =
  /^(abstract|introduction|background|related work|method(s|ology)?|results|discussion|conclusions?|acknowledge?ments?|references|bibliography|appendix( [A-Z])?)$/i;
const CAPTION = /^(fig\.?|figure|table|tab\.)\s*[\dIVX]+[a-z]?\s*[:.|]/i;
const NUMBERED_HEADING = /^((\d{1,2}(\.\d{1,2}){0,3})|[IVXLC]{1,6}|[A-Z])[.)]?\s+[A-Z]/;

function headingLevel(text: string, size: number, bodySize: number): number {
  const numbered = /^(\d{1,2}(?:\.\d{1,2})*)[.)]?\s/.exec(text);
  if (numbered) return Math.min(3, numbered[1].split(".").length);
  const rest = text.replace(/^\S+\s*/, "");
  const restUpper =
    rest.replace(/[^A-Za-z]/g, "").length > 0 &&
    rest.replace(/[^A-Z]/g, "").length / rest.replace(/[^A-Za-z]/g, "").length > 0.8;
  if (/^[IVXLC]{2,6}\.\s/.test(text)) return 1;
  if (/^[IVXLC]\.\s/.test(text) && restUpper) return 1; // "I. INTRODUCTION", not "C. Sensor Calibration"
  if (/^[A-Z]\.\s/.test(text)) return 2;
  // Unnumbered top-level parts of a paper: "Abstract", "REFERENCES", "Acknowledgment".
  if (SECTION_NAMES.test(text.trim())) return 1;
  if (size >= bodySize * 1.3) return 1;
  return 2;
}

/** Joins IEEE-style small caps that pdf.js splits: "I NTRODUCTION" → "INTRODUCTION". */
function fixSmallCaps(text: string): string {
  if (text.replace(/[^A-Za-z]/g, "").length < 4) return text;
  const upper = text.replace(/[^A-Z]/g, "").length / text.replace(/[^A-Za-z]/g, "").length;
  if (upper < 0.8) return text;
  return text.replace(/\b([A-Z]) (?=[A-Z]{2,}\b)/g, "$1");
}

function looksLikeHeading(
  line: Line,
  gapAbove: number,
  leading: number,
  bodySize: number,
): boolean {
  const text = lineText(line);
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  if (letters < 3 || text.length > 100 || line.cells.length > 1) return false;
  if (/[.,;:]$/.test(text) && !/^[IVXLC]+\.$/.test(text)) return false;
  if (CAPTION.test(text)) return false;
  if (/^[a-z]/.test(text)) return false;
  if (/^abstract\s*[—–-]\s*\S/i.test(text)) return false; // "Abstract—We present…" starts a paragraph
  const words = text.split(/\s+/).length;
  const spaced = gapAbove > leading * 1.2;
  if (line.size >= bodySize + 1 && words <= 16) return true;
  const capsOnly =
    letters >= 4 && text.replace(/[^\p{L}]/gu, "") === text.replace(/[^\p{L}]/gu, "").toUpperCase();
  if ((capsOnly || SECTION_NAMES.test(fixSmallCaps(text))) && words <= 6 && spaced) return true;
  if (line.distinctFont && words <= 10 && (spaced || NUMBERED_HEADING.test(text))) return true;
  if (NUMBERED_HEADING.test(text) && words <= 10 && spaced && /^[\dIVXLCA-Z.()\s]+[A-Z]/.test(text))
    return true;
  return false;
}

type Draft = {
  kind: Block["kind"];
  lines: Line[];
  page: number;
  pageEnd: number;
  level?: number;
  region: number;
};

/** A block plus where it sits in its column region, used to re-join split paragraphs. */
type LaidBlock = Block & { firstInRegion?: boolean; lastInRegion?: boolean };

function pageToBlocks(
  page: PageLayout,
  bodySize: number,
  vocabulary: Vocabulary,
  title?: string,
): LaidBlock[] {
  const ordered = readingOrder(page.lines);
  if (ordered.length === 0) return [];

  // Typical line spacing for body text, measured inside regions.
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (
      a.region === b.region &&
      Math.abs(a.line.size - bodySize) < 0.6 &&
      Math.abs(b.line.size - bodySize) < 0.6
    ) {
      const g = a.line.y - b.line.y;
      if (g > 0 && g < bodySize * 3) gaps.push(g);
    }
  }
  // The most common gap (to the nearest half point; the smaller one on a tie).
  // A median is skewed by the extra space around headings on short pages.
  const counts = new Map<number, number>();
  for (const g of gaps)
    counts.set(Math.round(g * 2) / 2, (counts.get(Math.round(g * 2) / 2) ?? 0) + 1);
  let leading = bodySize * 1.2;
  let best = 0;
  for (const [gap, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (n > best) [leading, best] = [gap, n];
  }

  // Column edges per region, to recognise indents and short last lines.
  const edges = new Map<number, { left: number; right: number }>();
  for (const { line, region } of ordered) {
    const e = edges.get(region);
    if (!e) edges.set(region, { left: line.x0, right: line.x1 });
    else {
      e.left = Math.min(e.left, line.x0);
      e.right = Math.max(e.right, line.x1);
    }
  }

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let prev: { line: Line; region: number } | null = null;

  const titleText = title ? normalizeForRepeat(title) : null;

  for (const entry of ordered) {
    const { line, region } = entry;
    const text = lineText(line);

    // Skip the title lines on page one; the title is stored separately.
    if (
      titleText &&
      line.page === 1 &&
      titleText.includes(normalizeForRepeat(text)) &&
      line.size > bodySize * 1.3
    ) {
      prev = entry;
      continue;
    }

    const gapAbove = prev && prev.region === region ? prev.line.y - line.y : Infinity;
    const edge = edges.get(region)!;
    const isTableRow = line.cells.length >= 2;
    const isHeading = looksLikeHeading(line, gapAbove, leading, bodySize);
    const isCaption = CAPTION.test(text);

    let startNew = current === null || isHeading || current.kind === "heading" || isCaption;
    if (!startNew && current) {
      const last = current.lines[current.lines.length - 1];
      const lastText = lineText(last);
      const sizeChange = Math.abs(last.size - line.size) > 0.8;
      const bigGap = gapAbove > leading * 1.45;
      const regionChange = prev !== null && prev.region !== region;
      const indented = line.x0 > last.x0 + 0.6 * line.size && /^[\p{Lu}\d"“(\[]/u.test(text);
      const lastShort = last.x1 < edge.right - (edge.right - edge.left) * 0.12;
      const lastEnds = /[.!?:]["')\]]?$/.test(lastText);
      const tableBoundary = (current.kind === "table") !== isTableRow;
      // Table rows stay together across the rules that separate groups of rows.
      const tableContinues =
        current.kind === "table" &&
        isTableRow &&
        !regionChange &&
        Math.abs(last.cells.length - line.cells.length) <= 1;
      startNew =
        sizeChange ||
        tableBoundary ||
        (bigGap && !regionChange) ||
        LIST_MARKER.test(text) ||
        (lastEnds && (lastShort || indented)) ||
        (regionChange && lastEnds && lastShort);
      if (current.kind === "caption" && !bigGap && !regionChange && !isTableRow) startNew = false;
      if (tableContinues) startNew = false;
    }

    if (startNew) {
      current = {
        kind: isHeading ? "heading" : isCaption ? "caption" : isTableRow ? "table" : "paragraph",
        lines: [],
        page: line.page,
        pageEnd: line.page,
        level: isHeading ? headingLevel(fixSmallCaps(text), line.size, bodySize) : undefined,
        region,
      };
      drafts.push(current);
    }
    current!.lines.push(line);
    current!.pageEnd = line.page;
    prev = entry;
  }

  const blocks: (LaidBlock & { region: number })[] = [];
  for (const d of drafts) {
    const block = finishDraft(d, bodySize, vocabulary);
    if (block) blocks.push({ ...block, region: d.region });
  }
  // Mark the first and last prose block of each column region.
  const prose = (b: LaidBlock) => b.kind === "paragraph" || b.kind === "heading";
  for (const region of new Set(blocks.map((b) => b.region))) {
    const inRegion = blocks.filter((b) => b.region === region && prose(b));
    if (inRegion.length) {
      inRegion[0].firstInRegion = true;
      inRegion[inRegion.length - 1].lastInRegion = true;
    }
  }
  return blocks.map(({ region: _region, ...b }) => b);
}

function finishDraft(d: Draft, bodySize: number, vocabulary: Vocabulary): Block | null {
  if (d.kind === "table") {
    // Axis ticks and plot labels line up like table rows; real tables contain words.
    if (d.lines.every((l) => l.size < bodySize * 0.72)) return null;
    const rows = formatTableRows(d.lines.map((l) => l.cells));
    if (!/\p{L}{3}/u.test(rows.join(" "))) return null;
    return { kind: "table", text: rows.join("\n"), page: d.page, pageEnd: d.pageEnd };
  }

  const texts = d.lines.map(lineText);
  if (d.kind === "heading") {
    return {
      kind: "heading",
      text: fixSmallCaps(texts.join(" ")),
      page: d.page,
      pageEnd: d.pageEnd,
      level: d.level,
    };
  }

  // Figure labels and axis ticks: tiny text, or blocks of short label-like lines.
  const avgLen = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  const letters = texts.join("").replace(/[^\p{L}]/gu, "").length;
  const tiny = d.lines.every((l) => l.size < bodySize * 0.72);
  const sentenceLike =
    /[.!?:;]/.test(texts.join(" ")) || texts.some((t) => t.split(/\s+/).length >= 7);
  if (d.kind !== "caption") {
    if (tiny) return null;
    if (letters < 3) return null;
    if (avgLen < 28 && !sentenceLike) return null;
  }

  const text = joinLines(texts, vocabulary);
  return { kind: d.kind, text, page: d.page, pageEnd: d.pageEnd };
}

/* ---------------------------------------------------------- hyphenation */

type Vocabulary = { words: Set<string>; hyphenated: Set<string> };

function buildVocabulary(pages: PageLayout[]): Vocabulary {
  const words = new Set<string>();
  const hyphenated = new Set<string>();
  for (const page of pages) {
    for (const line of page.lines) {
      const text = lineText(line).toLowerCase();
      for (const w of text.match(/\p{L}+(?:-\p{L}+)+/gu) ?? []) hyphenated.add(w);
      // Words that end a line with a hyphen are fragments, not vocabulary.
      for (const w of text.replace(/\p{L}+-$/u, "").match(/\p{L}+/gu) ?? []) words.add(w);
    }
  }
  return { words, hyphenated };
}

/** Joins a paragraph's lines, repairing words hyphenated across line breaks. */
export function joinLines(
  lines: string[],
  vocabulary: Vocabulary = { words: new Set(), hyphenated: new Set() },
): string {
  let out = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    const hyphenEnd = /([\p{L}\d]+)-$/u.exec(out);
    const nextWord = /^([\p{L}\d]+)/u.exec(line);
    if (hyphenEnd && nextWord) {
      const prefix = hyphenEnd[1];
      const suffix = nextWord[1];
      const joinable = /^\p{Ll}/u.test(suffix) && /\p{L}$/u.test(prefix);
      const joinedIsWord = vocabulary.words.has((prefix + suffix).toLowerCase());
      // "Li-" + "DAR" → "LiDAR" (a known word); "multi-" + "UAV" → "multi-UAV";
      // "Mid-" + "360" → "Mid-360"; "re-" + "producible" → "reproducible".
      const dropHyphen = joinedIsWord || (joinable && !keepHyphen(prefix, suffix, vocabulary));
      out = out.slice(0, -1) + (dropHyphen ? "" : "-") + line;
    } else {
      out += " " + line;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

function keepHyphen(prefix: string, suffix: string, vocabulary: Vocabulary): boolean {
  const joined = (prefix + suffix).toLowerCase();
  const compound = `${prefix}-${suffix}`.toLowerCase();
  if (vocabulary.hyphenated.has(compound)) return true;
  if (vocabulary.words.has(joined)) return false;
  if (/[A-Z].*[A-Z]/.test(prefix) || /\d/.test(prefix)) return true; // "GNSS-denied", "3D-printed"
  return COMPOUND_PREFIXES.has(prefix.toLowerCase()) || COMPOUND_SUFFIXES.has(suffix.toLowerCase());
}

/* ------------------------------------------------ cross-column continuations */

/**
 * A paragraph that runs off the bottom of a column (or page) and continues at
 * the top of the next one arrives as two blocks, often with a figure caption or
 * table in between. Re-join them when the first does not end a sentence and the
 * second starts in lower case.
 */
function mergeContinuations(blocks: LaidBlock[], vocabulary: Vocabulary): Block[] {
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a.kind !== "paragraph" || !a.lastInRegion || /[.!?:]["')\]]?$/.test(a.text)) continue;
    for (let j = i + 1; j < Math.min(out.length, i + 6); j++) {
      const b = out[j];
      if (b.kind === "caption" || b.kind === "table") continue;
      if (
        b.kind === "paragraph" &&
        b.firstInRegion &&
        /^[\p{Ll}\d(\[]/u.test(b.text) &&
        !LIST_MARKER.test(b.text)
      ) {
        a.text = joinLines([a.text, b.text], vocabulary);
        a.pageEnd = b.pageEnd ?? b.page;
        a.lastInRegion = b.lastInRegion;
        out.splice(j, 1);
        i--; // the merged paragraph may continue into the next region too
      }
      break;
    }
  }
  return out.map(({ firstInRegion: _f, lastInRegion: _l, ...b }) => b);
}

/**
 * Large or bold text inside figures ("Holybro X500", "100 Hz Avia Driver") passes
 * the heading test. A real heading introduces content; a figure label is followed
 * by another label or the caption. Numbered headings are always kept.
 */
/**
 * Author lines and affiliations on the first page are set large or bold, so they
 * look like headings. Anything heading-like before the first real section
 * ("Abstract", "1 Introduction", "I. INTRODUCTION") is front matter: keep it as
 * text, out of the outline.
 */
function demoteFrontMatter(blocks: Block[]): Block[] {
  const firstSection = blocks.findIndex(
    (b) =>
      b.kind === "heading" && (NUMBERED_HEADING.test(b.text) || SECTION_NAMES.test(b.text.trim())),
  );
  if (firstSection <= 0) return blocks;
  return blocks.map((b, i) =>
    i < firstSection && b.kind === "heading" && (b.page ?? 1) === 1
      ? { ...b, kind: "paragraph", level: undefined }
      : b,
  );
}

function dropLabelHeadings(blocks: Block[]): Block[] {
  return blocks.filter((b, i) => {
    if (b.kind !== "heading") return true;
    if (
      NUMBERED_HEADING.test(b.text) ||
      /^(abstract|references|bibliography|acknowledg)/i.test(b.text)
    )
      return true;
    const next = blocks[i + 1];
    return next !== undefined && (next.kind === "paragraph" || next.kind === "table");
  });
}

/** "Abstract—With the increasing…" becomes a heading plus a paragraph. */
function splitAbstract(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const m =
      b.kind === "paragraph"
        ? /^(Abstract|ABSTRACT|Summary|Index Terms)\s*[—–:.-]\s*/.exec(b.text)
        : null;
    if (m && m[1] !== "Index Terms") {
      out.push({
        kind: "heading",
        text: m[1][0] + m[1].slice(1).toLowerCase(),
        page: b.page,
        pageEnd: b.page,
        level: 1,
      });
      out.push({ ...b, text: b.text.slice(m[0].length) });
    } else out.push(b);
  }
  return out;
}
