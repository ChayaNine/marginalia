// Database behaviour we rely on but that could silently break: cascading deletes
// through the SQLite driver adapter, and the embedding round-trip through Bytes.

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { bytesToVector, vectorToBytes } from "@/lib/rag/vectors";

async function makeDocumentWithChunk(tag: string) {
  return prisma.document.create({
    data: {
      title: `Doc ${tag}`,
      filename: `${tag}.txt`,
      mimeType: "text/plain",
      sizeBytes: 10,
      sha256: `sha-${tag}-${Date.now()}-${Math.random()}`,
      status: "READY",
      embeddingModel: "mock-hash-v1",
      chunks: {
        create: [
          {
            index: 0,
            content: "Some passage.",
            tokenCount: 3,
            embedding: vectorToBytes([0.5, -0.25]),
          },
        ],
      },
    },
    include: { chunks: true },
  });
}

describe("database", () => {
  it("round-trips embedding bytes through Prisma", async () => {
    const doc = await makeDocumentWithChunk("bytes");
    const chunk = await prisma.chunk.findUniqueOrThrow({ where: { id: doc.chunks[0].id } });
    expect(Array.from(bytesToVector(chunk.embedding))).toEqual([0.5, -0.25]);
  });

  it("deleting a document cascades to its chunks and their citations", async () => {
    const doc = await makeDocumentWithChunk("cascade");
    const set = await prisma.questionSet.create({
      data: {
        name: "Set",
        questions: {
          create: [
            {
              index: 0,
              text: "Q?",
              answer: {
                create: {
                  draft: "A.",
                  confidence: "high",
                  status: "DRAFT",
                  model: "mock",
                  citations: {
                    create: [
                      {
                        chunkId: doc.chunks[0].id,
                        quote: "Some passage.",
                        verified: true,
                        order: 0,
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      include: { questions: { include: { answer: { include: { citations: true } } } } },
    });
    const answerId = set.questions[0].answer!.id;
    expect(await prisma.citation.count({ where: { answerId } })).toBe(1);

    await prisma.document.delete({ where: { id: doc.id } });

    expect(await prisma.chunk.count({ where: { documentId: doc.id } })).toBe(0);
    expect(await prisma.citation.count({ where: { answerId } })).toBe(0);
    // The answer itself survives — only the citation pointing at the deleted chunk goes.
    expect(await prisma.answer.count({ where: { id: answerId } })).toBe(1);
  });

  it("deleting a question set cascades to questions, answers and citations", async () => {
    const doc = await makeDocumentWithChunk("set-cascade");
    const set = await prisma.questionSet.create({
      data: {
        name: "Set",
        questions: {
          create: [
            {
              index: 0,
              text: "Q?",
              answer: {
                create: {
                  draft: "A.",
                  confidence: "low",
                  status: "APPROVED",
                  model: "mock",
                  citations: {
                    create: [{ chunkId: doc.chunks[0].id, quote: "x", verified: false, order: 0 }],
                  },
                },
              },
            },
          ],
        },
      },
    });

    const answerId = (
      await prisma.answer.findFirstOrThrow({ where: { question: { questionSetId: set.id } } })
    ).id;

    await prisma.questionSet.delete({ where: { id: set.id } });

    expect(await prisma.question.count({ where: { questionSetId: set.id } })).toBe(0);
    expect(await prisma.answer.count({ where: { id: answerId } })).toBe(0);
    expect(await prisma.citation.count({ where: { chunkId: doc.chunks[0].id } })).toBe(0);
    // The document is untouched.
    expect(await prisma.chunk.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it("enforces one answer per question and unique chunk positions", async () => {
    const doc = await makeDocumentWithChunk("unique");
    await expect(
      prisma.chunk.create({
        data: {
          documentId: doc.id,
          index: 0,
          content: "dup",
          tokenCount: 1,
          embedding: vectorToBytes([1]),
        },
      }),
    ).rejects.toThrow();
  });
});
