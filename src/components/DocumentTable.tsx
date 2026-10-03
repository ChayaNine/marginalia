// Server component: the document library, laid out like a clean comparison table.
// Row actions (re-process, delete) are client islands.

import Link from "next/link";
import type { DocumentDTO } from "@/lib/dto";
import { fileKindLabel, formatBytes, formatNumber, formatRelative } from "@/lib/format";
import { DeleteButton } from "./DeleteButton";
import { ReprocessButton } from "./ReprocessButton";
import { CheckLabel, cn } from "./ui";

const kindColor: Record<string, string> = {
  PDF: "bg-red-50 text-red-600",
  DOCX: "bg-blue-50 text-blue-600",
  MD: "bg-brand-soft text-brand",
  TXT: "bg-muted text-ink-muted",
  CSV: "bg-emerald-50 text-emerald-700",
};

function Status({ doc, stale }: { doc: DocumentDTO; stale: boolean }) {
  if (stale) return <span className="font-semibold text-warn">! Other model</span>;
  if (doc.status === "READY" && doc.outdated)
    return <span className="font-semibold text-warn">↻ Outdated</span>;
  if (doc.status === "READY") return <CheckLabel>Ready</CheckLabel>;
  if (doc.status === "FAILED") return <span className="font-semibold text-bad">✕ Failed</span>;
  return <span className="font-semibold text-info">Processing…</span>;
}

export function DocumentTable({
  documents,
  activeEmbeddingModel,
}: {
  documents: DocumentDTO[];
  activeEmbeddingModel: string;
}) {
  return (
    <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-ink-faint">
            <th className="px-6 py-4 font-medium">Document</th>
            <th className="px-4 py-4 text-right font-medium">Passages</th>
            <th className="px-4 py-4 text-right font-medium">Size</th>
            <th className="px-4 py-4 text-center font-medium">Status</th>
            <th className="px-4 py-4 font-medium">Added</th>
            <th className="w-14 px-4 py-4">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {documents.map((doc) => {
            const stale = doc.status === "READY" && doc.embeddingModel !== activeEmbeddingModel;
            const kind = fileKindLabel(doc.filename, doc.mimeType);
            return (
              <tr key={doc.id} className="align-middle transition-colors hover:bg-muted/50">
                <td className="px-6 py-5">
                  <div className="flex items-start gap-3.5">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide",
                        kindColor[kind] ?? "bg-muted text-ink-muted",
                      )}
                    >
                      {kind.slice(0, 4)}
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="font-semibold text-ink transition-colors hover:text-brand"
                      >
                        {doc.title}
                      </Link>
                      <div
                        className="mt-0.5 max-w-xs truncate text-[13px] text-ink-muted"
                        title={doc.filename}
                      >
                        {doc.filename}
                      </div>
                      {doc.status === "FAILED" && doc.error && (
                        <div className="mt-1.5 max-w-md text-[13px] text-bad">{doc.error}</div>
                      )}
                      {stale && (
                        <div className="mt-1.5 max-w-md text-[13px] text-warn">
                          Embedded with <code className="font-mono">{doc.embeddingModel}</code>, so
                          the current model can&apos;t search it.{" "}
                          {doc.hasFile ? "Re-process to re-embed." : "Upload it again to re-embed."}
                        </div>
                      )}
                      {!stale && doc.status === "READY" && doc.outdated && (
                        <div className="mt-1.5 max-w-md text-[13px] text-warn">
                          Processed by an older version: no pages, sections or overview.{" "}
                          {doc.hasFile ? "Re-process to upgrade." : "Upload it again to upgrade."}
                        </div>
                      )}
                      {(stale || doc.outdated || doc.status === "FAILED") && doc.hasFile && (
                        <div className="mt-2">
                          <ReprocessButton documentId={doc.id} />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-5 text-right tabular-nums text-ink-muted">
                  {formatNumber(doc.chunkCount)}
                  {doc.pageCount ? (
                    <div className="text-xs text-ink-faint">{formatNumber(doc.pageCount)} pp.</div>
                  ) : null}
                </td>
                <td className="px-4 py-5 text-right whitespace-nowrap tabular-nums text-ink-muted">
                  {formatBytes(doc.sizeBytes)}
                </td>
                <td className="px-4 py-5 text-center whitespace-nowrap">
                  <Status doc={doc} stale={stale} />
                </td>
                <td
                  className="px-4 py-5 whitespace-nowrap text-ink-muted"
                  title={new Date(doc.createdAt).toLocaleString()}
                >
                  {formatRelative(doc.createdAt)}
                </td>
                <td className="px-4 py-5 text-right">
                  <DeleteButton
                    iconOnly
                    label={`Delete ${doc.title}`}
                    url={`/api/documents/${doc.id}`}
                    confirmText={`Delete "${doc.title}"? Answers that cite it will lose those citations.`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
