export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

const SERVICE_LABEL: Record<string, string> = { IN_STORE: "In-Store Service", CUSTOMER: "Customer Service" };

// PATCH — operational edits on an already-logged issue: brand ticket number, service location,
// and brand (vendor) reassignment. Gated like the Ops Issues page view (incl. CUSTOM roles with
// vendor_issues access) so the ops manager can do them, not just admins. Every change is written
// to the issue's timeline (VendorIssueNote) so each ticket has a full record of actions taken.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("vendor_issues", "view", [
      "ADMIN", "CEO", "SUPERVISOR", "PURCHASE_MANAGER", "ACCOUNTS_MANAGER", "STORE_MANAGER", "SERVICE_MANAGER",
    ]);
    const { id } = await params;
    const body = await req.json();

    const current = await prisma.vendorIssue.findUnique({
      where: { id },
      select: { ticketNo: true, serviceLocation: true, vendorId: true },
    });
    if (!current) return errorResponse("Issue not found", 404);

    const data: { ticketNo?: string | null; serviceLocation?: string | null; vendorId?: string } = {};
    const actions: string[] = [];

    if (body.ticketNo !== undefined) {
      const val = typeof body.ticketNo === "string" && body.ticketNo.trim() ? body.ticketNo.trim() : null;
      if (val !== current.ticketNo) {
        data.ticketNo = val;
        actions.push(val ? `Ticket number set to ${val}` : "Ticket number cleared");
      }
    }

    if (body.serviceLocation !== undefined) {
      const sl = body.serviceLocation;
      let val: string | null;
      if (sl === "" || sl === null) val = null;
      else if (sl === "IN_STORE" || sl === "CUSTOMER") val = sl;
      else return errorResponse("Invalid service location", 400);
      if (val !== current.serviceLocation) {
        data.serviceLocation = val;
        actions.push(val ? `Service location set to ${SERVICE_LABEL[val]}` : "Service location cleared");
      }
    }

    if (body.vendorId !== undefined && body.vendorId && body.vendorId !== current.vendorId) {
      const v = await prisma.vendor.findUnique({ where: { id: body.vendorId }, select: { id: true, name: true } });
      if (!v) return errorResponse("Selected brand not found", 400);
      data.vendorId = body.vendorId;
      actions.push(`Brand changed to ${v.name}`);
    }

    if (Object.keys(data).length > 0) {
      await prisma.vendorIssue.update({ where: { id }, data });
      if (actions.length) {
        await prisma.vendorIssueNote.createMany({
          data: actions.map((text) => ({ issueId: id, text, authorId: user.id })),
        });
      }
    }

    const issue = await prisma.vendorIssue.findUnique({
      where: { id },
      include: {
        vendor: {
          select: {
            id: true, name: true, code: true, whatsappNumber: true, phone: true,
            contacts: {
              where: { OR: [{ whatsapp: { not: null } }, { phone: { not: null } }] },
              orderBy: { isPrimary: "desc" },
              take: 1,
              select: { name: true, phone: true, whatsapp: true },
            },
          },
        },
        bill: { select: { id: true, billNo: true, amount: true } },
        createdBy: { select: { id: true, name: true } },
        notes: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return successResponse(issue);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to update issue", 400);
  }
}
