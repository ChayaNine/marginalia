// Documents page (server component) — the landing page of the app.
//
// Reads straight from Prisma — no API round-trip for the initial render. The
// upload form and delete buttons are client components that call the API and then
// `router.refresh()` so this component re-renders with fresh data.

import { FileText } from "lucide-react";
import { getProvider, providerLabel } from "@/lib/ai";
import { DocumentTable } from "@/components/DocumentTable";
import { HowItWorks } from "@/components/HowItWorks";
import { ReceiptsTable } from "@/components/ReceiptsTable";
import { UploadForm } from "@/components/UploadForm";
import { EmptyState, Kbd, LinkButton, Notice, PageHero, SectionHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { documentWithCountInclude, toDocumentDTO } from "@/lib/dto";
import { getEnv } from "@/lib/env";
import { pluralize } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const provider = getProvider();
  const env = getEnv();
  const demo = provider.name === "mock";

  const [rows, chunkCount, questionSetCount] = await Promise.all([
    prisma.document.findMany({ orderBy: { createdAt: "desc" }, include: documentWithCountInclude }),
    prisma.chunk.count(),
    prisma.questionSet.count(),
  ]);
  const documents = rows.map(toDocumentDTO);

  const ready = documents.filter((d) => d.status === "READY");
  const stale = ready.filter((d) => d.embeddingModel !== provider.embeddingModel);
  const outdated = ready.filter((d) => d.outdated && d.embeddingModel === provider.embeddingModel);

  return (
    <div>
      <PageHero
        title="Answers with receipts"
        description="Upload the documents your answers should come from. Every answer cites the exact passage it used, and a person approves it before it ships."
      />

      <section id="upload" className="mx-auto max-w-2xl">
        <UploadForm maxUploadMb={env.MAX_UPLOAD_MB} />
      </section>

      <div className="mt-6 text-center">
        <p className="text-[15px] text-ink-muted">
          <span className="font-semibold text-ink">{pluralize(documents.length, "document")}</span>
          {" · "}
          {pluralize(chunkCount, "passage")} indexed
          {" · "}
          {pluralize(questionSetCount, "question set")}
        </p>
        <p className="mt-2 text-[13px] text-ink-faint">
          {demo ? (
            <>
              Demo mode · offline, no API key · answers quote the documents · set{" "}
              <Kbd>OPENAI_API_KEY</Kbd> or a local model for written answers
            </>
          ) : (
            <>
              {providerLabel()} · {provider.embeddingModel}
            </>
          )}
        </p>
      </div>

      <section className="mt-20">
        <SectionHeader
          title="Library"
          description="Open a document to see every passage the model can cite."
          actions={
            documents.length > 0 ? (
              <LinkButton href="/ask" variant="dark" size="sm">
                Ask a question
              </LinkButton>
            ) : undefined
          }
        />

        {(stale.length > 0 || outdated.length > 0) && (
          <Notice tone="warn" className="mb-4">
            {stale.length > 0 &&
              `${stale.length === 1 ? "1 document was" : `${stale.length} documents were`} embedded with a different model than the one running now, so they will not be searched. `}
            {outdated.length > 0 &&
              `${outdated.length === 1 ? "1 document was" : `${outdated.length} documents were`} processed by an older version of Marginalia (no pages, sections or overview). `}
            Use “Re-process” on each one below{" "}
            {[...stale, ...outdated].some((d) => !d.hasFile) &&
              "— or upload the same file again where there is no button"}
            .
          </Notice>
        )}

        {documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            icon={<FileText aria-hidden="true" className="h-8 w-8" strokeWidth={1.4} />}
          >
            Upload a PDF, Word, Markdown or text file above — or run <Kbd>npm run seed</Kbd> to load
            the sample handbook and question set.
          </EmptyState>
        ) : (
          <DocumentTable documents={documents} activeEmbeddingModel={provider.embeddingModel} />
        )}
      </section>

      <div className="mt-24">
        <HowItWorks />
      </div>

      <div className="mt-24">
        <ReceiptsTable />
      </div>
    </div>
  );
}
