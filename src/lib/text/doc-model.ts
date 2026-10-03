// The structured form every file is turned into before chunking.
//
// Extraction used to produce one flat string. That threw away exactly the things
// that make a document navigable — where sections start, which page a sentence is
// on, what is a table — and the chunker then had to guess them back. Now each
// extractor (PDF, Word, Markdown, text, CSV) produces Blocks, and everything
// downstream (chunking, summaries, citations) can rely on them.

export type BlockKind = "heading" | "paragraph" | "table" | "caption";

export type Block = {
  kind: BlockKind;
  /**
   * The block's text. Paragraphs are reflowed onto one line; table blocks hold one
   * row per line ("Header: value; Header: value").
   */
  text: string;
  /** 1-based page where the block starts (PDF only). */
  page?: number;
  /** 1-based page where the block ends, when it runs over a page break. */
  pageEnd?: number;
  /** Heading depth, 1 = top level. Only for kind === "heading". */
  level?: number;
};

export type ExtractedDocument = {
  blocks: Block[];
  /** Number of pages, for formats that have pages. */
  pageCount?: number;
  /** A title found inside the document (e.g. a PDF's title line), if any. */
  title?: string;
};

/** Plain text of a structured document, headings included. */
export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/**
 * Formats table rows as readable, searchable lines.
 *
 * When the first row looks like a header, each data row becomes
 * "Header: value; Header: value". If data rows have one more cell than the header
 * (a common layout where the first column is a row label with no header), the
 * label leads: "Livox Avia — Range: 450 m; Freq.: 100 Hz". Otherwise rows are
 * joined with " | ".
 */
export function formatTableRows(rows: string[][]): string[] {
  const clean = rows
    .map((r) => r.map((c) => c.replace(/\s+/g, " ").trim()))
    .filter((r) => r.some((c) => c.length > 0));
  if (clean.length < 2) return clean.map((r) => r.filter(Boolean).join(" | "));

  const [header, ...body] = clean;
  const headerLooksLikeHeader =
    header.every((c) => c.length > 0 && c.length <= 40) &&
    header.filter((c) => /\d/.test(c)).length <= Math.floor(header.length / 3);

  if (!headerLooksLikeHeader) return clean.map((r) => r.filter(Boolean).join(" | "));

  const out: string[] = [header.join(" | ")];
  for (const row of body) {
    if (row.length === header.length) {
      out.push(pairs(header, row));
    } else if (row.length === header.length + 1) {
      out.push(`${row[0]} — ${pairs(header, row.slice(1))}`);
    } else {
      out.push(row.filter(Boolean).join(" | "));
    }
  }
  return out;
}

function pairs(header: string[], row: string[]): string {
  return header
    .map((h, i) => (row[i] ? `${h}: ${row[i]}` : ""))
    .filter(Boolean)
    .join("; ");
}
