import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNK_OPTIONS, chunkBlocks, chunkText, contextualText } from "@/lib/rag/chunk";
import type { Block } from "@/lib/text/doc-model";

/** A sentence of `words` numbered words: "S3w0 s3w1 … s3w9." */
const sentence = (n: number, words = 10) =>
  Array.from({ length: words }, (_, i) => `${i === 0 ? "S" : "s"}${n}w${i}`).join(" ") + ".";

const paragraph = (from: number, count: number, words = 10) =>
  Array.from({ length: count }, (_, i) => sentence(from + i, words)).join(" ");

const p = (text: string, page?: number): Block => ({
  kind: "paragraph",
  text,
  page,
  pageEnd: page,
});
const h = (text: string, level: number, page?: number): Block => ({
  kind: "heading",
  text,
  level,
  page,
  pageEnd: page,
});

describe("chunkBlocks", () => {
  it("returns nothing for empty input", () => {
    expect(chunkBlocks([])).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    expect(chunkText("Hello world. This is short.")).toEqual([
      {
        index: 0,
        content: "Hello world. This is short.",
        heading: null,
        pageStart: null,
        pageEnd: null,
      },
    ]);
  });

  it("never cuts through a sentence", () => {
    const blocks = [p(paragraph(0, 40))];
    const chunks = chunkBlocks(blocks, { maxChars: 300, minChars: 100, overlapSentences: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(300);
      expect(c.content).toMatch(/^S\d+w0 /); // starts at a sentence start
      expect(c.content).toMatch(/w9\.$/); // ends at a sentence end
    }
  });

  it("covers every sentence, in order", () => {
    const blocks = [p(paragraph(0, 20)), p(paragraph(20, 20))];
    const chunks = chunkBlocks(blocks, { maxChars: 300, minChars: 100, overlapSentences: 1 });
    const seen: number[] = [];
    for (const c of chunks) {
      for (const m of c.content.matchAll(/S(\d+)w0 /g)) {
        const n = Number(m[1]);
        if (!seen.includes(n)) seen.push(n);
      }
    }
    expect(seen).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it("repeats the last sentence of a chunk at the start of the next one in the same section", () => {
    const chunks = chunkBlocks([p(paragraph(0, 30))], {
      maxChars: 300,
      minChars: 100,
      overlapSentences: 1,
    });
    for (let i = 1; i < chunks.length; i++) {
      const previousSentences = chunks[i - 1].content.split(/(?<=\.)\s+/);
      const first = chunks[i].content.split(/(?<=\.)\s+/)[0];
      expect(previousSentences.at(-1)).toBe(first);
    }
  });

  it("starts a new chunk at each section and records the heading path", () => {
    const blocks = [
      h("1. Introduction", 1),
      p(paragraph(0, 6)),
      h("2. Method", 1),
      h("2.1 Data", 2),
      p(paragraph(10, 6)),
    ];
    const chunks = chunkBlocks(blocks, { maxChars: 1200, minChars: 200, overlapSentences: 1 });
    expect(chunks.map((c) => c.heading)).toEqual(["1. Introduction", "2. Method › 2.1 Data"]);
    // No overlap across the section boundary.
    expect(chunks[1].content).not.toContain("S5w0");
    expect(chunks[1].content.startsWith("S10w0")).toBe(true);
  });

  it("folds a tiny section into the next chunk, heading included", () => {
    const blocks = [
      h("A. Hardware", 2),
      p("The rig has two sensors."),
      h("B. Software", 2),
      p(paragraph(0, 8)),
    ];
    const chunks = chunkBlocks(blocks, { maxChars: 1200, minChars: 200, overlapSentences: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("The rig has two sensors.\n\nB. Software\n\nS0w0");
    // Labelled with the section most of its text belongs to.
    expect(chunks[0].heading).toBe("B. Software");
  });

  it("never folds the end of the body into the reference list", () => {
    const blocks = [
      h("V. Conclusion", 1),
      p("We built a thing."),
      h("References", 1),
      p("[1] A. Author. A paper. 2020."),
    ];
    const chunks = chunkBlocks(blocks, { maxChars: 1200, minChars: 200, overlapSentences: 0 });
    expect(chunks.map((c) => c.heading)).toEqual(["V. Conclusion", "References"]);
  });

  it("records the page range a chunk spans", () => {
    const blocks = [p(paragraph(0, 3), 3), p(paragraph(3, 3), 4)];
    const [chunk] = chunkBlocks(blocks, { maxChars: 1200, minChars: 100, overlapSentences: 0 });
    expect(chunk).toMatchObject({ pageStart: 3, pageEnd: 4 });
  });

  it("keeps table rows whole and on their own lines", () => {
    const table: Block = { kind: "table", text: "Model: A; Range: 100 m\nModel: B; Range: 450 m" };
    const [chunk] = chunkBlocks([p("Sensors are listed below."), table]);
    expect(chunk.content).toBe(
      "Sensors are listed below.\n\nModel: A; Range: 100 m\nModel: B; Range: 450 m",
    );
  });

  it("splits a single sentence longer than maxChars by words", () => {
    const long = sentence(0, 120);
    const chunks = chunkBlocks([p(long)], { maxChars: 200, minChars: 50, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(200);
    expect(chunks.map((c) => c.content).join(" ")).toBe(long);
  });

  it("numbers chunks consecutively and is deterministic", () => {
    const blocks = [p(paragraph(0, 50))];
    const chunks = chunkBlocks(blocks, { maxChars: 300, minChars: 100 });
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    expect(chunkBlocks(blocks, { maxChars: 300, minChars: 100 })).toEqual(chunks);
  });

  it("rejects nonsensical options", () => {
    expect(() => chunkText("x", { maxChars: 10 })).toThrow(/maxChars/);
    expect(() => chunkText("x", { maxChars: 100, minChars: 100 })).toThrow(/minChars/);
    expect(() => chunkText("x", { overlapSentences: -1 })).toThrow(/overlapSentences/);
  });

  it("uses ~300-token chunks with one sentence of overlap by default", () => {
    expect(DEFAULT_CHUNK_OPTIONS).toEqual({ maxChars: 1200, minChars: 350, overlapSentences: 1 });
  });
});

describe("chunkText", () => {
  it("treats short title-like lines as headings", () => {
    const chunks = chunkText(`Quiet Hours\n\n${paragraph(0, 3)}\n\nGuests\n\n${paragraph(3, 3)}`, {
      maxChars: 1200,
      minChars: 50,
    });
    expect(chunks.map((c) => c.heading)).toEqual(["Quiet Hours", "Guests"]);
  });
});

describe("contextualText", () => {
  it("prefixes the document title and section path", () => {
    expect(contextualText({ content: "Body.", heading: "III › C. Calibration" }, "Paper")).toBe(
      "Paper — III › C. Calibration\n\nBody.",
    );
    expect(contextualText({ content: "Body.", heading: null })).toBe("Body.");
  });
});
