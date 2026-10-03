-- Structure-aware chunking: section headings and page ranges on chunks.
ALTER TABLE "Chunk" ADD COLUMN "heading" TEXT;
ALTER TABLE "Chunk" ADD COLUMN "pageStart" INTEGER;
ALTER TABLE "Chunk" ADD COLUMN "pageEnd" INTEGER;

-- Documents: page count, extractive summary, and which pipeline produced them.
ALTER TABLE "Document" ADD COLUMN "pageCount" INTEGER;
ALTER TABLE "Document" ADD COLUMN "summary" TEXT;
ALTER TABLE "Document" ADD COLUMN "pipelineVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "DocumentFile" (
    "documentId" TEXT NOT NULL PRIMARY KEY,
    "data" BLOB NOT NULL,
    CONSTRAINT "DocumentFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
