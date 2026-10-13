export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { bankSuspenseNoteSchema } from "@/lib/validations";
import { NOTE_SELECT, toNoteDto } from "../../_lib/case-shape";

const log = createLogger("bank-suspense");

// POST /api/bank-suspense/[id]/notes — one entry in a case's chase history (plan
// 1210-bank-accounts-and-suspense, R8, D2): "Asked Deekshith on WhatsApp", "He says it is the
// Bajaj refund". The ledger-claims notes pattern (api/ledger/gaps/[id]/notes). The author is
// the session's user — never taken from the body. Allowed on a closed case too: an answer that
// arrives after the case closed still belongs in its history.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let id: string | undefined;
  try {
    const user = await requireFeature("bank_recon", "edit");
    ({ id } = await params);
    const data = bankSuspenseNoteSchema.parse(await req.json().catch(() => null));

    const found = await prisma.bankSuspense.findUnique({ where: { id }, select: { id: true, bankTxnId: true } });
    if (!found) return errorResponse("This suspense case no longer exists.", 404);

    const note = await prisma.bankSuspenseNote.create({
      data: { suspenseId: found.id, body: data.text, isSystem: false, authorId: user.id },
      select: NOTE_SELECT,
    });

    log.info("note added", { suspenseId: found.id, bankTxnId: found.bankTxnId, noteId: note.id });
    return successResponse(toNoteDto(note), 201);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("note refused", { suspenseId: id, status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Write a note";
      log.warn("note rejected", { suspenseId: id, message });
      return errorResponse(message, 400);
    }
    return failure(error, { scope: "bank-suspense", step: "note", suspenseId: id });
  }
}
