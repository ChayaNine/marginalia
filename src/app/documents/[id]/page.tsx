// Document detail: an overview computed at upload (abstract, key points, outline),
// then every indexed passage with its section and page — exactly what the model is
// shown when a passage is cited.

import { ExternalLink, MessageSquareText } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import { ReprocessButton } from "@/components/ReprocessButton";
import {
  BackLink,
  Card,
  CheckLabel,
  ErrorBox,
  LinkButton,
  Notice,
  PageHeader,
  SectionHeader,
} from "@/components/ui";
import { getProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { documentWithCountInclude, toDocumentDetailDTO } from "@/lib/dto";
import { fileKindLabel, formatBytes, formatNumber, formatRelative } from "@/lib/format";
import { displayHeading, fileHref, formatPages, passageHref } from "@/lib/locate";

export const dynamic = "force-dynamic";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** "p. 4 ↗" linking into the original PDF, or nothing for formats without pages. */
function PageLink({
  documentId,
  page,
  pageEnd,
}: {
  documentId: string;
  page: number | null;
  pageEnd?: number | null;
}) {
  if (!page) return null;
  return (
    <a
      href={fileHref(documentId, page)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
      title="Open the original at this page"
    >
      {formatPages(page, pageEnd)}
      <ExternalLink aria-hidden="true" className="h-3 w-3" />
    </a>
  );
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.document.findUnique({
    where: { id },
    include: {
      ...documentWithCountInclude,
      chunks: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          index: true,
          content: true,
          heading: true,
          pageStart: true,
          pageEnd: true,
          tokenCount: true,
        },
      },
    },
  });
  if (!row) notFound();

  const doc = toDocumentDetailDTO(row);
  const summary = doc.summary;
  const provider = getProvider();
  const otherModel = doc.status === "READY" && doc.embeddingModel !== provider.embeddingModel;
  const canReprocess = doc.hasFile && doc.status !== "PROCESSING";
  const kind = fileKindLabel(doc.filename, doc.mimeType);

  return (
    <div className="pt-6">
      <BackLink href="/">All documents</BackLink>

      <div className="mt-6">
        <PageHeader
          eyebrow="Document"
          title={doc.title}
          description={<span className="font-mono text-[13px] break-all">{doc.filename}</span>}
          actions={
            <>
              {doc.status === "READY" && !otherModel && (
                <LinkButton href={`/ask?doc=${doc.id}`} variant="primary" size="md">
                  <MessageSquareText aria-hidden="true" className="h-4 w-4" />
                  Ask about it
                </LinkButton>
              )}
              {doc.hasFile && (
                <LinkButton href={fileHref(doc.id)} newTab size="md">
                  Open original <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </LinkButton>
              )}
              <DeleteButton
                url={`/api/documents/${doc.id}`}
                confirmText={`Delete "${doc.title}"?`}
                redirectTo="/"
                size="md"
              />
            </>
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Status">
          {doc.status === "READY" ? (
            <CheckLabel>Ready</CheckLabel>
          ) : doc.status === "FAILED" ? (
            <span className="text-bad">✕ Failed</span>
          ) : (
            <span className="text-info">Processing…</span>
          )}
        </Fact>
        <Fact label="Type">{kind}</Fact>
        {doc.pageCount ? (
          <Fact label="Pages">{formatNumber(doc.pageCount)}</Fact>
        ) : (
          <Fact label="Characters">{formatNumber(doc.charCount)}</Fact>
        )}
        <Fact label="Passages">{formatNumber(doc.chunkCount)}</Fact>
        <Fact label="Size">{formatBytes(doc.sizeBytes)}</Fact>
        <Fact label="Uploaded">
          <span title={new Date(doc.createdAt).toLocaleString()}>
            {formatRelative(doc.createdAt)}
          </span>
        </Fact>
      </dl>
      <p className="mt-3 text-xs text-ink-faint">
        Embedded with <span className="font-mono">{doc.embeddingModel}</span>
      </p>

      {(doc.outdated || otherModel) && doc.status !== "FAILED" && (
        <Notice tone="warn" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {otherModel
                ? `This document was embedded with ${doc.embeddingModel}, so the current model (${provider.embeddingModel}) can't search it.`
                : "This document was processed by an older version of Marginalia: passages may cut through sentences and have no page numbers or overview."}{" "}
              {canReprocess
                ? "Re-process it to fix that."
                : "Upload the same file again to re-process it."}
            </span>
            {canReprocess && <ReprocessButton documentId={doc.id} variant="dark" />}
          </div>
        </Notice>
      )}

      {doc.status === "FAILED" && (
        <ErrorBox className="mt-8">
          <strong>Processing failed:</strong> {doc.error ?? "unknown error"}
          {canReprocess ? (
            <div className="mt-3">
              <ReprocessButton documentId={doc.id} label="Try again" />
            </div>
          ) : (
            " Delete this entry and upload the file again once the problem is fixed."
          )}
        </ErrorBox>
      )}

      {summary &&
        (summary.abstract || summary.keyPoints.length > 0 || summary.outline.length > 0) && (
          <section className="mt-14" aria-labelledby="overview">
            <SectionHeader
              title="Overview"
              description="Extracted from the document itself when it was uploaded — no model involved."
            />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <Card className="p-6 sm:p-8">
                {summary.abstract && (
                  <div className="mb-8">
                    <h3 id="overview" className="mb-2 text-sm font-semibold text-ink">
                      Abstract
                    </h3>
                    <p className="text-[15px] leading-7 whitespace-pre-line text-ink">
                      {summary.abstract}
                    </p>
                  </div>
                )}
                {summary.keyPoints.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-ink">Key points</h3>
                    <ul className="space-y-3">
                      {summary.keyPoints.map((point, i) => (
                        <li key={i} className="flex gap-3 text-[15px] leading-7 text-ink">
                          <span
                            aria-hidden="true"
                            className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                          />
                          <span className="min-w-0">
                            {point.text}{" "}
                            <span className="ml-1 inline-flex gap-2 text-xs whitespace-nowrap text-ink-faint">
                              {point.chunkIndex !== null && (
                                <a
                                  href={passageHref(doc.id, point.chunkIndex)}
                                  className="hover:text-brand hover:underline"
                                >
                                  §{point.chunkIndex + 1}
                                </a>
                              )}
                              {doc.hasFile && <PageLink documentId={doc.id} page={point.page} />}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {summary.outline.length > 0 && (
                <Card className="h-fit p-6">
                  <h3 className="mb-3 text-sm font-semibold text-ink">Contents</h3>
                  <ol className="space-y-1.5 text-sm">
                    {summary.outline.map((entry, i) => (
                      <li key={i} className={entry.level > 1 ? "pl-4" : undefined}>
                        <div className="flex items-baseline justify-between gap-3">
                          {entry.chunkIndex !== null ? (
                            <a
                              href={passageHref(doc.id, entry.chunkIndex)}
                              className={
                                entry.level > 1
                                  ? "text-ink-muted hover:text-brand"
                                  : "font-medium text-ink hover:text-brand"
                              }
                            >
                              {displayHeading(entry.heading)}
                            </a>
                          ) : (
                            <span className="text-ink-muted">{displayHeading(entry.heading)}</span>
                          )}
                          {entry.page && (
                            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                              {entry.page}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </div>
          </section>
        )}

      {row.chunks.length > 0 && (
        <section className="mt-14">
          <SectionHeader
            title="Passages"
            description="How the document was cut for search: whole sentences, one section at a time. This is exactly what the model is shown when an answer cites §n."
          />
          <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {row.chunks.map((chunk) => (
              <li
                key={chunk.id}
                id={`s${chunk.index + 1}`}
                className="grid scroll-mt-28 gap-2 px-6 py-6 target:bg-brand-soft/40 sm:grid-cols-[4rem_1fr] sm:gap-4"
              >
                <span className="text-sm font-bold text-brand">§{chunk.index + 1}</span>
                <div className="min-w-0">
                  {(chunk.heading || chunk.pageStart) && (
                    <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                      {chunk.heading && (
                        <span className="font-semibold text-ink-muted">
                          {chunk.heading.split(" › ").map(displayHeading).join(" › ")}
                        </span>
                      )}
                      {doc.hasFile ? (
                        <PageLink
                          documentId={doc.id}
                          page={chunk.pageStart}
                          pageEnd={chunk.pageEnd}
                        />
                      ) : (
                        formatPages(chunk.pageStart, chunk.pageEnd)
                      )}
                    </p>
                  )}
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
                    {chunk.content}
                  </p>
                  <p className="mt-3 text-xs text-ink-faint">
                    ~{formatNumber(chunk.tokenCount)} tokens · {formatNumber(chunk.content.length)}{" "}
                    characters
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
