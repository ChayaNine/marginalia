// Hybrid ranking, overview routing, document summaries and citation locations.

import { describe, expect, it } from "vitest";
import { mockEmbed } from "@/lib/ai/mock";
import { displayHeading, fileHref, formatPages, lastHeading, passageHref } from "@/lib/locate";
import { bm25Scores, reciprocalRankFusion } from "@/lib/rag/bm25";
import { chunkBlocks } from "@/lib/rag/chunk";
import { namesDocument, planQuestion, selectOverviewChunks } from "@/lib/rag/overview";
import { buildUserPrompt, formatSource, systemPromptFor } from "@/lib/rag/prompt";
import { rankChunks, type RankCandidate } from "@/lib/rag/rank";
import { parseSummary, summarizeDocument } from "@/lib/rag/summary";
import type { Block } from "@/lib/text/doc-model";
import { tokenize } from "@/lib/text/tokenize";

describe("bm25Scores", () => {
  const docs = [
    "the avia has a range of 450 m",
    "the ouster has 64 channels",
    "range and channels of every sensor",
  ].map(tokenize);

  it("scores documents containing rarer query terms higher", () => {
    const scores = bm25Scores(tokenize("avia range"), docs);
    expect(scores[0].bm25).toBeGreaterThan(scores[2].bm25);
    expect(scores[1].bm25).toBe(0);
  });

  it("reports how much of the query's weight each document covers", () => {
    const [first, second] = bm25Scores(tokenize("avia range"), docs);
    expect(first.coverage).toBeCloseTo(1);
    expect(second.coverage).toBe(0);
    expect(bm25Scores([], docs).every((s) => s.coverage === 0)).toBe(true);
    expect(bm25Scores(["x"], [])).toEqual([]);
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards items ranked well in both lists and normalises the best to 1", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["a", "c"],
    ]);
    expect(fused.get("a")).toBeCloseTo(1);
    expect(fused.get("c")!).toBeGreaterThan(fused.get("b")!);
  });
});

describe("rankChunks", () => {
  const candidate = (i: number, content: string, heading: string | null = null): RankCandidate => ({
    chunkId: `c${i}`,
    documentId: "d",
    documentTitle: "Paper",
    chunkIndex: i,
    content,
    heading,
    pageStart: null,
    pageEnd: null,
    embedding: mockEmbed(content),
  });
  const candidates = [
    candidate(0, "Our platform carries three LiDAR sensors and a camera on a tripod."),
    candidate(1, "The Mid-360 has a 360 degree field of view and a range of 70 m."),
    candidate(2, "[4] A. Author. LiDAR sensors with a Mid-360 field of view. 2021.", "References"),
  ];

  it("returns both scores and a fused score, best first", () => {
    const q = "What is the field of view of the Mid-360?";
    const [top] = rankChunks(candidates, mockEmbed(q), q, { k: 3 });
    expect(top.chunkId).toBe("c1");
    expect(top.score).toBeCloseTo(1);
    expect(top.vectorScore).toBeGreaterThan(0);
    expect(top.keywordScore).toBeGreaterThan(0.5);
    expect(top).not.toHaveProperty("embedding");
  });

  it("matches model numbers written differently ('Mid360')", () => {
    const q = "Mid360 range";
    expect(rankChunks(candidates, mockEmbed(q), q, { k: 1 })[0].chunkId).toBe("c1");
  });

  it("pushes reference lists down unless the question is about references", () => {
    const q = "LiDAR sensors Mid-360 field of view";
    const normal = rankChunks(candidates, mockEmbed(q), q, { k: 3 });
    expect(normal.at(-1)?.chunkId).toBe("c2");
    const aboutRefs = "Which references cite the Mid-360 field of view?";
    const refs = rankChunks(candidates, mockEmbed(aboutRefs), aboutRefs, { k: 3 });
    expect(refs.findIndex((r) => r.chunkId === "c2")).toBeLessThan(2);
  });
});

describe("planQuestion", () => {
  it("recognises whole-document questions, however they are phrased", () => {
    for (const q of [
      "explain the details, crucial detail",
      "Summarise this paper",
      "What is this document about?",
      "tl;dr",
      "What are the key findings?",
      "Give me the main points",
    ]) {
      expect(planQuestion(q).overview, q).toBe(true);
    }
  });

  it("treats questions with a topic as searches", () => {
    for (const q of [
      "How were the LiDARs calibrated?",
      "Explain the calibration",
      "What is the range of the Avia?",
    ]) {
      expect(planQuestion(q).overview, q).toBe(false);
    }
    expect(planQuestion("Explain the calibration").asksForOverview).toBe(true);
  });

  it("knows when the topic is just the document's title", () => {
    const title = "Towards Robust UAV Tracking in GNSS-Denied Environments";
    expect(namesDocument(planQuestion("Summarise the UAV tracking paper"), title)).toBe(true);
    expect(namesDocument(planQuestion("Summarise the calibration"), title)).toBe(false);
    expect(namesDocument(planQuestion("Which UAV was used?"), title)).toBe(false); // not an overview request
  });
});

