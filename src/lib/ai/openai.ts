// OpenAI provider — and, through OPENAI_BASE_URL, any OpenAI-compatible server
// (Ollama, LM Studio, Groq, OpenRouter, Gemini's compatibility endpoint…).
//
// Embeddings: text-embedding-3-small (1536 dims, cheap) by default.
// Generation: gpt-4o-mini with Structured Outputs, so the model *must* return the
// JSON shape in prompt.ts — no regex-scraping of prose.
//
// Not every compatible server supports Structured Outputs, so generation degrades
// step by step and remembers what worked:
//   json_schema (strict)  →  json_object + the shape described in words
//                         →  plain text, JSON extracted from the reply
//
// Failure handling, in order:
//   - 429 / 5xx / network errors → retried with exponential backoff (3 attempts)
//   - 401 → "invalid key", 402/insufficient_quota → "out of credit" (not retried)
//   - anything else → AIProviderError (HTTP 502 to the browser) with a readable message

import OpenAI, { APIConnectionError, APIError } from "openai";
import { z } from "zod";
import type { AIProvider, GenerationRequest, GenerationResult } from "./provider";
import { AIProviderError } from "@/lib/errors";
import {
  ANSWER_JSON_SCHEMA,
  JSON_INSTRUCTIONS,
  buildUserPrompt,
  systemPromptFor,
} from "@/lib/rag/prompt";
import { confidenceSchema } from "@/lib/status";

// Strict for real Structured Outputs; tolerant of the small liberties other models
// take in JSON mode ("1" for 1, "High" for "high", a missing citations array).
const generationOutputSchema = z.object({
  answer: z.string(),
  citations: z
    .array(z.object({ source: z.coerce.number().int(), quote: z.coerce.string() }))
    .default([]),
  confidence: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
    confidenceSchema,
  ),
  insufficient: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
    .default(false),
});

/** How a server is asked for JSON, most to least strict. */
export type JsonMode = "json_schema" | "json_object" | "prompt";

export type OpenAIProviderOptions = {
  apiKey: string;
  /** An OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 for Ollama. */
  baseURL?: string;
  /** Start from a less strict JSON mode (skips the probing on servers known to need it). */
  jsonMode?: JsonMode;
  chatModel: string;
  embeddingModel: string;
  /** Inputs per embeddings request. OpenAI allows 2048; smaller batches keep payloads modest. */
  embeddingBatchSize?: number;
  /** Override for tests. */
  client?: OpenAI;
};

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export function createOpenAIProvider(options: OpenAIProviderOptions): AIProvider {
  const client =
    options.client ??
    new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 0 });
  const batchSize = options.embeddingBatchSize ?? 64;
  let jsonMode: JsonMode = options.jsonMode ?? "json_schema";

  const complete = (request: GenerationRequest, mode: JsonMode) => {
    const system =
      systemPromptFor(request.mode) + (mode === "json_schema" ? "" : `\n\n${JSON_INSTRUCTIONS}`);
    return client.chat.completions.create({
      model: options.chatModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserPrompt(request.question, request.sources) },
      ],
      ...(mode === "json_schema"
        ? {
            response_format: {
              type: "json_schema" as const,
              json_schema: { name: "grounded_answer", strict: true, schema: ANSWER_JSON_SCHEMA },
            },
          }
        : mode === "json_object"
          ? { response_format: { type: "json_object" as const } }
          : {}),
    });
  };

  return {
    name: "openai",
    embeddingModel: options.embeddingModel,
    chatModel: options.chatModel,
    // text-embedding-3 cosines: unrelated text sits around 0.0–0.2, on-topic text
    // above ~0.3. We gate low on purpose and let the model do the fine judgement.
    relevanceThreshold: 0.15,

    async embed(texts) {
      const out: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const response = await withRetry(() =>
          client.embeddings.create({
            model: options.embeddingModel,
            input: batch,
            encoding_format: "float",
          }),
        );
        // The API returns items with an `index`; sort defensively instead of trusting order.
        const sorted = [...response.data].sort((a, b) => a.index - b.index);
        if (sorted.length !== batch.length) {
          throw new AIProviderError(
            `Embedding response had ${sorted.length} vectors for ${batch.length} inputs`,
          );
        }
        for (const item of sorted) out.push(Float32Array.from(item.embedding));
      }
      return out;
    },

    async generate(request: GenerationRequest): Promise<GenerationResult> {
      let completion: Awaited<ReturnType<typeof complete>>;
      for (;;) {
        try {
          const mode = jsonMode;
          completion = await withRetry(() => complete(request, mode), { raw: true });
          break;
        } catch (error) {
          // A server that rejects the response_format: try the next, looser mode.
          const next =
            jsonMode === "json_schema"
              ? "json_object"
              : jsonMode === "json_object"
                ? "prompt"
                : null;
          if (next && isUnsupportedFormat(error)) {
            jsonMode = next;
            continue;
          }
          throw toProviderError(error);
        }
      }

      const choice = completion.choices[0];
      if (!choice) throw new AIProviderError("The model returned no choices");
      if (choice.message.refusal) {
        throw new AIProviderError(`The model refused to answer: ${choice.message.refusal}`);
      }
      if (choice.finish_reason === "length") {
        throw new AIProviderError("The model's answer was cut off (token limit reached)");
      }

      const content = choice.message.content;
      if (!content) throw new AIProviderError("The model returned an empty response");

      const parsedJson = parseJsonReply(content);
      if (parsedJson === undefined) {
        throw new AIProviderError("The model returned malformed JSON", {
          content: content.slice(0, 500),
        });
      }

      const parsed = generationOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new AIProviderError("The model's JSON did not match the expected shape", {
          issues: parsed.error.issues,
        });
      }

      return { ...parsed.data, model: completion.model ?? options.chatModel };
    },
  };
}

