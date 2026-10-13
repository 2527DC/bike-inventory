export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { vendorIssueUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { userCan } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendor-issues:detail");

// The credit note that settles an issue (plan 1210 credit notes, Part 9). Shown on the issue,
// picked by a person in "Settled by credit note"; never set automatically.
const vendorCreditSelect = {
  id: true,
  vendorId: true,
  creditNoteNo: true,
  referenceNo: true,
  creditDate: true,
  amount: true,
  status: true,
} as const;

const issueInclude = {
  vendor: {
    select: {
      // The contact person lives on Vendor since plan 2109 (R28); VendorContact is no longer read.
      id: true, name: true, code: true, whatsappNumber: true, phone: true, contactPerson: true,
    },
  },
  bill: { select: { id: true, billNo: true, amount: true } },
  vendorCredit: { select: vendorCreditSelect },
  createdBy: { select: { id: true, name: true } },
  notes: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
};

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let issueId: string | undefined;
  try {
    await requireFeature("vendor_issues", "view");
    const { id } = await params;
    issueId = id;

    const issue = await prisma.vendorIssue.findUnique({
      where: { id },
      include: issueInclude,
    });

    if (!issue) return errorResponse("Issue not found", 404);
    return successResponse(issue);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    log.error("issue fetch failed", { issueId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to fetch issue",
      500
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let issueId: string | undefined;
  try {
    const user = await requireFeature("vendor_issues", "edit");
    const { id } = await params;
    issueId = id;
    const body = await req.json();
    const parsed = vendorIssueUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid issue update";
      log.warn("issue update refused", { issueId: id, message });
      return errorResponse(message, 400);
    }
    const data = parsed.data;

    // Fetch current issue to detect status transitions and credit-link changes
    const current = await prisma.vendorIssue.findUnique({
      where: { id },
      select: {
        status: true,
        vendorId: true,
        issueNo: true,
        vendorCreditId: true,
        vendorCredit: { select: { id: true, vendorId: true, creditNoteNo: true } },
      },
    });

    if (!current) return errorResponse("Issue not found", 404);

    // Reassigning an issue to a different brand is a supervisory action, and the brand must exist.
    if (data.vendorId !== undefined) {
      if (!(await userCan(user.id, "vendor_issues", "approve"))) {
        return errorResponse("You do not have permission to change the brand", 403);
      }
      const v = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true } });
      if (!v) return errorResponse("Selected brand not found", 400);
    }

    // ── Settled by credit note (Part 9) ────────────────────────────────────────────────────
    // The credit must be one of THIS issue's brand's credits — after any brand change made in
    // the same request. A void credit settles nothing, so it cannot be picked.
    const vendorAfter = data.vendorId ?? current.vendorId;
    let creditChange: { to: { id: string; creditNoteNo: string; amount: number } | null } | null = null;
    if (data.vendorCreditId !== undefined && data.vendorCreditId !== current.vendorCreditId) {
      if (data.vendorCreditId === null) {
        creditChange = { to: null };
      } else {
        if (!vendorAfter) {
          log.warn("credit link refused: issue has no brand", { issueId: id, vendorCreditId: data.vendorCreditId });
          return errorResponse("Only an issue raised against a brand can be settled by its credit note", 400);
        }
        const credit = await prisma.vendorCredit.findUnique({
          where: { id: data.vendorCreditId },
          select: { id: true, vendorId: true, creditNoteNo: true, amount: true, status: true },
        });
        if (!credit) {
          log.warn("credit link refused: credit not found", { issueId: id, vendorCreditId: data.vendorCreditId });
          return errorResponse("That credit note was not found. Reload and pick again.", 400);
        }
        if (credit.vendorId !== vendorAfter) {
          log.warn("credit link refused: other vendor's credit", {
            issueId: id,
            vendorCreditId: credit.id,
            creditVendorId: credit.vendorId,
            issueVendorId: vendorAfter,
          });
          return errorResponse(`Credit note ${credit.creditNoteNo} belongs to another supplier, not this issue's brand`, 400);
        }
        if (credit.status === "VOID") {
          log.warn("credit link refused: void credit", { issueId: id, vendorCreditId: credit.id });
          return errorResponse(`Credit note ${credit.creditNoteNo} is void in Zoho and settles nothing`, 400);
        }
        creditChange = { to: { id: credit.id, creditNoteNo: credit.creditNoteNo, amount: credit.amount } };
      }
    } else if (
      data.vendorId !== undefined &&
      data.vendorId !== current.vendorId &&
      current.vendorCredit &&
      current.vendorCredit.vendorId !== data.vendorId
    ) {
      // The brand moved and the linked credit is the old brand's: it cannot settle this issue now.
      creditChange = { to: null };
    }

    // Handle resolvedAt auto-set/clear on status transitions
    let resolvedAt: Date | null | undefined = undefined;
    if (data.status === "RESOLVED" && current.status !== "RESOLVED") {
      resolvedAt = new Date();
    } else if (data.status && data.status !== "RESOLVED" && current.status === "RESOLVED") {
      resolvedAt = null;
    }

    // The trail lines this update writes, oldest first (the list is shown newest first).
    const trail: string[] = [];
    if (creditChange) {
      const was = current.vendorCredit?.creditNoteNo;
      const to = creditChange.to;
      trail.push(
        to
          ? was
            ? `Settling credit note changed from ${was} to ${to.creditNoteNo} (${inr(to.amount)})`
            : `Settled by credit note ${to.creditNoteNo} (${inr(to.amount)})`
          : data.vendorCreditId === undefined
            ? `Credit note ${was} unlinked — it belongs to the previous brand`
            : `Credit note ${was} unlinked`
      );
    }
    // Auto-log a note on a status change so the follow-up timeline records every stage move.
    if (data.status && data.status !== current.status) {
      const label = data.status.replace(/_/g, " ").toLowerCase();
      trail.push(
        data.status === "RESOLVED" && data.resolution
          ? `Marked resolved — ${data.resolution}`
          : `Status changed to ${label}`
      );
    }

    const issue = await prisma.$transaction(async (tx) => {
      await tx.vendorIssue.update({
        where: { id },
        data: {
          ...(data.status && { status: data.status }),
          ...(data.priority && { priority: data.priority }),
          ...(data.resolution !== undefined && { resolution: data.resolution }),
          ...(data.docLink !== undefined && { docLink: data.docLink || null }),
          ...(data.ticketNo !== undefined && { ticketNo: data.ticketNo.trim() || null }),
          ...(data.serviceLocation !== undefined && { serviceLocation: data.serviceLocation }),
          ...(data.vendorId !== undefined && { vendorId: data.vendorId }),
          ...(creditChange && { vendorCreditId: creditChange.to?.id ?? null }),
          ...(resolvedAt !== undefined && { resolvedAt }),
        },
      });
      // Explicit, 1 ms apart: inside a transaction the column default (now()) is the SAME
      // instant for every row, and the trail is read newest first by createdAt.
      const base = Date.now();
      for (const [i, text] of trail.entries()) {
        await tx.vendorIssueNote.create({
          data: { issueId: id, text, authorId: user.id, createdAt: new Date(base + i) },
        });
      }
      if (creditChange) {
        await logActivity(tx, {
          module: "vendor_issues",
          action: creditChange.to ? "credit_linked" : "credit_unlinked",
          entityType: "VendorIssue",
          entityId: id,
          entityRef: current.issueNo,
          fromValue: current.vendorCredit?.creditNoteNo ?? null,
          toValue: creditChange.to?.creditNoteNo ?? null,
          userId: user.id,
          userName: user.name,
        });
      }
      return tx.vendorIssue.findUniqueOrThrow({ where: { id }, include: issueInclude });
    });

    if (creditChange) {
      log.info("issue credit link changed", {
        issueId: id,
        vendorCreditId: creditChange.to?.id ?? null,
        previousCreditId: current.vendorCreditId,
        userId: user.id,
      });
    }
    return successResponse(issue);
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    log.error("issue update failed", { issueId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to update issue",
      400
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let issueId: string | undefined;
  try {
    await requireFeature("vendor_issues", "delete");
    const { id } = await params;
    issueId = id;

    const issue = await prisma.vendorIssue.findUnique({ where: { id } });
    if (!issue) return errorResponse("Issue not found", 404);

    await prisma.vendorIssue.delete({ where: { id } });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(error.message, error.status);
    log.error("issue delete failed", { issueId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to delete issue",
      500
    );
  }
}
