export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { vendorIssueNoteSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: add a follow-up note to an issue. Anyone who can edit vendor issues (built-in roles via
// fallback, or a CUSTOM role granted vendor_issues.edit) can log a note.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("vendor_issues", "edit");
    const { id } = await params;
    const { text } = vendorIssueNoteSchema.parse(await req.json());

    const issue = await prisma.vendorIssue.findUnique({ where: { id }, select: { id: true } });
    if (!issue) return errorResponse("Issue not found", 404);

    const note = await prisma.vendorIssueNote.create({
      data: { issueId: id, text: text.trim(), authorId: user.id },
      include: { author: { select: { id: true, name: true } } },
    });

    return successResponse(note, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to add note", 400);
  }
}
