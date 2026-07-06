export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// PATCH — add/edit an already-logged issue's brand ticket number and service location.
// These are low-sensitivity operational fields, so it's gated like the Ops Issues page view
// (incl. CUSTOM roles with vendor_issues access) rather than the stricter edit permission —
// so the ops manager can fill in a ticket number when the brand replies, not just admins.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("vendor_issues", "view", [
      "ADMIN", "CEO", "SUPERVISOR", "PURCHASE_MANAGER", "ACCOUNTS_MANAGER", "STORE_MANAGER", "SERVICE_MANAGER",
    ]);
    const { id } = await params;
    const body = await req.json();

    const data: { ticketNo?: string | null; serviceLocation?: string | null } = {};
    if (body.ticketNo !== undefined) {
      data.ticketNo = typeof body.ticketNo === "string" && body.ticketNo.trim() ? body.ticketNo.trim() : null;
    }
    if (body.serviceLocation !== undefined) {
      const sl = body.serviceLocation;
      if (sl === "" || sl === null) data.serviceLocation = null;
      else if (sl === "IN_STORE" || sl === "CUSTOMER") data.serviceLocation = sl;
      else return errorResponse("Invalid service location", 400);
    }
    if (Object.keys(data).length === 0) return errorResponse("Nothing to update", 400);

    const issue = await prisma.vendorIssue.update({
      where: { id },
      data,
      select: { id: true, ticketNo: true, serviceLocation: true },
    });

    return successResponse(issue);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update issue", 400);
  }
}
