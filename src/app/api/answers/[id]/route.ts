// PATCH /api/answers/:id — the human review step.
// Body: { status?: "DRAFT" | "APPROVED" | "REJECTED", finalText?: string | null }
//   finalText = edited wording (null restores the AI draft).

import { z } from "zod";
import { prisma } from "@/lib/db";
import { answerWithCitationsInclude, toAnswerDTO } from "@/lib/dto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { json, parseJsonBody, withErrorHandling, type RouteContext } from "@/lib/http";
import { answerStatusSchema } from "@/lib/status";

export const dynamic = "force-dynamic";

type Context = RouteContext<{ id: string }>;

const bodySchema = z
  .object({
    status: answerStatusSchema.optional(),
    finalText: z.string().max(10_000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.finalText !== undefined, {
    message: "Provide status and/or finalText",
  });

export const PATCH = withErrorHandling<Context>(async (request, { params }) => {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema);

  const existing = await prisma.answer.findUnique({
    where: { id },
    select: { id: true, draft: true },
  });
  if (!existing) throw new NotFoundError("Answer");

  let finalText: string | null | undefined = body.finalText;
  if (typeof finalText === "string") {
    finalText = finalText.trim();
    if (finalText.length === 0)
      throw new ValidationError("finalText cannot be blank; send null to restore the draft");
    // An "edit" identical to the draft is not an edit.
    if (finalText === existing.draft) finalText = null;
  }

  const updated = await prisma.answer.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(finalText !== undefined ? { finalText } : {}),
    },
    include: answerWithCitationsInclude,
  });

  return json({ answer: toAnswerDTO(updated) });
});
