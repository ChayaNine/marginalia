# Decisions, trade-offs and regrets

A running log of the choices in this codebase: what was decided, what the
alternatives were, what I would change with more time, and what bit me along the
way. It is written to be read, not skimmed — the "why" is the point.

---

## 1. Decisions

### Provider seam instead of calling OpenAI directly

Everything that touches a model goes through `AIProvider` (`src/lib/ai/provider.ts`).
Two implementations: `openai.ts` and `mock.ts`.

_Why:_ the pipeline, the routes and the seed script can all run without a key or a
network. Tests are deterministic (the mock is hash-based, so the same text always
embeds to the same vector). Demo mode is a real feature, not a stub. Swapping
vendors is a one-file change.

_Cost:_ the mock is lexical, not semantic — it retrieves by word overlap and
answers extractively. It cannot paraphrase or reason. That is fine for
demonstrating the _workflow_, and the UI says so loudly.

### Citations are verified against the source text

The model returns a verbatim `quote` for each citation; `verifyQuote()` checks it
really appears in the chunk after normalising whitespace, case and typographic
punctuation. Unverified quotes are kept but flagged.

_Why:_ language models fabricate quotes. A citation that cannot be found in the
source is exactly the one a reviewer needs to look at.

_Limit:_ it is a string match. A quote that is _correct in meaning_ but lightly
paraphrased is flagged as unverified (false alarm), and a verbatim quote that is
taken out of context passes (false comfort). A semantic check — embedding the quote
and the claim — would be the next step.

### Strict JSON output from the model

`response_format: { type: "json_schema", strict: true }` with the schema in
`prompt.ts`, then zod-validated again on our side.

_Why:_ no regex-scraping of prose, no "sometimes it adds a preamble". Off-schema
replies become a clear error instead of a corrupt row.

### Skip the model when retrieval finds nothing relevant

`answer.ts` gates on `provider.relevanceThreshold` before calling `generate()`.

_Why:_ cheaper, faster, and it produces an honest "nothing found" rather than
letting the model improvise from irrelevant context. The threshold is per provider
because mock cosines and OpenAI cosines live on different scales.

### Vectors stored as raw Float32 bytes in SQLite; brute-force cosine scan

`vectors.ts` serialises `Float32Array` ↔ `Uint8Array`; `retrieve.ts` loads every
READY chunk for the current embedding model and scores it in JS.

_Why:_ one file, zero infrastructure, and at this scale (thousands of chunks) a
scan takes single-digit milliseconds. A 1536-dim vector is ~6 KB as bytes versus
~30 KB as JSON.

_When it breaks:_ around 10⁵ chunks the scan and the memory both hurt. The move
is pgvector (Postgres, which the app already targets "soon") or `sqlite-vec` to
stay on SQLite. Both are contained inside `retrieve.ts` + a migration.

_Caveat:_ Float32Array uses the machine's byte order. Fine here (same machine
reads and writes); a portable format would fix endianness explicitly.

### Documents are read as structure, not as a string

