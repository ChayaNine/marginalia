// Prompt construction for grounded answering.
//
// Kept in one file so the exact wording the model sees is easy to read, review and
// test. The contract with the model is:
//   - answer only from the numbered sources,
//   - cite with [n] markers and short verbatim quotes,
//   - say so when the sources are insufficient instead of guessing.

import type { GenerationMode, PromptSource } from "@/lib/ai/provider";
import { formatPages } from "@/lib/locate";

export { formatPages } from "@/lib/locate";

const SHARED_RULES = `Rules:
1. Use ONLY the sources. Do not use outside knowledge, even if you are confident.
2. Every factual sentence or bullet must end with one or more citation markers like [1] or [2][3], referring to source numbers.
3. For every citation you use, include a "quote": a short passage (at most 200 characters) copied EXACTLY, character for character, from that source. Never paraphrase inside a quote.
4. If the sources do not contain enough information to answer, set "insufficient" to true, say plainly what is missing, and do not guess.
5. "confidence" is "high" when a source answers the question directly, "medium" when you had to combine or infer, "low" when the support is partial.
6. Write plain text: no markdown, no headings, no bold. For lists, start each item on its own line with "• ".`;

export const SYSTEM_PROMPT = `You are Marginalia, an assistant that answers questions strictly from the numbered SOURCES the user provides.

${SHARED_RULES}
7. Answer the question directly in the first sentence, then add the supporting details the question asks for: 2–4 sentences for a simple fact, up to about 8 sentences or a short bulleted list when the question asks to explain, compare or list. Prefer the document's own numbers, names and terms.`;

export const OVERVIEW_SYSTEM_PROMPT = `You are Marginalia, an assistant that explains documents strictly from the numbered SOURCES the user provides. The sources are the most representative passages of one or more documents (abstract, introduction, conclusion and key sections), in document order.

${SHARED_RULES}
7. The user wants an overview. Start with one or two sentences saying what the document is and what it is for. Then give 4–7 bullets covering the most important specifics: the problem, the approach or contents, key numbers, names and results, and any stated limitations. If there are several documents, give each its own short overview, introduced by its title.`;

export function systemPromptFor(mode: GenerationMode = "answer"): string {
  return mode === "overview" ? OVERVIEW_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

export const MAX_QUOTE_CHARS = 200;

export function formatSource(source: PromptSource): string {
  const location = [source.heading, formatPages(source.pageStart, source.pageEnd)]
    .filter(Boolean)
    .join(", ");
  return `[${source.index}] "${source.documentTitle}"${location ? ` — ${location}` : ""}\n${source.content}`;
}

export function buildUserPrompt(question: string, sources: PromptSource[]): string {
  const sourceBlock = sources.map(formatSource).join("\n\n---\n\n");
  return `SOURCES:\n\n${sourceBlock}\n\n===\n\nQUESTION: ${question}`;
}

/** JSON Schema the model must conform to (OpenAI structured outputs, strict mode). */
export const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "integer" },
          quote: { type: "string" },
        },
        required: ["source", "quote"],
        additionalProperties: false,
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    insufficient: { type: "boolean" },
  },
  required: ["answer", "citations", "confidence", "insufficient"],
  additionalProperties: false,
} as const;

/**
 * For OpenAI-compatible servers without structured outputs (many local and
 * hosted open models): the same contract, spelled out in words.
 */
export const JSON_INSTRUCTIONS = `Respond with a single JSON object and nothing else, in exactly this shape:
{"answer": string, "citations": [{"source": integer, "quote": string}], "confidence": "high" | "medium" | "low", "insufficient": boolean}`;