describe("selectOverviewChunks", () => {
  const chunks = [
    { index: 0, heading: "Abstract", content: "We present a dataset." },
    { index: 1, heading: "I. Introduction", content: "Drones are everywhere." },
    { index: 2, heading: "II. Method", content: "We recorded data." },
    { index: 3, heading: "II. Method", content: "Sensor: A; Range: 1 m\nSensor: B; Range: 2 m" },
    { index: 4, heading: "III. Results", content: "It worked well." },
    { index: 5, heading: "IV. Conclusion", content: "In conclusion, it works." },
    { index: 6, heading: "References", content: "[1] Someone. 2020." },
  ];

  it("takes abstract, introduction and conclusion first, never references, in document order", () => {
    expect(selectOverviewChunks(chunks, null, 3)).toEqual([0, 1, 5]);
    const all = selectOverviewChunks(chunks, null, 10);
    expect(all).not.toContain(6);
    expect(all).not.toContain(3); // table rows don't make a gist
    expect(all).toEqual([...all].sort((a, b) => a - b));
  });

  it("includes the chunks key points came from", () => {
    const summary = {
      abstract: null,
      outline: [],
      keyPoints: [{ text: "It worked well.", chunkIndex: 4, page: null }],
    };
    expect(selectOverviewChunks(chunks, summary, 4)).toEqual([0, 1, 4, 5]);
  });
});

describe("summarizeDocument", () => {
  const blocks: Block[] = [
    { kind: "heading", text: "Abstract", level: 1, page: 1 },
    {
      kind: "paragraph",
      text: "We present a dataset of drone flights recorded with three LiDAR sensors.",
      page: 1,
    },
    { kind: "heading", text: "1 Introduction", level: 1, page: 1 },
    {
      kind: "paragraph",
      text: "Tracking drones with LiDAR sensors is difficult because point clouds are sparse. Our main contribution is a dataset that covers indoor and outdoor flights.",
      page: 1,
    },
    { kind: "heading", text: "1.1 Scope", level: 2, page: 2 },
    {
      kind: "paragraph",
      text: "The dataset covers three drones of different sizes flying indoor and outdoor trajectories.",
      page: 2,
    },
    { kind: "heading", text: "References", level: 1, page: 3 },
    {
      kind: "paragraph",
      text: "[1] A long reference entry about drones and LiDAR sensors that should never be a key point.",
      page: 3,
    },
  ];
  const chunks = chunkBlocks(blocks, { maxChars: 400, minChars: 50 });
  const summary = summarizeDocument(blocks, chunks, 3);

  it("keeps the abstract, the outline with pages, and key points linked to chunks", () => {
    expect(summary.abstract).toBe(
      "We present a dataset of drone flights recorded with three LiDAR sensors.",
    );
    expect(summary.outline.map((o) => [o.heading, o.level, o.page])).toEqual([
      ["Abstract", 1, 1],
      ["1 Introduction", 1, 1],
      ["1.1 Scope", 2, 2],
      ["References", 1, 3],
    ]);
    expect(summary.keyPoints.length).toBeGreaterThan(0);
    for (const point of summary.keyPoints) {
      expect(point.text).not.toMatch(/^\[1\]|We present a dataset/); // no references, no abstract repeats
      expect(chunks[point.chunkIndex!].content).toContain(point.text);
    }
  });

  it("round-trips through JSON and rejects junk", () => {
    expect(parseSummary(JSON.stringify(summary))).toEqual(summary);
    expect(parseSummary("not json")).toBeNull();
    expect(parseSummary(null)).toBeNull();
  });
});

describe("locations", () => {
  it("formats pages and builds links", () => {
    expect(formatPages(4, 4)).toBe("p. 4");
    expect(formatPages(4, 5)).toBe("pp. 4–5");
    expect(formatPages(null, null)).toBe("");
    expect(fileHref("d1", 4)).toBe("/api/documents/d1/file#page=4");
    expect(fileHref("d1")).toBe("/api/documents/d1/file");
    expect(passageHref("d1", 0)).toBe("/documents/d1#s1");
  });

  it("tidies headings for display", () => {
    expect(lastHeading("III. SYSTEM OVERVIEW › C. Sensor Calibration")).toBe(
      "C. Sensor Calibration",
    );
    expect(lastHeading(null)).toBeNull();
    expect(displayHeading("III. SYSTEM OVERVIEW")).toBe("III. System Overview");
    expect(displayHeading("C. Sensor Calibration")).toBe("C. Sensor Calibration");
  });
});

describe("prompt", () => {
  it("labels each source with its section and pages", () => {
    const source = {
      index: 2,
      documentTitle: "Paper",
      chunkIndex: 5,
      content: "Body.",
      heading: "II › B. Setup",
      pageStart: 3,
      pageEnd: 4,
    };
    expect(formatSource(source)).toBe('[2] "Paper" — II › B. Setup, pp. 3–4\nBody.');
    expect(buildUserPrompt("Q?", [source])).toMatch(/^SOURCES:\n\n\[2\][\s\S]*QUESTION: Q\?$/);
  });

  it("has separate instructions for overviews", () => {
    expect(systemPromptFor("overview")).toMatch(/overview/);
    expect(systemPromptFor("answer")).not.toEqual(systemPromptFor("overview"));
    expect(systemPromptFor()).toMatch(/answer the question directly/i);
  });
});
