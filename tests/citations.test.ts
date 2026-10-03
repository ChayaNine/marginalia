import { describe, expect, it } from "vitest";
import {
  citedSourceNumbers,
  normalizeForMatch,
  resolveCitations,
  verifyQuote,
  type RetrievedChunk,
} from "@/lib/rag/citations";

const chunk = (id: string, content: string, index = 0): RetrievedChunk => ({
  chunkId: id,
  documentId: "doc1",
  documentTitle: "Handbook",
  chunkIndex: index,
  content,
  heading: "3. Quiet hours",
  pageStart: 2,
  pageEnd: 3,
  score: 0.5,
  vectorScore: 0.4,
  keywordScore: 0.5,
});

describe("verifyQuote", () => {
  const content =
    "Quiet hours run from 11 pm to 7 am — residents’ guests must leave by then.\nNext line.";

  it("accepts exact and whitespace/case-insensitive matches", () => {
    expect(verifyQuote("Quiet hours run from 11 pm to 7 am", content)).toBe(true);
    expect(verifyQuote("quiet   hours RUN from 11 pm", content)).toBe(true);
    expect(verifyQuote("by then. Next line", content)).toBe(true); // across a newline
  });

  it("normalises typographic quotes and dashes", () => {
    expect(verifyQuote("7 am - residents' guests", content)).toBe(true);
    expect(normalizeForMatch("“Hi” — it’s")).toBe('"hi" - it\'s');
  });

  it("rejects paraphrases and trivially short quotes", () => {
    expect(verifyQuote("Quiet hours are 11pm-7am", content)).toBe(false);
    expect(verifyQuote("am", content)).toBe(false);
    expect(verifyQuote("", content)).toBe(false);
  });
});

describe("resolveCitations", () => {
  const sources = [
    chunk("c1", "Alpha is the first letter. Beta is second."),
    chunk("c2", "Gamma comes third.", 4),
  ];

  it("maps source numbers to chunks and verifies quotes", () => {
    const resolved = resolveCitations(
      [
        { source: 2, quote: "Gamma comes third." },
        { source: 1, quote: "Alpha is the first letter." },
        { source: 1, quote: "Alpha is NOT the first letter." },
      ],
      sources,
    );
    expect(resolved).toHaveLength(3);
    expect(resolved[0]).toMatchObject({
      order: 0,
      source: 2,
      chunkId: "c2",
      chunkIndex: 4,
      verified: true,
      // Where the passage lives travels with the citation, for "p. 2" links.
      heading: "3. Quiet hours",
      pageStart: 2,
      pageEnd: 3,
    });
    expect(resolved[1]).toMatchObject({ order: 1, source: 1, chunkId: "c1", verified: true });
    expect(resolved[2]).toMatchObject({ order: 2, source: 1, verified: false });
  });

  it("drops citations to sources that were never provided", () => {
    const resolved = resolveCitations(
      [
        { source: 0, quote: "x" },
        { source: 3, quote: "y" },
        { source: -1, quote: "z" },
        { source: 1.5, quote: "w" },
      ],
      sources,
    );
    expect(resolved).toEqual([]);
  });

  it("collapses duplicate citations", () => {
    const resolved = resolveCitations(
      [
        { source: 1, quote: "Beta is second." },
        { source: 1, quote: "  beta is SECOND. " },
      ],
      sources,
    );
    expect(resolved).toHaveLength(1);
  });
});

describe("citedSourceNumbers", () => {
  it("extracts unique [n] markers in ascending order", () => {
    expect(citedSourceNumbers("Fact one [2]. Fact two [1][2]. Nothing [x].")).toEqual([1, 2]);
    expect(citedSourceNumbers("no markers")).toEqual([]);
  });
});
