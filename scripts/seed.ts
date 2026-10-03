// Loads the sample handbook and question set so the app has something to show.
//
//   npm run seed          # skips anything already present
//   npm run seed -- --reset   # wipes documents and question sets first
//
// Runs through the same ingestion code as an upload, with whichever provider the
// environment selects (mock by default), so it doubles as a smoke test.

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getProvider } from "../src/lib/ai";
import { prisma } from "../src/lib/db";
import { extractQuestions, parseCsv } from "../src/lib/csv";
import { draftPending } from "../src/lib/drafting";
import { ingestDocument, sha256Hex } from "../src/lib/rag/ingest";

const DATA_DIR = path.resolve(__dirname, "../prisma/seed-data");
const HANDBOOK = "aurora-housing-handbook.md";
const FAQ = "resident-faq.csv";
const SET_NAME = "Resident FAQ (sample)";

async function main() {
  const reset = process.argv.includes("--reset");
  const provider = getProvider();
  console.log(
    `Seeding with provider "${provider.name}" (${provider.embeddingModel} / ${provider.chatModel})`,
  );

  if (reset) {
    await prisma.questionSet.deleteMany();
    await prisma.document.deleteMany();
    console.log("Cleared existing documents and question sets.");
  }

  // 1. Document
  const bytes = new Uint8Array(readFileSync(path.join(DATA_DIR, HANDBOOK)));
  const existing = await prisma.document.findUnique({ where: { sha256: sha256Hex(bytes) } });
  if (existing) {
    console.log(`Document already present: "${existing.title}" (${existing.status})`);
  } else {
    const doc = await ingestDocument({
      filename: HANDBOOK,
      mimeType: "text/markdown",
      bytes,
      provider,
    });
    console.log(`Ingested "${doc.title}": ${doc.chunkCount} chunks, ${doc.charCount} chars`);
  }

  // 2. Question set
  let set = await prisma.questionSet.findFirst({ where: { name: SET_NAME } });
  if (set) {
    console.log(`Question set already present: "${set.name}"`);
  } else {
    const { rows } = parseCsv(readFileSync(path.join(DATA_DIR, FAQ), "utf8"));
    const { questions } = extractQuestions(rows);
    set = await prisma.questionSet.create({
      data: {
        name: SET_NAME,
        questions: { create: questions.map((text, index) => ({ index, text })) },
      },
    });
    console.log(`Created question set "${set.name}" with ${questions.length} questions`);
  }

  // 3. Draft answers for whatever is still pending
  let drafted = 0;
  for (;;) {
    const batch = await draftPending(set.id, provider, 5);
    drafted += batch.drafted;
    for (const f of batch.failed) console.warn(`  ! could not draft ${f.questionId}: ${f.error}`);
    if (batch.remaining === 0 || batch.drafted === 0) break;
  }
  console.log(drafted > 0 ? `Drafted ${drafted} answers.` : "All answers were already drafted.");
  console.log("Done. Start the app with `npm run dev` and open http://localhost:3000");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
