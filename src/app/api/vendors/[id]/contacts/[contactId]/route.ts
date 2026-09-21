export const dynamic = "force-dynamic";

// ─── NO LONGER CALLED (plan 2109 R28, Q17a, 21 Sep 2026) ────────────────────────────────────
// A vendor now has ONE contact, held on the Vendor row (contactPerson, contactDesignation, phone,
// email, whatsappNumber) and edited through PUT /api/vendors/[id]. The vendor screen no longer
// calls this route. It is kept, not deleted, because VendorContact still exists until a later
// release drops the table (CLAUDE.md migration rule 7); delete this route in that release.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  try {
    await requireFeature("vendors", "delete");
    const { id, contactId } = await params;

    const contact = await prisma.vendorContact.findUnique({ where: { id: contactId } });
    if (!contact || contact.vendorId !== id) return errorResponse("Contact not found", 404);

    await prisma.vendorContact.delete({ where: { id: contactId } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to delete contact", 500);
  }
}
