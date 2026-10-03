import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewWorkbench } from "@/components/ReviewWorkbench";
import { prisma } from "@/lib/db";
import { questionSetInclude, toQuestionSetDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const set = await prisma.questionSet.findUnique({ where: { id }, select: { name: true } });
  return { title: set?.name ?? "Question set" };
}

export default async function QuestionSetPage({ params }: Props) {
  const { id } = await params;
  const row = await prisma.questionSet.findUnique({ where: { id }, include: questionSetInclude });
  if (!row) notFound();

  return <ReviewWorkbench initial={toQuestionSetDTO(row)} />;
}
