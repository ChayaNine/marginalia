import { ArrowRight, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProgressBar } from "@/components/ProgressBar";
import { QuestionSetForm } from "@/components/QuestionSetForm";
import { EmptyState, PageHero, SectionHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { toQuestionSetSummaryDTO } from "@/lib/dto";
import { formatRelative, pluralize } from "@/lib/format";

export const metadata: Metadata = { title: "Question sets" };
export const dynamic = "force-dynamic";

export default async function QuestionSetsPage() {
  const rows = await prisma.questionSet.findMany({
    orderBy: { createdAt: "desc" },
    include: { questions: { select: { answer: { select: { status: true } } } } },
  });
  const sets = rows.map(toQuestionSetSummaryDTO);

  return (
    <div>
      <PageHero
        title="Question sets"
        description="Import a list of questions, let the model draft a cited answer for every one, then review each draft and export what you approved."
      />

      <section id="new" className="mx-auto max-w-2xl">
        <QuestionSetForm />
      </section>

      <section className="mt-20">
        <SectionHeader
          title="Your question sets"
          description={sets.length > 0 ? pluralize(sets.length, "set") : undefined}
        />
        {sets.length === 0 ? (
          <EmptyState
            title="No question sets yet"
            icon={<ListChecks aria-hidden="true" className="h-8 w-8" strokeWidth={1.4} />}
          >
            Create one above — the sample gives you three questions to try.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {sets.map((set) => (
              <li key={set.id}>
                <Link
                  href={`/question-sets/${set.id}`}
                  className="group block h-full rounded-2xl border border-line bg-surface p-6 transition hover:border-line-strong hover:shadow-soft"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[17px] font-bold tracking-[-0.01em] text-ink">
                        {set.name}
                      </h3>
                      <p className="mt-1 text-[13px] text-ink-muted">
                        {pluralize(set.stats.total, "question")} · created{" "}
                        {formatRelative(set.createdAt)}
                      </p>
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-1 h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                    />
                  </div>
                  <ProgressBar stats={set.stats} className="mt-5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
