// Progress counts for a question set. Browser-safe (no zod, no Prisma) because the
// review workbench recomputes these after every action.

export type QuestionSetStats = {
  total: number;
  pending: number;
  drafted: number;
  approved: number;
  rejected: number;
};

export function computeStats(questions: { answer: { status: string } | null }[]): QuestionSetStats {
  const stats: QuestionSetStats = {
    total: questions.length,
    pending: 0,
    drafted: 0,
    approved: 0,
    rejected: 0,
  };
  for (const q of questions) {
    if (!q.answer) stats.pending++;
    else if (q.answer.status === "APPROVED") stats.approved++;
    else if (q.answer.status === "REJECTED") stats.rejected++;
    else stats.drafted++;
  }
  return stats;
}
