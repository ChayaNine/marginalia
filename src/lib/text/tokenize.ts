// Word-level tokenisation shared by keyword search (BM25), the extractive
// summariser and the offline "mock" model, so all three agree on what counts as
// the same word.
//
//   "The LiDARs were calibrated using GICP (i7-10750h)"
//   → ["lidar", "calibrat", "gicp", "i7", "10750h", "i710750h"]
//
// Stemming is deliberately light and *consistent* rather than linguistically
// right: "calibrate", "calibrated", "calibration" and "calibrations" all become
// "calibrat", which is what matters for matching.

// prettier-ignore
const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been", "being",
  "both", "but", "by", "can", "could", "did", "do", "does", "each", "either", "for", "from", "get",
  "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "may",
  "might", "more", "most", "must", "my", "no", "not", "of", "on", "only", "or", "other", "our",
  "own", "s", "shall", "should", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "to", "up", "used", "very", "was", "we",
  "were", "what", "when", "where", "which", "while", "who", "whom", "whose", "why", "will",
  "with", "would", "you", "your",
]);

/** Lower-case, stopword-free, lightly stemmed tokens. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    out.push(stem(word));
  }
  // Model names and numbers written with separators also match as one token:
  // "Mid-360" → "mid360", "OS1-64" → "os164", "0.0143" → "00143".
  for (const compound of lower.match(/[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)+/gu) ?? []) {
    out.push(compound.replace(/[-./]/g, ""));
  }
  return out;
}

const VOWEL = /[aeiouy]/;

// Common irregular verb forms, so "lose" meets "lost" and "pay" meets "paid".
// prettier-ignore
const IRREGULAR: Record<string, string> = {
  lost: "lose", found: "find", made: "make", paid: "pay", bought: "buy", sent: "send", spent: "spend",
  kept: "keep", left: "leave", held: "hold", built: "build", brought: "bring", taught: "teach",
  thought: "think", caught: "catch", sold: "sell", told: "tell", given: "give", gave: "give",
  taken: "take", took: "take", written: "write", wrote: "write", chosen: "choose", chose: "choose",
  began: "begin", begun: "begin", ran: "run", seen: "see", saw: "see", went: "go", gone: "go",
  known: "know", knew: "know", shown: "show", grew: "grow", grown: "grow", drew: "draw", drawn: "draw",
  met: "meet", led: "lead", fed: "feed", fell: "fall", fallen: "fall", broke: "break", broken: "break",
  spoke: "speak", spoken: "speak", stole: "steal", stolen: "steal", froze: "freeze", frozen: "freeze",
  rode: "ride", ridden: "ride", drove: "drive", driven: "drive", ate: "eat", eaten: "eat",
  understood: "understand", stood: "stand", meant: "mean", felt: "feel", dealt: "deal",
};

export function stem(word: string): string {
  let w = IRREGULAR[word] ?? word;
  if (w.length <= 3 || /\d/.test(w)) return w;

  // Plurals.
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "y";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  // Verb and noun endings, only when a real stem with a vowel remains.
  const strip = (suffix: string, minStem: number) => {
    if (
      w.endsWith(suffix) &&
      w.length - suffix.length >= minStem &&
      VOWEL.test(w.slice(0, -suffix.length))
    ) {
      w = w.slice(0, -suffix.length);
      return true;
    }
    return false;
  };
  if (strip("ation", 3)) w += "at";
  else if (strip("ing", 3) || strip("ed", 4)) {
    if (/([^aeiouslz])\1$/.test(w)) w = w.slice(0, -1); // "planned" → "plan"
  }
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Unique tokens, preserving first-seen order. */
export function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}
