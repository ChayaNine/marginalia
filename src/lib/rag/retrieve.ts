// Prisma-backed retrieval.
//
// search()   loads every READY chunk embedded with the *current* embedding model
//            (vectors from different models live in different spaces and cannot be
//            compared) and ranks them with hybrid search (./rank.ts).
// documents() lists the documents in scope, for overview questions.
// overview() loads the passages that give the gist of given documents (./overview.ts).
//
// The scan is brute force. At personal-library scale (thousands of chunks) it takes
// milliseconds and keeps everything in one SQLite file; NOTES.md describes the
// upgrade path (sqlite-vec / pgvector, a persistent keyword index).

import { prisma } from "@/lib/db";
import { tokenize } from "@/lib/text/tokenize";
import type { Retriever, ScopeDocument } from "./answer";
import type { RetrievedChunk } from "./citations";
import { selectOverviewChunks } from "./overview";
import { keywordText, rankChunks, type RankCandidate } from "./rank";
import { parseSummary } from "./summary";
import { bytesToVector } from "./vectors";

// Chunk ids are never reused (re-processing creates new chunks), so a chunk's
// tokens can be cached for the life of the process.
const tokenCache = new Map<string, string[]>();
const TOKEN_CACHE_LIMIT = 100_000;

function cachedTokens(id: string, text: string): string[] {
  let tokens = tokenCache.get(id);
  if (!tokens) {
    if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.clear();
    tokens = tokenize(text);
    tokenCache.set(id, tokens);
  }
  return tokens;
}

const chunkSelect = {
  id: true,
  documentId: true,
  index: true,
  content: true,
  heading: true,
  pageStart: true,
  pageEnd: true,
  document: { select: { title: true } },
} as const;

export function createDbRetriever(embeddingModel: string): Retriever {
  const scope = (documentIds?: string[]) => ({
    status: "READY",
    embeddingModel,
    ...(documentIds && documentIds.length > 0 ? { id: { in: documentIds } } : {}),
  });

  return {
    async search(queryVector, { k, query, documentIds }) {
      const rows = await prisma.chunk.findMany({
        where: { document: scope(documentIds) },
        select: { ...chunkSelect, embedding: true },
      });
      const candidates: RankCandidate[] = rows.map((row) => {
        const chunk = {
          chunkId: row.id,
          documentId: row.documentId,
          documentTitle: row.document.title,
          chunkIndex: row.index,
          content: row.content,
          heading: row.heading,
          pageStart: row.pageStart,
          pageEnd: row.pageEnd,
        };
        return {
          ...chunk,
          embedding: bytesToVector(row.embedding),
          tokens: cachedTokens(row.id, keywordText(chunk)),
        };
      });
      return rankChunks(candidates, queryVector, query, { k });
    },

    async documents(documentIds) {
      const rows = await prisma.document.findMany({
        where: scope(documentIds),
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true },
      });
      return rows satisfies ScopeDocument[];
    },

    async overview(documentIds, perDocument) {
      const out: RetrievedChunk[] = [];
      for (const documentId of documentIds) {
        const document = await prisma.document.findUnique({
          where: { id: documentId },
          select: { title: true, summary: true },
        });
        if (!document) continue;
        const chunks = await prisma.chunk.findMany({
          where: { documentId },
          orderBy: { index: "asc" },
          select: chunkSelect,
        });
        const picked = new Set(
          selectOverviewChunks(chunks, parseSummary(document.summary), perDocument),
        );
        for (const row of chunks) {
          if (!picked.has(row.index)) continue;
          out.push({
            chunkId: row.id,
            documentId,
            documentTitle: document.title,
            chunkIndex: row.index,
            content: row.content,
            heading: row.heading,
            pageStart: row.pageStart,
            pageEnd: row.pageEnd,
            score: 1,
            vectorScore: 0,
            keywordScore: 0,
          });
        }
      }
      return out;
    },
  };
}
