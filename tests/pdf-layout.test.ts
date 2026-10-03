// Layout-aware PDF reading, against a generated IEEE-style two-column paper
// (tests/fixtures/make-two-column-pdf.py) that has every problem flat text
// extraction gets wrong.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExtractedDocument } from "@/lib/text/doc-model";
import { extractPdfLayout } from "@/lib/text/pdf-layout";
import { chunkBlocks } from "@/lib/rag/chunk";

let doc: ExtractedDocument;
const text = () => doc.blocks.map((b) => b.text).join("\n");

beforeAll(async () => {
  doc = await extractPdfLayout(
    new Uint8Array(readFileSync(path.join(__dirname, "fixtures", "two-column.pdf"))),
  );
});

describe("extractPdfLayout", () => {
  it("reads the title from the largest text on page one", () => {
    expect(doc.title).toBe("Counting Drones with Two LiDARs");
    expect(doc.pageCount).toBe(2);
    expect(text()).not.toContain("Counting Drones with Two LiDARs"); // not repeated as body text
  });

  it("finds numbered section headings with their levels, and keeps author lines out of them", () => {
    const headings = doc.blocks.filter((b) => b.kind === "heading").map((b) => [b.text, b.level]);
    expect(headings).toEqual([
      ["Abstract", 1],
      ["I. INTRODUCTION", 1],
      ["A. Sensor Setup", 2],
      ["II. RESULTS", 1],
      ["REFERENCES", 1],
    ]);
    expect(doc.blocks.find((b) => b.text === "Ada Example and Ben Sample")?.kind).toBe("paragraph");
  });

  it("splits 'Abstract—…' into a heading and its paragraph", () => {
    const i = doc.blocks.findIndex((b) => b.text === "Abstract");
    expect(doc.blocks[i + 1].text).toMatch(
      /^We present a dataset for counting drones with two LiDAR sensors\./,
    );
  });

  it("reads the left column before the right, and joins a sentence split across them", () => {
    expect(text()).toContain(
      "This paragraph continues into the next column because the column ends here and the sentence finishes at the top of the right one.",
    );
    expect(text().indexOf("Small drones are hard")).toBeLessThan(text().indexOf("A. Sensor Setup"));
  });

  it("re-joins words hyphenated at line ends", () => {
    expect(text()).toContain("The extrinsic calibration between them");
    expect(text()).not.toMatch(/cali-\s*bration/);
  });

  it("keeps real hyphenated compounds", () => {
    expect(text()).toContain("solid-state sensor");
  });

  it("drops running headers, page numbers and figure tick labels", () => {
    expect(text()).not.toContain("PREPRINT");
    expect(doc.blocks.some((b) => /^\d+$/.test(b.text.trim()))).toBe(false);
    expect(text()).not.toMatch(/\b0 10 20 30\b|0\.0 0\.5 1\.0/);
  });

  it("keeps figure captions as captions", () => {
    expect(doc.blocks.find((b) => b.kind === "caption")?.text).toBe(
      "Fig. 1: Tracking error of both sensors over time.",
    );
  });

  it("puts each reference entry in its own block, on its page", () => {
    const refs = doc.blocks.filter((b) => /^\[\d\]/.test(b.text));
    expect(refs.map((r) => r.text)).toEqual([
      "[1] A. Example, “A survey of drone detection,” Journal of Examples, vol. 1, pp. 1–10, 2021.",
      "[2] B. Sample and C. Person, “Point cloud tracking,” in Proc. Conference on Samples, 2022.",
    ]);
    expect(refs.every((r) => r.page === 2)).toBe(true);
  });

  it("feeds chunks that carry section paths and pages", () => {
    const chunks = chunkBlocks(doc.blocks, { maxChars: 400, minChars: 100, overlapSentences: 0 });
    const setup = chunks.find((c) => c.content.includes("64 channels"));
    expect(setup).toMatchObject({
      heading: "I. INTRODUCTION › A. Sensor Setup",
      pageStart: 1,
      pageEnd: 1,
    });
    const results = chunks.find((c) => c.content.includes("100% of the sequences"));
    expect(results).toMatchObject({ heading: "II. RESULTS", pageStart: 2 });
  });
});
