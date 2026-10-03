// "What is this document about?" — questions that similarity search answers badly.
//
// "Explain the crucial details" or "summarise this paper" contain no words that
// identify *which* passage answers them, so ranking passages by similarity to the
// question returns whatever happens to share the word "details". These questions
// need the document's own summary material instead: abstract, introduction,
// conclusion and the most representative sections.
//
// planQuestion() decides whether a question is that kind; selectOverviewChunks()
// picks the passages. Both are pure, so they are unit-tested directly.

import { tokenize } from "@/lib/text/tokenize";
import type { DocumentSummary } from "./summary";

// Words that ask for an overview, or refer to the document itself, rather than
// naming a topic. Stemmed with the same tokenizer as the question.
const OVERVIEW_WORDS = `
  summarize summarise summary summaries summarization overview overall explain explanation describe
  description detail details detailed crucial important importance key main major point points finding
  findings takeaway takeaways highlight highlights idea ideas gist tldr tl dr brief briefly short quick
  quickly simple simply everything whole entire paper document doc docs file pdf article report study text
  book content contents topic topics cover covers say says discuss discusses talk talks tell give show list
  outline contribution contributions conclusion conclusions abstract purpose goal goals aim aims objective
  objectives learn know need please thing things understand basically mean means essential essentials
  significant significance core central primary basic basics happen happens going general generally
  everyone anything something interesting notable noteworthy recap review rundown breakdown digest
  `;
const OVERVIEW_STEMS = new Set(tokenize(OVERVIEW_WORDS));

const OVERVIEW_PATTERN =
  /\b(summar(y|ise|ize|ies)|overview|tl;?dr|gist|in a nutshell|key (points?|findings?|takeaways?|ideas?|details?)|main (points?|ideas?|findings?|contributions?|takeaways?)|takeaways|highlights|crucial|what('s| is| are) (this|these|the|it)( \w+)? about|what does (it|this|the \w+) (say|cover|discuss))\b/i;

export type QuestionPlan = {
  /** No topic words at all: the question is about the document(s) as a whole. */
  overview: boolean;
  /** Uses overview vocabulary ("summarise", "explain", "key points"…), with or without a topic. */
  asksForOverview: boolean;
  /** Content words that name a topic (after removing overview vocabulary), stemmed. */
  topicTokens: string[];
};

export function planQuestion(question: string): QuestionPlan {
  const tokens = tokenize(question);
  const topicTokens = [...new Set(tokens.filter((t) => !OVERVIEW_STEMS.has(t)))];
  return {
    overview: topicTokens.length === 0,
    asksForOverview: OVERVIEW_PATTERN.test(question) || tokens.some((t) => OVERVIEW_STEMS.has(t)),
    topicTokens,
  };
}

/**
 * Does a question's topic consist only of words from this title? ("summarise
 * the UAV tracking paper" names "Towards Robust UAV Tracking in …".)
 */
export function namesDocument(plan: QuestionPlan, title: string): boolean {
  if (!plan.asksForOverview || plan.topicTokens.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  return plan.topicTokens.every((t) => titleTokens.has(t));
}

export type OverviewCandidate = { index: number; heading: string | null; content: string };

const ABSTRACT = /(^|› )(abstract|summary|executive summary|overview)$/i;
const INTRO = /(^|› )([\dIVX]+\.?\s+)?(introduction|background|purpose)\b/i;
const CONCLUSION =
  /(^|› )([\dIVX]+\.?\s+)?(conclusions?|concluding|summary|discussion|future work|limitations)\b/i;
const BACK_MATTER =
  /(^|› )([\dIVX]+\.?\s+)?(references|bibliography|works cited|acknowledge?ments?|appendix)/i;

/**
 * Picks up to `limit` chunk indices that together give the gist of a document:
 * the abstract (or the opening), the introduction, the conclusion, the chunks the
 * key points came from, then evenly spaced body sections. Returned in document order.
 */
export function selectOverviewChunks(
  chunks: OverviewCandidate[],
  summary: DocumentSummary | null,
  limit: number,
): number[] {
  if (limit <= 0 || chunks.length === 0) return [];
  const body = chunks.filter((c) => !(c.heading && BACK_MATTER.test(c.heading)));
  const picked: number[] = [];
  const take = (index: number | null | undefined) => {
    if (index === null || index === undefined || picked.length >= limit || picked.includes(index))
      return;
    if (body.some((c) => c.index === index)) picked.push(index);
  };
  const first = (re: RegExp, n = 1) =>
    body.filter((c) => c.heading && re.test(c.heading)).slice(0, n);

  const abstract = first(ABSTRACT, 2);
  abstract.forEach((c) => take(c.index));
  if (abstract.length === 0) take(body[0]?.index);
  first(INTRO).forEach((c) => take(c.index));
  // The last conclusion-like chunk is usually the actual conclusion.
  const conclusions = body.filter((c) => c.heading && CONCLUSION.test(c.heading));
  take(conclusions.at(-1)?.index);
  for (const point of summary?.keyPoints ?? []) take(point.chunkIndex);

  // Fill with evenly spaced prose chunks so long documents are covered end to end.
  const prose = body.filter((c) => !isMostlyTable(c.content) && !picked.includes(c.index));
  if (picked.length < limit && prose.length > 0) {
    const remaining = limit - picked.length;
    const step = prose.length / (remaining + 1);
    for (let i = 1; i <= remaining; i++)
      take(prose[Math.min(prose.length - 1, Math.round(step * i))]?.index);
  }
  return picked.sort((a, b) => a - b);
}

/** Table rows are rendered as "Label: value; Label: value". */
function isMostlyTable(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim());
  const rows = lines.filter((l) => /^[^.;]{1,60}: [^;]*;/.test(l) || / \| /.test(l));
  return lines.length > 0 && rows.length / lines.length > 0.5;
}
