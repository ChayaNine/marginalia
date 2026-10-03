// Retrieval + answer evaluation.
//
//   npm run eval                     # the committed golden set (eval/handbook.json)
//   npm run eval -- path/to/set.json # any other set, e.g. one for your own PDFs
//   npm run eval -- --verbose        # also print every answer in full
//
// A set lists documents to ingest and questions, each with:
//   evidence – phrases that a correct passage contains (any one counts)
//   answer   – phrases a good answer mentions (any one counts)
// or, for questions the documents cannot answer:
//   expectInsufficient: true – the right behaviour is "not found"
//
// Everything runs against a throw-away SQLite database built from the checked-in
// migrations, with whichever provider the environment selects (the offline mock
// unless OPENAI_API_KEY is set), so results are reproducible and nothing touches
// your dev.db.
//
// Metrics:
//   hit@1 / hit@3 / hit@k – an evidence phrase appears in the top 1 / 3 / all
//                           passages shown to the model
//   answer                – the answer mentions an expected phrase and is not
//                           "insufficient"

import "dotenv/config";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

type EvalQuestion =
  | { q: string; evidence: string[]; answer: string[]; expectInsufficient?: false }
  | { q: string; expectInsufficient: true };
type EvalSet = { name: string; documents: string[]; questions: EvalQuestion[] };

/** Lower-case and drop everything but letters and digits, so line breaks, hyphenation
 *  and spacing differences between extraction methods do not affect matching. */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function containsAny(haystack: string, needles: string[]): boolean {
  const h = squash(haystack);
  return needles.some((n) => h.includes(squash(n)));
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const setArg = args.find((a) => !a.startsWith("-"));
  const setPath = path.resolve(setArg ?? path.join(__dirname, "../eval/handbook.json"));
  const set = JSON.parse(readFileSync(setPath, "utf8")) as EvalSet;
  const baseDir = path.dirname(setPath);

  // Fresh database from the migrations, before any app module creates a client.
  const dir = path.resolve(__dirname, "../.test-dbs");
  mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, `eval-${randomUUID()}.db`);
  const raw = new Database(dbFile);
  const migrations = path.resolve(__dirname, "../prisma/migrations");
  for (const m of readdirSync(migrations, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    raw.exec(readFileSync(path.join(migrations, m, "migration.sql"), "utf8"));
  }
  raw.close();
  process.env.DATABASE_URL = `file:${dbFile}`;

  const { getProvider } = await import("../src/lib/ai");
  const { prisma } = await import("../src/lib/db");
  const { ingestDocument } = await import("../src/lib/rag/ingest");
  const { answerQuestion } = await import("../src/lib/rag/answer");
  const { createDbRetriever } = await import("../src/lib/rag/retrieve");

  const provider = getProvider();
  console.log(
    `\n${set.name}\nprovider: ${provider.name} (${provider.embeddingModel} / ${provider.chatModel})\n`,
  );

  try {
    for (const doc of set.documents) {
      const file = path.resolve(baseDir, doc);
      const bytes = new Uint8Array(readFileSync(file));
      const mime = file.endsWith(".pdf") ? "application/pdf" : "text/plain";
      const t0 = performance.now();
      const result = await ingestDocument({
        filename: path.basename(file),
        mimeType: mime,
        bytes,
        provider,
      });
      console.log(
        `ingested ${path.basename(file)}: ${result.chunkCount} passages in ${Math.round(performance.now() - t0)} ms`,
      );
    }

    let hit1 = 0,
      hit3 = 0,
      hitK = 0,
      answered = 0,
      retrievable = 0;
    const rows: string[] = [];
    for (const item of set.questions) {
      const r = await answerQuestion({
        question: item.q,
        provider,
        retriever: createDbRetriever(provider.embeddingModel),
      });
      if (item.expectInsufficient) {
        const ok = r.insufficient;
        answered += +ok;
        rows.push(
          `n/a  ${ok ? "✓" : "✗"}  ${item.q}  (should be "not found")` +
            (ok ? "" : `\n          ↳ ${r.answer.slice(0, 140)}`),
        );
        continue;
      }
      retrievable++;
      const texts = r.sources.map((s) => s.content);
      const rank = texts.findIndex((t) => containsAny(t, item.evidence));
      const h1 = rank === 0,
        h3 = rank >= 0 && rank < 3,
        hk = rank >= 0;
      const ok = !r.insufficient && containsAny(r.answer, item.answer);
      hit1 += +h1;
      hit3 += +h3;
      hitK += +hk;
      answered += +ok;
      rows.push(
        `${hk ? `#${rank + 1}`.padEnd(4) : "—   "} ${ok ? "✓" : "✗"}  ${item.q}${r.mode === "overview" ? "  (overview)" : ""}` +
          (verbose
            ? `\n${r.answer.replace(/^/gm, "          ")}\n`
            : ok
              ? ""
              : `\n          ↳ ${r.answer.slice(0, 140).replace(/\s+/g, " ")}`),
      );
    }
    const n = set.questions.length;
    const pct = (x: number, of: number) =>
      `${Math.round((x / Math.max(1, of)) * 100)}%`.padStart(4);
    console.log("\nrank ans  question\n" + rows.join("\n"));
    console.log(
      `\nhit@1 ${pct(hit1, retrievable)}   hit@3 ${pct(hit3, retrievable)}   hit@k ${pct(hitK, retrievable)}` +
        `   answer ${pct(answered, n)}   (n=${n})\n`,
    );
  } finally {
    await prisma.$disconnect();
    rmSync(dbFile, { force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
