import type { Metadata } from "next";
import { AskForm, type AskDocument } from "@/components/AskForm";
import { PageHero } from "@/components/ui";
import { getProvider } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { displayHeading } from "@/lib/locate";
import { parseSummary } from "@/lib/rag/summary";

export const metadata: Metadata = { title: "Ask" };
export const dynamic = "force-dynamic";

const GENERIC_SECTION =
  /^(abstract|summary|introduction|background|related work|conclusions?|discussion|references|bibliography|acknowledge?ments?|appendix.*|contents|overview|system overview)$/i;

/** Section names worth suggesting as topics: "C. Sensor Calibration" → "sensor calibration". */
function topicsOf(summaryJson: string | null): string[] {
  const outline = parseSummary(summaryJson)?.outline ?? [];
  const topics: string[] = [];
  for (const entry of outline) {
    const name = displayHeading(entry.heading)
      .replace(/^([IVXLC]+|\d+(\.\d+)*|[A-Z])[.)]\s+/, "")
      .trim();
    if (name.length < 4 || name.length > 40 || GENERIC_SECTION.test(name)) continue;
    // Keep acronyms ("ROS"), lower-case the rest.
    topics.push(name.replace(/\b([A-Z][a-z]+)\b/g, (w) => w.toLowerCase()));
    if (topics.length === 3) break;
  }
  return topics;
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string | string[] }>;
}) {
  const provider = getProvider();
  const rows = await prisma.document.findMany({
    where: { status: "READY", embeddingModel: provider.embeddingModel },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, summary: true },
  });
  const documents: AskDocument[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    topics: topicsOf(r.summary),
  }));

  const { doc } = await searchParams;
  const requested = (Array.isArray(doc) ? doc : doc ? [doc] : []).filter((id) =>
    documents.some((d) => d.id === id),
  );

  return (
    <div>
      <PageHero
        title="Ask your documents"
        description="Ask a specific question, or for an overview. Every answer shows the passages it was built from, with section and page, and whether each quote was found in the source."
      />
      <AskForm documents={documents} initialSelected={requested} demo={provider.name === "mock"} />
    </div>
  );
}
