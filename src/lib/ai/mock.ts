// Mock provider: deterministic, offline, free.
//
// Not a toy that returns "lorem ipsum" — a small *lexical* stand-in for a real
// model, so the whole product can be used and tested without a key:
//
//   embed()    → a hashed bag-of-words vector (512 dims, L2-normalised) over the
//                same stemmed tokens keyword search uses. Texts that share
//                vocabulary get a high cosine similarity.
//   generate() → extractive. For a question: scores every sentence of the sources
//                by how much of the question's (rarity-weighted) vocabulary it
//                covers, answers with the best one to three sentences verbatim and
//                cites them; reports `insufficient` when nothing covers enough of
//                the question. For an overview: picks the most representative,
//                mutually different sentences (lib/text/salience.ts) as bullets.
//
// It cannot paraphrase, infer or combine facts the way an LLM does — that is what
// a real model is for. Because it is deterministic, tests can assert exact output.

import type {
  AIProvider,
  GenerationRequest,
  GenerationResult,
  PromptSource,
  RawCitation,
} from "./provider";
import type { Confidence } from "@/lib/status";
import { planQuestion } from "@/lib/rag/overview";
import { normalize } from "@/lib/rag/similarity";
import { CUE_PHRASES, pickSalient } from "@/lib/text/salience";
import { splitSentences, wordCount } from "@/lib/text/sentences";
import { tokenize } from "@/lib/text/tokenize";

export { tokenize } from "@/lib/text/tokenize";

export const MOCK_EMBEDDING_MODEL = "mock-hash-v2";
export const MOCK_CHAT_MODEL = "mock-extractive-v2";
export const MOCK_DIMENSIONS = 512;

/** FNV-1a: tiny, fast, and stable across runs and machines. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function mockEmbed(text: string): Float32Array {
  const vector = new Float32Array(MOCK_DIMENSIONS);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    vector[fnv1a(tokens[i]) % MOCK_DIMENSIONS] += 1;
    if (i + 1 < tokens.length) {
      // Bigrams add a little word-order signal.
      vector[fnv1a(`${tokens[i]}_${tokens[i + 1]}`) % MOCK_DIMENSIONS] += 0.5;
    }
  }
  return normalize(vector);
}

type Sentence = {
  source: number;
  text: string;
  tokens: Set<string>;
  /** Tokens of the sentences just before and after it in the same passage. */
  contextTokens: Set<string>;
  /** Tokens of the source's section heading. */
  headingTokens: Set<string>;
  /** Position within its source, and overall. */
  local: number;
  position: number;
};

function sentencesOf(sources: PromptSource[]): Sentence[] {
  const out: Sentence[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const headingTokens = new Set(tokenize(source.heading ?? ""));
    // Headings folded into chunks and stray labels are not sentences.
    const texts = splitSentences(source.content).filter((t) => wordCount(t) >= 3);
    const tokens = texts.map((t) => new Set(tokenize(t)));
    texts.forEach((text, local) => {
      // Overlapping passages repeat a sentence; keep the copy in the better-ranked one.
      if (seen.has(text)) return;
      seen.add(text);
      const contextTokens = new Set([...(tokens[local - 1] ?? []), ...(tokens[local + 1] ?? [])]);
      out.push({
        source: source.index,
        text,
        tokens: tokens[local],
        contextTokens,
        headingTokens,
        local,
        position: out.length,
      });
    });
  }
  return out;
}

const INSUFFICIENT: GenerationResult = {
  answer: "The provided documents do not contain enough information to answer this question.",
  citations: [],
  confidence: "low",
  insufficient: true,
  model: MOCK_CHAT_MODEL,
};

/** Share of the question's weight a sentence must cover to count as an answer. */
const MIN_COVERAGE = 0.5;
// "How do I…", "why…", "explain…" want the reasoning; "how much / how long" want a fact.
const EXPLANATORY =
  /\b(explain|describe|why|details?|elaborate|walk me through)\b|\bhow (do|does|did|is|are|was|were|can|could|should|would|to)\b/i;
const QUANTITATIVE =
  /\b(how (many|much|long|far|fast|big|large|often)|what (is|was|are|were) the \w*\s*(range|rate|error|rmse|accuracy|size|speed|frequency|resolution|number|value|count|percentage|time|duration|distance|length|weight|cost|price|fee|score))\b|\b(rmse|accuracy|percentage|frequency|resolution)\b/i;

// Words that carry the *shape* of a question rather than its subject ("how is X
// handled", "which method worked best"). They count, but little: documents
// rarely repeat them.
const FILLER = new Set(
  tokenize(`handle handled work worked works use using perform performed performs do done make made provide
  provided include included includes contain contains consist consists involve involved mean happen happened
  obtain obtained get got take taken achieve achieved store stored keep kept need needed require required
  support supported affect affected compare compared differ different difference between among during within
  against best better most many much long often various type types kind kinds way ways exactly actually really
  currently specific specifically record recorded`),
);

