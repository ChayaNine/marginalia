// The answering pipeline, end to end, with an in-memory retriever and the mock
// provider. No database, no network.

import { describe, expect, it } from "vitest";
import type { AIProvider } from "@/lib/ai/provider";
import { createMockProvider } from "@/lib/ai/mock";
import { ValidationError } from "@/lib/errors";
import { answerQuestion, cleanQuestion, type Retriever } from "@/lib/rag/answer";
import type { RetrievedChunk } from "@/lib/rag/citations";
import { selectOverviewChunks } from "@/lib/rag/overview";
import { rankChunks, type RankCandidate } from "@/lib/rag/rank";

const passages = [
  {
    heading: "Quiet hours",
    content:
      "Quiet hours run from 11 pm to 7 am on weekdays and from midnight to 8 am at weekends.",
  },
  {
    heading: "Pets",
    content:
      "Residents may keep one small aquarium of up to 20 litres; no other pets are permitted.",
  },
  {
    heading: "Maintenance",
    content:
      "Maintenance requests are submitted through the resident portal and acknowledged within one business day.",
  },
  {
    heading: "Kitchens",
    content: "The common kitchen on each floor is cleaned by contractors every Tuesday morning.",
  },
];

/** A retriever over in-memory passages using the provider's own embeddings and hybrid ranking. */
async function inMemoryRetriever(provider: AIProvider): Promise<Retriever> {
  const vectors = await provider.embed(passages.map((p) => `${p.heading}\n\n${p.content}`));
  const candidates: RankCandidate[] = passages.map((p, i) => ({
    chunkId: `chunk-${i}`,
    documentId: "doc-1",
    documentTitle: "Handbook",
    chunkIndex: i,
    content: p.content,
    heading: p.heading,
    pageStart: i + 1,
    pageEnd: i + 1,
    embedding: vectors[i],
  }));
  return {
    search: async (queryVector, { k, query }) => rankChunks(candidates, queryVector, query, { k }),
    documents: async () => [{ id: "doc-1", title: "Handbook" }],
    overview: async (_ids, perDocument) => {
      const picked = selectOverviewChunks(
        candidates.map((c) => ({ index: c.chunkIndex, heading: c.heading, content: c.content })),
        null,
        perDocument,
      );
      return candidates
        .filter((c) => picked.includes(c.chunkIndex))
        .map(({ embedding: _e, tokens: _t, ...c }): RetrievedChunk => ({
          ...c,
          score: 1,
          vectorScore: 0,
          keywordScore: 0,
        }));
    },
  };
}

describe("answerQuestion", () => {
  const provider = createMockProvider();

  it("retrieves the right passage, answers, and cites a verified quote with its page", async () => {
    const retriever = await inMemoryRetriever(provider);
    const result = await answerQuestion({ question: "When are quiet hours?", provider, retriever });

    expect(result.mode).toBe("answer");
    expect(result.insufficient).toBe(false);
    expect(result.sources[0].chunkIndex).toBe(0); // the quiet-hours passage ranks first
    expect(result.sources[0].score).toBeCloseTo(1); // first by both meaning and keywords
    expect(result.answer).toMatch(/Quiet hours run from 11 pm/);
    expect(result.citations[0]).toMatchObject({
      chunkId: "chunk-0",
      verified: true,
      source: 1,
      heading: "Quiet hours",
      pageStart: 1,
    });
    expect(result.model).toBe(provider.chatModel);
  });

  it("only cites chunks it was actually shown", async () => {
    const retriever = await inMemoryRetriever(provider);
    const result = await answerQuestion({
      question: "How do I submit a maintenance request?",
      provider,
      retriever,
      topK: 2,
    });
    const shown = new Set(result.sources.map((s) => s.chunkId));
    for (const c of result.citations) expect(shown.has(c.chunkId)).toBe(true);
  });

  it("skips the model entirely when nothing relevant is retrieved", async () => {
    const retriever = await inMemoryRetriever(provider);
    let generateCalls = 0;
    const spying: AIProvider = {
      ...provider,
      generate: async (req) => {
        generateCalls++;
        return provider.generate(req);
      },
    };
    const result = await answerQuestion({
      question: "zebra xylophone quasar",
      provider: spying,
      retriever,
    });
    expect(generateCalls).toBe(0);
    expect(result.insufficient).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.timings.generateMs).toBe(0);
  });

  it("answers 'summarise / explain the crucial details' from overview passages, not similarity", async () => {
    const retriever = await inMemoryRetriever(provider);
    let mode: string | undefined;
    const spying: AIProvider = {
      ...provider,
      generate: async (req) => ((mode = req.mode), provider.generate(req)),
    };

    for (const question of [
      "explain the details, crucial detail",
      "Summarise this document",
      "What is this about?",
    ]) {
      const result = await answerQuestion({ question, provider: spying, retriever });
      expect(result.mode).toBe("overview");
      expect(mode).toBe("overview");
      expect(result.insufficient).toBe(false);
      // Passages in document order, and the answer is a list of cited points.
      expect(result.sources.map((s) => s.chunkIndex)).toEqual(
        [...result.sources.map((s) => s.chunkIndex)].sort(),
      );
      expect(result.answer).toMatch(/• .+ \[\d\]/);
    }
  });

  it("still searches when an overview-sounding question names a topic", async () => {
    const retriever = await inMemoryRetriever(provider);
    const result = await answerQuestion({
      question: "Explain the pets policy",
      provider,
      retriever,
    });
    expect(result.mode).toBe("answer");
    expect(result.sources[0].chunkIndex).toBe(1);
  });

  it("falls back to search when the retriever cannot do overviews", async () => {
    const full = await inMemoryRetriever(provider);
    const searchOnly: Retriever = { search: full.search };
    const result = await answerQuestion({
      question: "Summarise quiet hours",
      provider,
      retriever: searchOnly,
    });
    expect(result.mode).toBe("answer");
  });

  it("passes the question and document filter through to the retriever", async () => {
    let received: { query?: string; documentIds?: string[] } = {};
    const retriever: Retriever = {
      search: async (_q, opts) => {
        received = opts;
        return [];
      },
    };
    await answerQuestion({
      question: "anything at all",
      provider,
      retriever,
      documentIds: ["a", "b"],
    });
    expect(received).toMatchObject({ query: "anything at all", documentIds: ["a", "b"] });
  });

  it("validates the question", () => {
    expect(() => cleanQuestion("   ")).toThrow(ValidationError);
    expect(() => cleanQuestion("x".repeat(2001))).toThrow(/longer than/);
    expect(cleanQuestion("  what \n is   this? ")).toBe("what is this?");
  });
});
