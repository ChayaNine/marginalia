// End-to-end through the route handlers, against a real (throw-away) SQLite
// database and the mock provider: upload → ask → import questions → draft →
// review → export → delete. This is the test that proves the product works.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as ask } from "@/app/api/ask/route";
import { PATCH as patchAnswer } from "@/app/api/answers/[id]/route";
import { DELETE as deleteDocument, GET as getDocument } from "@/app/api/documents/[id]/route";
import { GET as getFile } from "@/app/api/documents/[id]/file/route";
import { POST as reprocess } from "@/app/api/documents/[id]/reprocess/route";
import { GET as listDocuments, POST as uploadDocument } from "@/app/api/documents/route";
import { GET as health } from "@/app/api/health/route";
import { DELETE as deleteSet, GET as getSet } from "@/app/api/question-sets/[id]/route";
import { POST as draftSet } from "@/app/api/question-sets/[id]/draft/route";
import { GET as exportSet } from "@/app/api/question-sets/[id]/export/route";
import { GET as listSets, POST as createSet } from "@/app/api/question-sets/route";
import { POST as draftQuestion } from "@/app/api/questions/[id]/draft/route";
import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import type {
  AnswerDTO,
  ChunkDTO,
  DocumentDTO,
  DocumentDetailDTO,
  QuestionSetDTO,
} from "@/lib/dto";
import type { DraftBatchResult } from "@/lib/drafting";
import type { AnswerResult } from "@/lib/rag/answer";