/** "What computer…", "Which UAVs…", "What is the range of…" → the thing asked about. */
function focusToken(question: string): string | null {
  const m =
    /\b(?:what|which|how many|how much)\s+(?:(?:is|are|was|were|does|do|did)\s+)?(?:(?:the|a|an)\s+)?([\p{L}\p{N}-]+)/iu.exec(
      question,
    );
  const token = m ? tokenize(m[1])[0] : undefined;
  return token ?? null;
}

function answerQuestion(request: GenerationRequest): GenerationResult {
  const plan = planQuestion(request.question);
  const terms =
    plan.topicTokens.length > 0 ? plan.topicTokens : [...new Set(tokenize(request.question))];
  const sentences = sentencesOf(request.sources);
  if (terms.length === 0 || sentences.length === 0) return INSUFFICIENT;

  // Rare words matter more: in "which tracking method worked best on the Livox
  // Avia?", "Avia" says far more than "method". A question word found nowhere in
  // the sources still counts (with an average weight): a sentence that only
  // matches "fee" does not answer "what is the parking permit fee?".
  const n = sentences.length;
  const weight = new Map<string, number>();
  for (const t of terms) {
    const df = sentences.filter((s) => s.tokens.has(t) || s.headingTokens.has(t)).length;
    if (df > 0) weight.set(t, Math.log(1 + n / df));
  }
  if (weight.size === 0) return INSUFFICIENT;
  const meanWeight = [...weight.values()].reduce((a, b) => a + b, 0) / weight.size;
  const focus = focusToken(request.question);
  for (const t of terms) {
    let w = weight.get(t) ?? meanWeight;
    if (FILLER.has(t)) w *= 0.3;
    else if (t === focus) w *= 1.5;
    weight.set(t, w);
  }
  const total = terms.reduce((sum, t) => sum + (weight.get(t) ?? 0), 0);
  // Sources arrive best match first; break near-ties in favour of the better passage.
  const prior = (s: Sentence) => 1 + 0.08 * Math.max(0, 3 - s.source);

  /**
   * Share of the question's weight a sentence covers. Indirect evidence — the
   * section heading is about it, or the neighbouring sentence mentions it —
   * counts partly when choosing the best sentence, but not when deciding whether
   * another sentence adds anything.
   */
  const coverage = (s: Sentence, alreadyCovered: Set<string> = new Set(), indirect = true) => {
    let score = 0;
    for (const t of terms) {
      if (alreadyCovered.has(t)) continue;
      const w = weight.get(t) ?? 0;
      if (s.tokens.has(t)) score += w;
      else if (indirect && s.headingTokens.has(t)) score += w * 0.6;
      else if (indirect && s.contextTokens.has(t)) score += w * 0.4;
    }
    return total > 0 ? score / total : 0;
  };

  const ranked = sentences
    .map((s) => ({ s, score: coverage(s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score * prior(b.s) - a.score * prior(a.s) || a.s.position - b.s.position);
  const best = ranked[0];
  if (!best || best.score < MIN_COVERAGE) return INSUFFICIENT;

  // Then at most two more: sentences that cover question words the first did
  // not, and — for "explain/how/why" questions — the sentence that follows the
  // best one, which usually carries the explanation.
  const picked: Sentence[] = [best.s];
  const covered = new Set(terms.filter((t) => best.s.tokens.has(t)));
  for (const { s } of ranked.slice(1)) {
    if (picked.length >= 3) break;
    if (coverage(s, covered, false) >= 0.15 && coverage(s, new Set(), false) >= 0.3) {
      picked.push(s);
      for (const t of terms) if (s.tokens.has(t)) covered.add(t);
    }
  }
  // The sentence after the best one, when the question asks for an explanation,
  // or asks for a number the best sentence does not contain ("we computed the
  // error as follows." → "The RMSE was 0.0143 m.").
  const next = sentences.find((s) => s.source === best.s.source && s.local === best.s.local + 1);
  if (next && picked.length < 3 && !picked.includes(next) && wordCount(next.text) >= 4) {
    const wantsNumber =
      QUANTITATIVE.test(request.question) && !/\d/.test(best.s.text) && /\d/.test(next.text);
    if (wantsNumber || EXPLANATORY.test(request.question)) picked.push(next);
  }

  picked.sort((a, b) => a.position - b.position);
  const citations: RawCitation[] = picked.map((s) => ({ source: s.source, quote: s.text }));
  const answer = picked.map((s) => `${s.text} [${s.source}]`).join(" ");
  const confidence: Confidence = best.score >= 0.75 ? "high" : best.score >= 0.5 ? "medium" : "low";
  return { answer, citations, confidence, insufficient: false, model: MOCK_CHAT_MODEL };
}

const ABSTRACT = /(^|› )(abstract|summary|executive summary|overview)$/i;
const CONCLUSION = /\b(conclusions?|concluding|summary|discussion)\b/i;
const INTRO = /\b(introduction|background)\b/i;
/** Links, e-mail addresses, reference entries, table rows ("Range: 120 m; FoV: 360°"). */
const NOT_PROSE = /https?:\/\/|@\w+\.\w|^\[\d+\]|^[^.;]{1,40}: [^;]*;/;
const MEASUREMENT =
  /\d(\.\d+)?\s?(%|percent|m\b|cm\b|km\b|hz\b|ms\b|s\b|kg\b|°|x\b|times\b|fps\b|gb\b|mb\b|\$|£|€)|[$£€]\s?\d/i;
const ENDS_LIKE_SENTENCE = /[.!?]["'”’)\]]*$/;
/** "(iii) Based on…" → "Based on…" (the remainder is still a verbatim quote). */
const ENUMERATOR = /^(\(?([ivx]{1,4}|\d{1,2}|[a-h])\)|[•\-–]\s)\s*/i;

function overview(request: GenerationRequest): GenerationResult {
  // Group passages by document, keeping their order.
  const documents = new Map<string, PromptSource[]>();
  for (const source of request.sources) {
    documents.set(source.documentTitle, [...(documents.get(source.documentTitle) ?? []), source]);
  }
  const perDocument = documents.size === 1 ? 6 : 3;

  const lines: string[] = [];
  const citations: RawCitation[] = [];
  const cite = (s: Sentence) => {
    const text = s.text.replace(ENUMERATOR, "");
    citations.push({ source: s.source, quote: text });
    return `${text} [${s.source}]`;
  };

  for (const [title, sources] of documents) {
    const headingOf = (s: Sentence) => sources.find((p) => p.index === s.source)?.heading ?? "";
    const sentences = sentencesOf(sources).filter((s) => {
      const words = wordCount(s.text);
      return (
        words >= 8 && words <= 60 && ENDS_LIKE_SENTENCE.test(s.text) && !NOT_PROSE.test(s.text)
      );
    });
    if (sentences.length === 0) continue;

    // Lead with what the document says it is: the first sentence of its
    // abstract, or else of its opening passage (after any title/author block).
    const firstOf = (source: PromptSource | undefined) => {
      if (!source) return undefined;
      const afterHeading = /^(abstract|summary|executive summary)\s*$/im.exec(source.content);
      const body = afterHeading
        ? source.content.slice(afterHeading.index + afterHeading[0].length)
        : source.content;
      const first = splitSentences(body).find((t) =>
        sentences.some((s) => s.source === source.index && s.text === t),
      );
      return sentences.find((s) => s.source === source.index && s.text === first);
    };
    const lead =
      firstOf(sources.find((p) => ABSTRACT.test(p.heading ?? ""))) ??
      firstOf(sources.find((p) => p.chunkIndex === 0));
    const rest = sentences.filter((s) => s !== lead);
    const inputs = rest.map((s) => {
      const heading = headingOf(s);
      let bonus = 1;
      if (ABSTRACT.test(heading)) bonus *= 1.3;
      else if (CONCLUSION.test(heading)) bonus *= 1.2;
      else if (INTRO.test(heading)) bonus *= 1.1;
      if (CUE_PHRASES.test(s.text)) bonus *= 1.25;
      if (MEASUREMENT.test(s.text)) bonus *= 1.2; // concrete results are the "crucial details"
      if (s.local === 0) bonus *= 1.05;
      return { text: s.text, bonus };
    });
    const picked = pickSalient(inputs, lead ? perDocument - 1 : perDocument).map((i) => rest[i]);

    if (documents.size > 1) lines.push(`${lines.length ? "\n" : ""}${title}`);
    if (lead) lines.push(cite(lead));
    if (picked.length) lines.push((lead ? "\n" : "") + "Key points:");
    for (const s of picked) lines.push(`• ${cite(s)}`);
  }

  if (citations.length === 0) return INSUFFICIENT;
  return {
    answer: lines.join("\n").trim(),
    citations,
    confidence: "medium",
    insufficient: false,
    model: MOCK_CHAT_MODEL,
  };
}

export function createMockProvider(): AIProvider {
  return {
    name: "mock",
    embeddingModel: MOCK_EMBEDDING_MODEL,
    chatModel: MOCK_CHAT_MODEL,
    // Hashed bag-of-words cosines are small in absolute terms; anything above this
    // shares real vocabulary with the question.
    relevanceThreshold: 0.05,
    async embed(texts) {
      return texts.map(mockEmbed);
    },
    async generate(request) {
      return request.mode === "overview" ? overview(request) : answerQuestion(request);
    },
  };
}
