// The AI provider seam.
//
// Everything that talks to a model goes through this interface. Two
// implementations exist:
//   - openai.ts  → real embeddings + chat completions (needs OPENAI_API_KEY)
//   - mock.ts    → deterministic, offline, free; used by tests and by "demo mode"
//
// The rest of the app (ingestion, retrieval, answering, routes, UI) never imports
// the OpenAI SDK directly, which is what makes the pipeline testable without
// network access and what would make swapping in another vendor a one-file change.

import type { Confidence } from "@/lib/status";
import type { ProviderName } from "@/lib/env";

/** A retrieved passage as presented to the model, numbered from 1. */
export type PromptSource = {
  index: number;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  /** Section path, e.g. "III. System Overview › C. Sensor Calibration". */
  heading?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
};

/**
 * "answer"   – a specific question; answer it from the passages.
 * "overview" – "what is this about / summarise / key points": the passages are a
 *              document's abstract, introduction, conclusion and most
 *              representative sections, and the answer is a structured overview.
 */
export type GenerationMode = "answer" | "overview";

export type GenerationRequest = {
  question: string;
  sources: PromptSource[];
  mode?: GenerationMode;
};

export type RawCitation = {
  /** 1-based index into GenerationRequest.sources. */
  source: number;
  /** Verbatim snippet the model claims to have copied from that source. */
  quote: string;
};

export type GenerationResult = {
  answer: string;
  citations: RawCitation[];
  confidence: Confidence;
  /** The model judged the sources insufficient to answer. */
  insufficient: boolean;
  /** Identifier of the model that produced this, stored with the Answer. */
  model: string;
};

export interface AIProvider {
  readonly name: ProviderName;
  readonly embeddingModel: string;
  readonly chatModel: string;
  /**
   * Minimum cosine similarity for a chunk to be shown to the model at all.
   * Below this we skip generation entirely and report "nothing relevant found".
   */
  readonly relevanceThreshold: number;

  /** Embeds each text; result[i] corresponds to texts[i]. */
  embed(texts: string[]): Promise<Float32Array[]>;

  /** Produces a grounded answer for a question given numbered sources. */
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