/** 400s that mean "this server doesn't do that response_format". */
function isUnsupportedFormat(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const status = error.status ?? 0;
  if (status !== 400 && status !== 422 && status !== 501) return false;
  return /response_format|json_schema|json_object|structured|schema|not supported|unsupported/i.test(
    error.message,
  );
}

/**
 * JSON from a reply that may wrap it in prose or a ``` fence (common in
 * plain-text mode). Returns undefined when there is no parseable object.
 */
export function parseJsonReply(content: string): unknown {
  const attempts = [content.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  if (fenced) attempts.push(fenced[1].trim());
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(content.slice(first, last + 1));
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof APIConnectionError) return true;
  if (error instanceof APIError) {
    const status = error.status ?? 0;
    if (status === 429 && error.code === "insufficient_quota") return false; // won't fix itself
    return status === 429 || status >= 500;
  }
  return false;
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof APIError) {
    const status = error.status ?? 0;
    if (status === 401)
      return new AIProviderError("The model API rejected the API key (401). Check OPENAI_API_KEY.");
    if (status === 429 && error.code === "insufficient_quota") {
      return new AIProviderError("The model API account is out of credit (insufficient_quota).");
    }
    if (status === 429)
      return new AIProviderError("The model API rate limit was hit; please retry in a moment.");
    if (status === 404) {
      return new AIProviderError(
        `Model or endpoint not found (404) — check OPENAI_CHAT_MODEL / OPENAI_EMBEDDING_MODEL / OPENAI_BASE_URL: ${error.message}`,
      );
    }
    return new AIProviderError(`Model API error (${status || "network"}): ${error.message}`);
  }
  if (error instanceof Error)
    return new AIProviderError(`Model API request failed: ${error.message}`);
  return new AIProviderError("Model API request failed");
}

/** Exported for tests. Retries only transient failures; everything else is rethrown wrapped. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Rethrow the last error as-is instead of wrapping it (the caller inspects it). */
    raw?: boolean;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const baseDelay = opts.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
  throw opts.raw ? lastError : toProviderError(lastError);
}