const handbook = readFileSync(
  path.resolve(__dirname, "../prisma/seed-data/aurora-housing-handbook.md"),
  "utf8",
);
const faqCsv = readFileSync(
  path.resolve(__dirname, "../prisma/seed-data/resident-faq.csv"),
  "utf8",
);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(`http://test${url}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const noCtx = { params: Promise.resolve({}) };

async function upload(name: string, content: string | Uint8Array, type = "text/markdown") {
  const form = new FormData();
  form.append("file", new File([content as BlobPart], name, { type }));
  return uploadDocument(
    new Request("http://test/api/documents", { method: "POST", body: form }),
    noCtx,
  );
}

describe("API", () => {
  let documentId: string;
  let setId: string;

  it("reports health with the mock provider", async () => {
    const res = await health(new Request("http://test/api/health"), noCtx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "mock" });
  });

  it("uploads and indexes a document", async () => {
    const res = await upload("aurora-housing-handbook.md", handbook);
    expect(res.status).toBe(201);
    const { document } = await res.json();
    // The Markdown's own H1 beats the filename as a title.
    expect(document).toMatchObject({
      title: "Aurora Campus Housing — Resident Handbook",
      status: "READY",
      reprocessed: false,
    });
    expect(document.chunkCount).toBeGreaterThan(3);
    documentId = document.id;

    const detail = await getDocument(new Request("http://test/x"), ctx(documentId));
    const body = (await detail.json()) as { document: DocumentDetailDTO; chunks: ChunkDTO[] };
    expect(body.chunks.length).toBe(document.chunkCount);
    expect(body.chunks[0].index).toBe(0);
    expect(body.document).toMatchObject({
      embeddingModel: "mock-hash-v2",
      outdated: false,
      hasFile: true,
      pageCount: null,
    });
    // Passages know their section.
    expect(body.chunks.some((c) => c.heading?.endsWith("3. Quiet hours and noise"))).toBe(true);
    // An overview was computed at upload.
    expect(body.document.summary?.outline.map((o) => o.heading)).toContain(
      "3. Quiet hours and noise",
    );
    expect(body.document.summary?.keyPoints.length).toBeGreaterThan(0);
  });

  it("serves the original file, as plain text for text formats", async () => {
    const res = await getFile(new Request("http://test/x"), ctx(documentId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^inline; filename\*=UTF-8''aurora-housing-handbook\.md$/,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe(handbook);
    expect((await getFile(new Request("http://test/x"), ctx("nope"))).status).toBe(404);
  });

  it("indexes a PDF with page numbers and serves it for #page links", async () => {
    const pdf = new Uint8Array(readFileSync(path.join(__dirname, "fixtures", "sample.pdf")));
    const res = await upload("sample.pdf", pdf, "application/pdf");
    expect(res.status).toBe(201);
    const { document } = await res.json();
    expect(document.pageCount).toBe(2);

    const body = (await (
      await getDocument(new Request("http://test/x"), ctx(document.id))
    ).json()) as {
      chunks: ChunkDTO[];
    };
    expect(body.chunks.every((c) => c.pageStart !== null && c.pageEnd !== null)).toBe(true);
    expect(body.chunks.at(-1)?.pageEnd).toBe(2);

    const file = await getFile(new Request("http://test/x"), ctx(document.id));
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdf);

    await deleteDocument(new Request("http://test/x", { method: "DELETE" }), ctx(document.id));
  });

  it("rejects a duplicate upload with 409 and points at the original", async () => {
    const res = await upload("copy-of-handbook.md", handbook);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.details.documentId).toBe(documentId);
  });

  it("rejects unsupported and empty files with the right status codes", async () => {
    expect((await upload("image.png", "not really", "image/png")).status).toBe(415);
    expect((await upload("empty.txt", "")).status).toBe(409);
    const missing = await uploadDocument(
      new Request("http://test/api/documents", { method: "POST", body: new FormData() }),
      noCtx,
    );
    expect(missing.status).toBe(400);
  });

  it("records a FAILED document when extraction fails, and reports 422", async () => {
    const scanned = new Uint8Array(readFileSync(path.join(__dirname, "fixtures", "scanned.pdf")));
    const res = await upload("scanned.pdf", scanned, "application/pdf");
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/OCR/);

    const list = await (
      await listDocuments(new Request("http://test/api/documents"), noCtx)
    ).json();
    const failed = (list.documents as DocumentDTO[]).find((d) => d.filename === "scanned.pdf");
    expect(failed?.status).toBe("FAILED");
    expect(failed?.error).toMatch(/OCR/);
  });

  it("answers an ad-hoc question with verified citations", async () => {
    const res = await ask(
      jsonReq("/api/ask", "POST", { question: "What are the quiet hours on weekdays?" }),
      noCtx,
    );
    expect(res.status).toBe(200);
    const { result } = (await res.json()) as { result: AnswerResult };
    expect(result.insufficient).toBe(false);
    expect(result.answer).toMatch(/11 pm to 7 am/);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.every((c) => c.verified)).toBe(true);
    expect(result.sources[0].documentId).toBe(documentId);
  });

  it("answers 'what is this about?' with an overview of the document", async () => {
    const res = await ask(
      jsonReq("/api/ask", "POST", {
        question: "explain the crucial details",
        documentIds: [documentId],
      }),
      noCtx,
    );
    const { result } = (await res.json()) as { result: AnswerResult };
    expect(result.mode).toBe("overview");
    expect(result.insufficient).toBe(false);
    expect(result.answer).toMatch(/^This handbook explains how the buildings run/);
    expect(result.answer).toMatch(/• .+ \[\d\]/);
    expect(result.citations.every((c) => c.verified)).toBe(true);
  });

  it("validates the ask body", async () => {
    expect((await ask(jsonReq("/api/ask", "POST", { question: "" }), noCtx)).status).toBe(400);
    expect((await ask(jsonReq("/api/ask", "POST", {}), noCtx)).status).toBe(400);
  });

  it("creates a question set from CSV, auto-detecting the question column", async () => {
    const res = await createSet(
      jsonReq("/api/question-sets", "POST", { name: "Resident FAQ", csv: faqCsv }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const { questionSet } = (await res.json()) as { questionSet: QuestionSetDTO };
    expect(questionSet.questions).toHaveLength(10);
    expect(questionSet.questions[0].text).toBe("What are the quiet hours on weekdays?");
    expect(questionSet.stats).toEqual({
      total: 10,
      pending: 10,
      drafted: 0,
      approved: 0,
      rejected: 0,
    });
    setId = questionSet.id;

    const list = await (await listSets(new Request("http://test/api/question-sets"), noCtx)).json();
    expect(list.questionSets[0].id).toBe(setId);
  });

  it("refuses an import with no usable questions", async () => {
    const res = await createSet(
      jsonReq("/api/question-sets", "POST", { name: "Empty", csv: "question\n\n\n" }),
      noCtx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/No questions found/);
  });

  it("drafts answers in batches until none remain", async () => {
    const first = (await (
      await draftSet(jsonReq(`/api/question-sets/${setId}/draft`, "POST", { limit: 4 }), ctx(setId))
    ).json()) as DraftBatchResult;
    expect(first).toMatchObject({ drafted: 4, remaining: 6, failed: [] });

    let remaining = first.remaining;
    let guard = 0;
    while (remaining > 0 && guard++ < 10) {
      const batch = (await (
        await draftSet(jsonReq(`/api/question-sets/${setId}/draft`, "POST"), ctx(setId))
      ).json()) as DraftBatchResult;
      expect(batch.failed).toEqual([]);
      remaining = batch.remaining;
    }
    expect(remaining).toBe(0);

    const { questionSet } = (await (
      await getSet(new Request("http://test/x"), ctx(setId))
    ).json()) as { questionSet: QuestionSetDTO };
    expect(questionSet.stats.pending).toBe(0);
    expect(questionSet.stats.drafted).toBe(10);

    const pets = questionSet.questions.find((q) => q.text.includes("pets"))!;
    expect(pets.answer?.text).toMatch(/No pets are permitted in the residence halls/);
    expect(pets.answer?.citations[0]).toMatchObject({ documentId, verified: true });

    // The handbook says nothing about parking, so that one must be flagged.
    const parking = questionSet.questions.find((q) => q.text.includes("parking"))!;
    expect(parking.answer?.insufficient).toBe(true);
  });

  it("supports the review workflow: edit, approve, protect, un-approve, regenerate", async () => {
    const { questionSet } = (await (
      await getSet(new Request("http://test/x"), ctx(setId))
    ).json()) as { questionSet: QuestionSetDTO };
    const q = questionSet.questions[0];
    const answerId = q.answer!.id;

    // Edit the wording.
    const edited = (await (
      await patchAnswer(
        jsonReq(`/api/answers/${answerId}`, "PATCH", {
          finalText: "Quiet hours are 11 pm–7 am on weekdays.",
        }),
        ctx(answerId),
      )
    ).json()) as { answer: AnswerDTO };
    expect(edited.answer.finalText).toBe("Quiet hours are 11 pm–7 am on weekdays.");
    expect(edited.answer.text).toBe(edited.answer.finalText);
    expect(edited.answer.draft).toBe(q.answer!.draft); // the AI draft is preserved

    // Approve.
    const approved = (await (
      await patchAnswer(
        jsonReq(`/api/answers/${answerId}`, "PATCH", { status: "APPROVED" }),
        ctx(answerId),
      )
    ).json()) as { answer: AnswerDTO };
    expect(approved.answer.status).toBe("APPROVED");

    // An approved answer cannot be regenerated by accident.
    const blocked = await draftQuestion(
      new Request("http://test/x", { method: "POST" }),
      ctx(q.id),
    );
    expect(blocked.status).toBe(409);

    // Un-approve, then regenerate: the edit is discarded and status returns to DRAFT.
    await patchAnswer(
      jsonReq(`/api/answers/${answerId}`, "PATCH", { status: "DRAFT" }),
      ctx(answerId),
    );
    const regenerated = (await (
      await draftQuestion(new Request("http://test/x", { method: "POST" }), ctx(q.id))
    ).json()) as { answer: AnswerDTO };
    expect(regenerated.answer.id).toBe(answerId);
    expect(regenerated.answer.finalText).toBeNull();
    expect(regenerated.answer.status).toBe("DRAFT");

    // Blank edits are rejected; an "edit" identical to the draft is stored as no edit.
    expect(
      (
        await patchAnswer(
          jsonReq(`/api/answers/${answerId}`, "PATCH", { finalText: "   " }),
          ctx(answerId),
        )
      ).status,
    ).toBe(400);
    const same = (await (
      await patchAnswer(
        jsonReq(`/api/answers/${answerId}`, "PATCH", { finalText: regenerated.answer.draft }),
        ctx(answerId),
      )
    ).json()) as { answer: AnswerDTO };
    expect(same.answer.finalText).toBeNull();
    expect(
      (await patchAnswer(jsonReq(`/api/answers/${answerId}`, "PATCH", {}), ctx(answerId))).status,
    ).toBe(400);
    expect(
      (
        await patchAnswer(
          jsonReq(`/api/answers/nope`, "PATCH", { status: "APPROVED" }),
          ctx("nope"),
        )
      ).status,
    ).toBe(404);
  });

  it("exports approved answers only by default, and everything with scope=all", async () => {
    const { questionSet } = (await (
      await getSet(new Request("http://test/x"), ctx(setId))
    ).json()) as { questionSet: QuestionSetDTO };
    const [first, second] = questionSet.questions;
    await patchAnswer(
      jsonReq(`/api/answers/${first.answer!.id}`, "PATCH", { status: "APPROVED" }),
      ctx(first.answer!.id),
    );
    await patchAnswer(
      jsonReq(`/api/answers/${second.answer!.id}`, "PATCH", { status: "REJECTED" }),
      ctx(second.answer!.id),
    );

    const approvedRes = await exportSet(
      new Request(`http://test/api/question-sets/${setId}/export`),
      ctx(setId),
    );
    expect(approvedRes.headers.get("content-type")).toMatch(/text\/csv/);
    expect(approvedRes.headers.get("content-disposition")).toMatch(/Resident_FAQ-approved\.csv/);
    const approvedRows = parseCsv(await approvedRes.text()).rows;
    expect(approvedRows[0]).toEqual(["#", "Question", "Answer", "Status", "Confidence", "Sources"]);
    expect(approvedRows).toHaveLength(2);
    expect(approvedRows[1][1]).toBe(first.text);
    expect(approvedRows[1][3]).toBe("APPROVED");
    expect(approvedRows[1][5]).toMatch(/Aurora Campus Housing — Resident Handbook §\d+/);

    const allRes = await exportSet(
      new Request(`http://test/api/question-sets/${setId}/export?scope=all`),
      ctx(setId),
    );
    const allRows = parseCsv(await allRes.text()).rows;
    expect(allRows).toHaveLength(11);
    expect(allRows[2][3]).toBe("REJECTED");

    expect((await exportSet(new Request(`http://test/x?scope=weird`), ctx(setId))).status).toBe(
      400,
    );
  });

  it("re-processes a document from its stored file", async () => {
    const before = await prisma.chunk.findMany({ where: { documentId }, select: { id: true } });
    const res = await reprocess(new Request("http://test/x", { method: "POST" }), ctx(documentId));
    expect(res.status).toBe(200);
    const { document } = await res.json();
    expect(document).toMatchObject({ id: documentId, status: "READY", reprocessed: true });
    const after = await prisma.chunk.findMany({ where: { documentId }, select: { id: true } });
    expect(after).toHaveLength(before.length);
    expect(after.some((c) => before.some((b) => b.id === c.id))).toBe(false); // new passages
    expect(
      (await reprocess(new Request("http://test/x", { method: "POST" }), ctx("nope"))).status,
    ).toBe(404);
  });

  it("upgrades a document from an older version when the same file is uploaded again", async () => {
    // Simulate a document indexed by version 1: old embedding model, no stored file.
    await prisma.documentFile.delete({ where: { documentId } });
    await prisma.document.update({
      where: { id: documentId },
      data: { pipelineVersion: 1, embeddingModel: "mock-hash-v1", summary: null },
    });
    const list = (await (await listDocuments(new Request("http://test/x"), noCtx)).json()) as {
      documents: DocumentDTO[];
    };
    expect(list.documents.find((d) => d.id === documentId)).toMatchObject({
      outdated: true,
      hasFile: false,
    });

    // Without the file it can't be re-processed in place…
    const refused = await reprocess(
      new Request("http://test/x", { method: "POST" }),
      ctx(documentId),
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toMatch(/Upload the same file again/);

    // …but uploading it again does, keeping the id (and so every link to it).
    const res = await upload("aurora-housing-handbook.md", handbook);
    expect(res.status).toBe(200);
    expect((await res.json()).document).toMatchObject({ id: documentId, reprocessed: true });
    const detail = (await (
      await getDocument(new Request("http://test/x"), ctx(documentId))
    ).json()) as {
      document: DocumentDetailDTO;
    };
    expect(detail.document).toMatchObject({
      outdated: false,
      hasFile: true,
      embeddingModel: "mock-hash-v2",
    });
    expect(detail.document.summary).not.toBeNull();
  });

  it("deleting the document removes its chunks and citations but keeps answers", async () => {
    const res = await deleteDocument(
      new Request("http://test/x", { method: "DELETE" }),
      ctx(documentId),
    );
    expect(res.status).toBe(204);
    expect((await getDocument(new Request("http://test/x"), ctx(documentId))).status).toBe(404);

    const { questionSet } = (await (
      await getSet(new Request("http://test/x"), ctx(setId))
    ).json()) as { questionSet: QuestionSetDTO };
    expect(questionSet.questions.every((q) => q.answer !== null)).toBe(true);
    expect(questionSet.questions.every((q) => q.answer!.citations.length === 0)).toBe(true);

    // With no documents left, a new question is answered as "nothing found".
    const { result } = (await (
      await ask(jsonReq("/api/ask", "POST", { question: "What are the quiet hours?" }), noCtx)
    ).json()) as { result: AnswerResult };
    expect(result.insufficient).toBe(true);
    expect(result.sources).toEqual([]);
  });

  it("deletes the question set", async () => {
    expect(
      (await deleteSet(new Request("http://test/x", { method: "DELETE" }), ctx(setId))).status,
    ).toBe(204);
    expect((await getSet(new Request("http://test/x"), ctx(setId))).status).toBe(404);
    expect(
      (await deleteSet(new Request("http://test/x", { method: "DELETE" }), ctx(setId))).status,
    ).toBe(404);
  });
});
