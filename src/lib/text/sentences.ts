// Sentence splitting that survives real documents.
//
// A naive split on ". " breaks "e.g. the Avia", "Fig. 3 shows", "et al. proposed",
// "J. Smith" and "Sec. IV" into nonsense fragments, and those fragments then become
// citations. This splitter only breaks after . ! ? when the next token starts like
// a sentence, and never after a known abbreviation or a single initial.
// Newlines are always boundaries (table rows, list items).

const ABBREVIATIONS = new Set(
  [
    "e.g",
    "i.e",
    "etc",
    "vs",
    "cf",
    "al",
    "fig",
    "figs",
    "eq",
    "eqs",
    "sec",
    "secs",
    "tab",
    "ref",
    "refs",
    "no",
    "nos",
    "vol",
    "pp",
    "p",
    "ch",
    "approx",
    "dr",
    "mr",
    "mrs",
    "ms",
    "prof",
    "inc",
    "ltd",
    "co",
    "corp",
    "jr",
    "sr",
    "st",
    "dept",
    "univ",
    "est",
    "min",
    "max",
    "avg",
    "resp",
    "incl",
    "jan",
    "feb",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "oct",
    "nov",
    "dec",
  ].map((a) => a.toLowerCase()),
);

/** Splits text into sentences. Whitespace inside each sentence is collapsed. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed) out.push(...splitLine(trimmed));
  }
  return out;
}

function splitLine(line: string): string[] {
  const sentences: string[] = [];
  // Candidate boundary: terminal punctuation, optional closing quotes/brackets,
  // whitespace, then something that can start a sentence.
  const boundary = /([.!?])(["'”’)\]]*)\s+(?=["'“‘(\[]?[A-Z0-9])/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(line))) {
    const end = match.index + match[1].length + match[2].length;
    const candidate = line.slice(start, end);
    if (match[1] === "." && isAbbreviationEnd(candidate)) continue;
    sentences.push(candidate.trim());
    start = boundary.lastIndex;
  }
  const rest = line.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences.filter(Boolean);
}

/** Words followed by a letter or numeral label: "Table I.", "Appendix B.", "Section IV." */
const LABEL_WORDS =
  /\b(table|figure|fig|section|sec|appendix|chapter|part|phase|type|class|group|stage|level|step|plan|option|category|grade|model|exhibit|schedule|annex|article|volume|vitamin)\s+$/i;

function isAbbreviationEnd(textBeforeAndIncludingPeriod: string): boolean {
  // The word immediately before the final period.
  const m = /(?:^|[\s(\[])([A-Za-z][A-Za-z.]*)\.["'”’)\]]*$/.exec(textBeforeAndIncludingPeriod);
  if (!m) return false;
  const word = m[1];
  if (/^[A-Z]$|^[IVX]{1,4}$/.test(word)) {
    // "Table I." / "Section IV." end a sentence; "J. Smith" does not.
    const before = textBeforeAndIncludingPeriod.slice(0, m.index + m[0].indexOf(word));
    if (LABEL_WORDS.test(before)) return false;
    return word.length === 1;
  }
  return ABBREVIATIONS.has(word.toLowerCase().replace(/\.$/, ""));
}

/** Word count, for sentence-length heuristics. */
export function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}
