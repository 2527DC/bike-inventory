export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// PATCH — when issues are shared with a vendor, move any that are still OPEN to IN_PROGRESS.
// Constrained transition (OPEN → IN_PROGRESS only, on the given ids), gated like the Ops Issues
// page view so the ops manager — including CUSTOM roles with vendor_issues access — can trigger it.
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireFeature("vendor_issues", "view");

    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (!ids.length) return errorResponse("No issue IDs provided", 400);

    const open = await prisma.vendorIssue.findMany({
      where: { id: { in: ids }, status: "OPEN" },
      select: { id: true },
    });
    if (!open.length) return successResponse({ updatedIds: [] });

    const openIds = open.map((o) => o.id);
    await prisma.vendorIssue.updateMany({
      where: { id: { in: openIds } },
      data: { status: "IN_PROGRESS" },
    });

    // Timeline note per issue so the follow-up log records the share → In Progress move.
    await prisma.vendorIssueNote.createMany({
      data: openIds.map((id) => ({
        issueId: id,
        text: "Shared with vendor on WhatsApp — moved to In Progress",
        authorId: user.id,
      })),
    });

    return successResponse({ updatedIds: openIds });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update issues", 400);
  }
}
