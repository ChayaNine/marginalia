// The answering pipeline, with no database in it.
//
//   question ─┬─ about a whole document? ──▶ overview passages ─────────────┐
//             └─ specific ──embed──▶ hybrid search ──▶ relevance gate ───────┴─▶ model ──verify──▶ result
//
// The retriever is injected, so this module is unit-tested with an in-memory one;
// src/lib/rag/retrieve.ts supplies the Prisma-backed one.

import type { AIProvider, GenerationMode } from "@/lib/ai/provider";
import { ValidationError } from "@/lib/errors";
import type { Confidence } from "@/lib/status";
import { resolveCitations, type ResolvedCitation, type RetrievedChunk } from "./citations";
import { namesDocument, planQuestion } from "./overview";

export const MAX_QUESTION_CHARS = 2000;
export const DEFAULT_TOP_K = 8;

/**
 * A passage passes the relevance gate when its embedding is close enough to the
 * question's (provider-specific threshold), or it contains at least this share
 * of the question's keywords (IDF-weighted).
 */
export const KEYWORD_GATE = 0.5;

/** Overview questions cover at most this many documents… */
export const MAX_OVERVIEW_DOCUMENTS = 3;
/** …with this many passages per document, by number of documents. */
const OVERVIEW_PASSAGES = [8, 5, 4];

export type SearchOptions = { k: number; query: string; documentIds?: string[] };
export type ScopeDocument = { id: string; title: string };

export interface Retriever {
  /** The k best passages for a question, best first. */
  search(queryVector: Float32Array, options: SearchOptions): Promise<RetrievedChunk[]>;
  /** Searchable documents in scope (all, or the given ids), newest first. */
  documents?(documentIds?: string[]): Promise<ScopeDocument[]>;
  /** Passages that give the gist of each document, in document order. */
  overview?(documentIds: string[], perDocument: number): Promise<RetrievedChunk[]>;
}

export type AnswerResult = {
  question: string;
  answer: string;
  /** "overview" when the question was about a document as a whole. */
  mode: GenerationMode;
  confidence: Confidence;
  insufficient: boolean;
  model: string;
  citations: ResolvedCitation[];
  /** Every passage the model was shown: best match first, or document order for overviews. */
  sources: RetrievedChunk[];
  /** Something the reader should know about how the question was handled. */
  notice: string | null;
  timings: { embedMs: number; retrieveMs: number; generateMs: number };
};

export type AnswerParams = {
  question: string;
  provider: AIProvider;
  retriever: Retriever;
  documentIds?: string[];
  topK?: number;
};

export function cleanQuestion(raw: string): string {
  const question = raw.replace(/\s+/g, " ").trim();
  if (question.length === 0) throw new ValidationError("Question is empty");
  if (question.length > MAX_QUESTION_CHARS) {
    throw new ValidationError(`Question is longer than ${MAX_QUESTION_CHARS} characters`);
  }
  return question;
}

export async function answerQuestion(params: AnswerParams): Promise<AnswerResult> {
  const question = cleanQuestion(params.question);
  const { provider, retriever, documentIds } = params;
  const k = params.topK ?? DEFAULT_TOP_K;
  const timings = { embedMs: 0, retrieveMs: 0, generateMs: 0 };

  let mode: GenerationMode = "answer";
  let notice: string | null = null;
  let sources: RetrievedChunk[] = [];

  // 1. Is this about a document as a whole? ("summarise", "what is this paper
  //    about", "explain the crucial details", "key points of the UAV paper")
  const plan = planQuestion(question);
  if ((plan.overview || plan.asksForOverview) && retriever.documents && retriever.overview) {
    const t0 = performance.now();
    const inScope = await retriever.documents(documentIds);
    let targets = plan.overview ? inScope : inScope.filter((d) => namesDocument(plan, d.title));
    if (targets.length > MAX_OVERVIEW_DOCUMENTS) {
      notice = `This is an overview of the ${MAX_OVERVIEW_DOCUMENTS} most recently added documents. Choose documents under “Search in” to summarise others.`;
      targets = targets.slice(0, MAX_OVERVIEW_DOCUMENTS);
    }
    if (targets.length > 0) {
      sources = await retriever.overview(
        targets.map((d) => d.id),
        OVERVIEW_PASSAGES[targets.length - 1],
      );
      if (sources.length > 0) mode = "overview";
      else notice = null;
    }
    timings.retrieveMs += performance.now() - t0;
  }

  // 2. Otherwise, search for the passages that answer it.
  if (mode === "answer") {
    const t0 = performance.now();
    const [queryVector] = await provider.embed([question]);
    const t1 = performance.now();
    const candidates = await retriever.search(queryVector, { k, query: question, documentIds });
    sources = candidates.filter(
      (c) => c.vectorScore >= provider.relevanceThreshold || c.keywordScore >= KEYWORD_GATE,
    );
    timings.embedMs = t1 - t0;
    timings.retrieveMs += performance.now() - t1;
  }

  if (sources.length === 0) {
    // Nothing worth showing the model: don't spend a call on it.
    return {
      question,
      answer:
        "I couldn't find anything in your documents that relates to this question. Try different wording — the words the document itself would use — or upload a document that covers this topic.",
      mode,
      confidence: "low",
      insufficient: true,
      model: provider.chatModel,
      citations: [],
      sources: [],
      notice,
      timings,
    };
  }

  const t0 = performance.now();
  const generation = await provider.generate({
    question,
    mode,
    sources: sources.map((chunk, i) => ({
      index: i + 1,
      documentTitle: chunk.documentTitle,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      heading: chunk.heading,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    })),
  });
  timings.generateMs = performance.now() - t0;

  return {
    question,
    answer: generation.answer.trim(),
    mode,
    confidence: generation.confidence,
    insufficient: generation.insufficient,
    model: generation.model,
    citations: resolveCitations(generation.citations, sources),
    sources,
    notice,
    timings,
  };
}
