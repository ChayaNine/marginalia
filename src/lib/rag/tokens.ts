// Token estimates.
//
// We never need exact token counts — only rough sizes for chunking and for the
// per-chunk "tokenCount" shown in the UI — so we avoid pulling in a tokenizer.
// For English text 1 token ≈ 4 characters (OpenAI's own rule of thumb). Other
// scripts (CJK, Thai) tokenize at closer to 1–2 characters per token, so treat the
// number as an estimate, not a bill.

export const CHARS_PER_TOKEN = 4;

export function approxTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