Version 1 extracted a flat string (pdf.js's text in content-stream order) and cut
it into fixed 1600-character windows with a 200-character tail overlap. On a
two-column research paper that produced passages that interleaved the columns,
kept every printed line break, split words at hyphens, contained figure axis
numbers and running headers, and started and ended mid-sentence. Retrieval and
citations were only as good as those passages — "it cuts weirdly" was the
honest user report.

Version 2 (`PIPELINE_VERSION = 2`) turns every format into ordered **blocks**
(heading with level, paragraph, table, caption) with page numbers:

- **PDF** (`text/pdf-layout.ts`) works from glyph positions. Column gutters are
  found per page from where runs of text start and end (not from the size of
  gaps between words, which fails when the gutter is narrower than a wide word
  space), full-width rows split the page into bands, lines are grouped by
  baseline, and paragraphs/headings are decided by font size and face, spacing,
  indentation and numbering. Clean-up passes: running headers/footers (repeated
  on ≥40% of pages, in the top/bottom 8%), page numbers, figure tick labels,
  de-hyphenation that consults the document's own vocabulary so "solid-state"
  stays hyphenated but "cali-bration" joins, small caps, ligatures and accents
  built from spacing marks, and paragraphs that continue into the next column.
- **DOCX** goes through mammoth's HTML (keeps headings, lists and tables);
  **Markdown** and **plain text** are parsed for headings, lists and tables.
- **Tables** become one line per row with the header repeated as labels
  ("Livox Avia — Range: 450 m; Freq.: 100 Hz"), so a row stands alone in a
  chunk and its numbers stay attached to their meaning.

**Chunking** (`rag/chunk.ts`) packs whole sentences up to ~1200 characters
(~300 tokens), starts a new chunk at each section (folding a tiny section into
the next rather than leaving a stub — but never folding body text into the
reference list), repeats one sentence of overlap within a section, and records
the section path and page range. A chunk is labelled with the section most of
its text belongs to.

_Why not semantic chunking (split where embeddings say the topic changes):_ the
document's own headings are a better topic signal than embedding drift, they
are free, and they are what a reader expects a citation to name.

_Known weaknesses:_ scanned PDFs need OCR; charts and images are invisible
except for their captions; complex layouts (three columns, sidebars, tables
without ruling) are heuristics, not guarantees. Sizes are still in characters.

### Embed passages with their title and section

Each chunk is embedded (and keyword-indexed) as `title — section path` + text.
Papers rarely repeat their section's subject in every paragraph: a passage under
"C. Sensor Calibration" that says "we aligned the point clouds with GICP" is
about calibration, and now retrieves for "how were the sensors calibrated?".

### Hybrid retrieval: embeddings + BM25, fused by rank

Embeddings are good at meaning and bad at exact tokens (model numbers, acronyms,
names, figures); BM25 is the opposite. `rag/rank.ts` ranks every candidate both
ways and fuses with reciprocal rank fusion (1 / (60 + rank)), which needs no
score calibration between two very different scales. The relevance gate passes
a passage if its embedding is close enough _or_ it contains at least half of the
question's IDF-weighted keywords. Reference lists match every keyword in the
field, so they are down-weighted unless the question is about references.

_Why in memory instead of SQLite FTS5:_ tokenisation (stemming, "Mid-360" ≡
"Mid360") has to match between the index, the offline model and the summariser;
one TypeScript tokenizer guarantees that. Tokens are cached per chunk id (chunk
ids are never reused). At library scale this is milliseconds; FTS5 is the
upgrade when it isn't.

### "Summarise this" is routed, not searched

"Explain the crucial details" contains no words that identify a passage, so
similarity search returns whatever shares the word "details". `rag/overview.ts`
recognises questions whose content words are all overview vocabulary
("summarise", "key points", "paper", "explain"…) or the document's own title,
and answers them from the abstract, introduction, conclusion and the passages
the key points came from, in reading order, with a prompt that asks for a
structured overview.

### An overview is computed at upload, without a model

`rag/summary.ts` stores the abstract, an outline with pages, and five key
points chosen by TF-IDF centroid similarity with Maximal Marginal Relevance (so
the second point is not a paraphrase of the first), with bonuses for
conclusion/abstract sections and phrases like "we propose". It costs nothing,
works offline, and gives every document a useful landing page.

### The original file is kept

`DocumentFile` (a separate table, so listing documents never loads bytes)
stores the upload. That enables "open the PDF at the cited page" (`#page=N`)
and one-click re-processing when the pipeline improves or the embedding model
changes. Re-uploading a file processed by an older pipeline re-processes it in
place, keeping its id and every link to it. Re-processing replaces chunks, so
citations that pointed at the old chunks are removed (answers stay).

### The offline model got smarter, deliberately within limits

The mock is what most people see first, so it has to be useful, not just
deterministic. It scores each sentence by how much of the question's
rarity-weighted vocabulary it covers (with partial credit from the section
heading and neighbouring sentences, and little weight for question-shape words
like "handled" or "used"), boosts the thing asked about ("_what computer_…"),
adds the following sentence when the question wants a number or an explanation
the best sentence lacks, and still refuses when nothing covers enough of the
question. Overviews lead with the abstract's first sentence and add salient,
mutually different key points. It still cannot paraphrase or infer — the UI says
so, and points to real-model options, including free local ones.

### Any OpenAI-compatible server, with graceful JSON fallbacks

`OPENAI_BASE_URL` points the OpenAI SDK at Ollama, Gemini, Groq, OpenRouter, LM
Studio… Many of those reject `response_format: json_schema`; generation then
tries `json_object`, then a plain prompt that spells out the JSON shape, parses
JSON out of prose or code fences, tolerates `"1"` for `1` and `"High"` for
`"high"`, and remembers the mode that worked. `EMBEDDING_PROVIDER=local` keeps
search offline for services without an embeddings endpoint.

### Human edits never overwrite the AI draft

`Answer.draft` (what the model wrote) and `Answer.finalText` (what a person
changed it to) are separate columns; the API refuses blank edits and stores an
edit identical to the draft as "no edit".

_Why:_ reviewers need to see what changed, and "restore the AI draft" must be
possible. It also makes the data useful later — the pairs (draft, final) are a
training/eval signal for free.

### Approved answers are protected

Regenerating an approved answer returns 409; you must un-approve first.

_Why:_ "Draft all" must never silently replace something a person signed off.

### Batch drafting runs in small sequential batches driven by the browser

`POST /question-sets/:id/draft` answers up to 5 questions per call; the client
loops and shows progress.

_Why:_ every request stays well under HTTP timeouts, progress is visible, and
cancel is trivial. _What it is not:_ durable. Close the tab and drafting stops
(nothing is lost — remaining questions stay pending). A job queue with a worker
(BullMQ, or a `jobs` table plus a cron) is the production version, and it would
also unlock parallelism with a rate limiter.

### Ingestion happens inside the upload request

Extract → chunk → embed → write, all in `POST /api/documents`.

_Why:_ simplest possible path; a few seconds for a few MB. The Document row is
created first as `PROCESSING` and flipped to `READY`/`FAILED` so failures leave a
visible, deletable record with the reason instead of vanishing.

_Limit:_ a 200-page PDF with a slow embeddings API will hit a timeout. Same fix
as above: a queue.

### Plain-string statuses instead of Prisma enums

`status` columns are strings validated by zod (`status.ts`).

_Why:_ SQLite has no enum type; keeping strings means the Postgres migration
later is a copy, not a rewrite. The trade is that the DB itself does not reject a
bad value — the application layer does, and the tests cover it.

### Prisma 7 with the `better-sqlite3` driver adapter

_Why:_ Rust-free client, no engine binary download at install time (which
matters in locked-down CI and sandboxes), and the move to Postgres is swapping
the adapter. Prisma turns on `PRAGMA foreign_keys` itself, so `onDelete: Cascade`
works — `tests/db.test.ts` proves it instead of assuming it.

### Server components read Prisma directly; client components call the API

Pages render from the database with no fetch round-trip; the interactive parts
(upload, review workbench) are client components that call the JSON API and
`router.refresh()`.

_Why:_ it is the App Router's intended split, and it means the API is the _only_
write path, so every mutation is validated in one place.

### The review workbench keeps a local copy of the set

No global store. Each API call returns the updated piece and it is spliced into
component state.

_Why:_ at this size a store would be ceremony. _Limit:_ no optimistic updates —
buttons show a spinner until the server replies. Fine on localhost, noticeable
on a slow link.

### CSV parsing is hand-written and shared with the browser

`csv.ts` has no Node imports, so the import form parses the file client-side to
offer a column picker and preview before uploading.

_Why:_ one parser, one behaviour, zero dependencies. Export neutralises
spreadsheet formula injection (`=`, `+`, `-`, `@` prefixes) by default.

### Inter via `@fontsource-variable`, not `next/font/google`

`next/font/google` downloads the font at build time, which fails in offline or
locked-down builds. The Fontsource package ships the same variable font through
npm, so it installs with everything else and is self-hosted from the build.

### Visual system: quiet by default, one gradient per screen

White page, Inter, generous whitespace. The violet→blue gradient appears only on
the most important action of each view (Choose file, Ask, Draft all); dark pills
carry the second most important one (Approve, Ask a question); everything else
is plain text or a hairline border. Status is written like a comparison table
(`✓ Ready`, `✓ Approved`, `✕ Rejected`) instead of a coloured badge on every row.
A primary button that is _unavailable_ turns neutral grey rather than a faded
gradient, but keeps its gradient while it is _busy_, so "not yet" and "working"
never look alike.

_Why:_ the reviewer's attention should land on the answer text and its sources,
not on the chrome. Fewer colours also means a colour, when it appears, means
something.

### `cn()` uses `tailwind-merge`

Components take a `className` to override their defaults (`rounded-xl` instead
of `rounded-full`, `hidden sm:inline-flex`). Plain string joining leaves both
classes in place and the winner depends on stylesheet order. `tailwind-merge`
removes the loser, so an override always wins.

---

## 2. What I would do next, in order

1. **A bigger evaluation set** with real documents of several kinds (papers,
   contracts, manuals, slide decks). `npm run eval` exists and drove every
   change in version 2; it needs more questions to catch regressions with
   confidence, and an LLM-graded answer score next to the phrase match.
2. **Job queue for ingestion and batch drafting** (durable, parallel, rate-limited).
3. **OCR fallback** for scanned PDFs (Tesseract, or a vision model), and
   figure/table understanding with a vision model.
4. **Authentication and multi-tenancy** — currently single-user by design.
5. **Streaming answers** for the Ask page (SSE) so long answers appear as they
   are generated.
6. **Token-accurate sizing** (`js-tiktoken`) and a context budget: cap total
   source tokens instead of a fixed top-8.
7. **A cross-encoder re-ranker** over the fused top-30 when a real model is
   configured.
8. **Persistent keyword index** (SQLite FTS5) and **pgvector / sqlite-vec** when
   the chunk count justifies them.
9. **Conversation memory** on the Ask page (follow-up questions).
10. **Observability:** request ids in the error envelope, structured logs,
    timing histograms for embed/retrieve/generate (the timings are already
    measured and returned by `/api/ask`).
11. **Optimistic UI** in the review workbench.
12. **Semantic citation check** (embed quote vs. claim) alongside the string match.

---

## 3. Things that bit me (and what they taught me)

- **Prisma 7's `Bytes` type is `Uint8Array<ArrayBuffer>`,** not `Buffer` and
  not `Uint8Array<ArrayBufferLike>`. `Float32Array.from(...).buffer` type-checks
  as `ArrayBufferLike`, which Prisma rejects. Allocating an explicit
  `ArrayBuffer` fixed the types _and_ guarantees 4-byte alignment.
- **Node `Buffer`s can be slices of a shared pool** at any byte offset, but a
  `Float32Array` view must start on a 4-byte boundary. `bytesToVector` copies
  when misaligned; there is a test for it because it only fails sometimes.
- **Next.js type-checks route handler signatures at build time.** A wrapper whose
  second parameter defaulted to `undefined` compiled under `tsc` but failed
  `next build`. The default context type must be a valid `{ params: Promise<…> }`.
- **"Does the request have a body?" cannot be answered from `content-length`.**
  My first version of the draft endpoint checked that header; a `Request` built in
  code has none, so `{ limit: 4 }` was silently ignored. The integration test
  caught it. Reading the body text and treating empty as `{}` is the robust way.
- **A lexical mock needs a "coincidence" gate.** "What is the parking permit
  fee?" matched the _late payment fee_ sentence on the single word "fee". Now a
  single shared term out of a longer question counts as insufficient — which is
  also exactly what the real model is instructed to do.
- **Markdown headings poison extractive answers.** `## 11. Moving out` became
  the "sentence" _Moving out_ and got cited. Stripping Markdown at extraction
  time, and ignoring fragments under four words, fixed it.
- **Playwright's `has-text()` is a substring match.** `button:has-text("Approve")`
  clicked the _Approved_ filter tab. `getByRole("button", { name, exact: true })`
  is the right tool.
- **Restarting a server after a rebuild:** a stale `next start` kept serving old
  HTML that referenced CSS hashes the new build did not have — 400s that looked
  like an app bug. Kill by process, then rebuild, then start.
- **Two copies of a native module.** `@prisma/adapter-better-sqlite3` depends on
  `better-sqlite3@^12`; I had added `better-sqlite3@^13` at the top level for the
  test helper, so npm installed _both_ — two compiled SQLite bindings, and the
  13.x one tried to compile from source on a clean `npm ci`. `npm ls better-sqlite3`
  made it obvious. Matching the adapter's range dedupes it to one copy. Lesson:
  after adding a native dependency, run `npm ls <name>` and read the tree.
- **`npm install` must work before `.env` exists.** `postinstall` runs
  `prisma generate`, and `prisma.config.ts` originally used `env("DATABASE_URL")`,
  which throws when the variable is missing — so a fresh clone failed at install.
  A default (`file:./dev.db`) in both the config and `env.ts` fixed it; I only
  found it by simulating a fresh clone.
- **A screen-reader-only label made the whole page scroll sideways on phones.**
  The document table sits in an `overflow-x-auto` wrapper, so a wide table
  scrolls inside its box. But the hidden "Actions" header label is
  `position: absolute`, and the wrapper was not a positioning context, so the
  label was placed relative to `<body>` — 700px to the right — and widened the
  page. `relative` on the wrapper fixed it. Found by a browser test that checks
  `scrollWidth` at 390px, not by eye.
- **`hidden` lost to `inline-flex`.** The "Ask a question" pill was meant to hide
  on phones, but its base classes included `inline-flex`, and both rules have the
  same specificity. Whichever Tailwind emits later wins. That is why `cn()` now
  runs `tailwind-merge`.
- **A highlighted quote can be below the fold of its own box.** "Show passage"
  highlighted the cited sentence, but in a long passage it sat below the visible
  part of the scroll box. The box now scrolls itself (not the page) to the mark
  when it opens, and the browser test asserts the mark is inside the box's
  visible area.
- **The Prisma CLI still wants its schema-engine binary even for `generate`**
  in 7.10, although generation never runs it. `PRISMA_SCHEMA_ENGINE_BINARY` can
  point at any file in environments that cannot download it; `db push` /
  `migrate` do need the real one.
- **Columns hide in plain sight.** The first layout pass split lines into cells
  wherever the gap between words exceeded 1.5× the font size — and the gutter
  of the test paper was narrower than that, so both columns came out as one
  line. Finding columns from where text runs start and end on the page (and
  using percentiles, because a single hanging-indented list item shifted the
  edge) was the fix.
- **A median is the wrong "typical" on a short page.** Line spacing was taken as
  the median gap, and on a page with three body lines, a heading and a reference
  list the extra space around headings _was_ the median — so "REFERENCES" no
  longer looked spaced, became a short paragraph, and was dropped as a stray
  label. The most common gap is the right statistic.
- **Roman numerals are letters too.** "C. Sensor Calibration" was read as
  section C (100) of level 1; "Table I." was read as the initial in "J. Smith"
  and glued two sentences together. Both are now decided by context (an
  all-caps title after a Roman numeral; a label word before a letter).
- **A stemmer rule that helps one question can break another.** "-ed"
  stripping turned "speed" into "spe"; a minimum stem length fixed it. The
  eval caught it, which is the argument for having one.
- **Back matter is not body text.** With small sections folded into the next
  chunk, the last two sentences of a conclusion ended up in a chunk labelled
  "REFERENCES" — and then down-weighted and excluded from overviews. Section
  folding now stops at back matter.
