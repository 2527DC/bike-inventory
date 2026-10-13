export const dynamic = "force-dynamic";

// GET /api/vendors/[id]/credits?status=open|all — the vendor's credit notes (plan 1210 credit
// notes, Part 4). Every credit, not the 10 newest the vendor route used to include (X9).
//
// Credit notes are not typed here (D3): they are entered in Zoho Books and fetched on /bills.
// What this app adds is Apply credit (Q1 = b, D18), so each credit's applications are split by
// where they were made — "here" (source APP) or "in Zoho" (source ZOHO).
//
//   open = amount − usedAmount, where usedAmount = (Zoho total − Zoho balance) + Σ APP
//   applications. It goes NEGATIVE when the same credit was applied both here and in Zoho for
//   more than its total (D17). Such a credit is returned under "open" too, flagged, so the red
//   banner on the Credits tab is never filtered away.
import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("payables:credits");

const querySchema = z.object({
  status: z.enum(["open", "all"], { message: "status must be open or all" }).default("open"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.01;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let vendorId: string | null = null;
  try {
    await requireFeature("vendors", "view");
    const { id } = await params;
    vendorId = id;
    const { status } = querySchema.parse({
      status: req.nextUrl.searchParams.get("status") ?? undefined,
    });
    const started = Date.now();

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const rows = await prisma.vendorCredit.findMany({
      where: { vendorId: id },
      orderBy: [{ creditDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        creditNoteNo: true,
        referenceNo: true,
        creditDate: true,
        reason: true,
        notes: true,
        status: true,
        amount: true,
        usedAmount: true,
        zohoVendorCreditId: true,
        lastSyncedAt: true,
        storeId: true,
        store: { select: { id: true, code: true, name: true } },
        applications: {
          orderBy: [{ appliedDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            source: true,
            amount: true,
            appliedDate: true,
            note: true,
            billId: true,
            bill: { select: { id: true, billNo: true } },
            appliedBy: { select: { name: true } },
          },
        },
        refunds: {
          orderBy: { refundDate: "asc" },
          select: { id: true, refundDate: true, amount: true, refundMode: true, referenceNo: true },
        },
        issues: { select: { id: true, issueNo: true, status: true } },
      },
    });

    const credits = rows.map((c) => {
      const applications = c.applications.map((a) => ({
        id: a.id,
        source: a.source,
        amount: round2(Number(a.amount)),
        appliedDate: a.appliedDate,
        note: a.note,
        // Null when the bill is not in the app yet (a Zoho application waiting for its bill).
        billId: a.bill?.id ?? null,
        billNo: a.bill?.billNo ?? null,
        appliedBy: a.appliedBy?.name ?? null,
      }));
      const refunds = c.refunds.map((r) => ({
        id: r.id,
        refundDate: r.refundDate,
        amount: round2(Number(r.amount)),
        refundMode: r.refundMode,
        referenceNo: r.referenceNo,
      }));
      const appliedHere = round2(applications.filter((a) => a.source === "APP").reduce((s, a) => s + a.amount, 0));
      const appliedInZoho = round2(applications.filter((a) => a.source === "ZOHO").reduce((s, a) => s + a.amount, 0));
      const refunded = round2(refunds.reduce((s, r) => s + r.amount, 0));
      const open = round2(c.amount - c.usedAmount);
      const overApplied = c.status !== "VOID" && open < -EPS;
      return {
        id: c.id,
        creditNoteNo: c.creditNoteNo,
        referenceNo: c.referenceNo,
        creditDate: c.creditDate,
        reason: c.reason,
        notes: c.notes,
        status: c.status,
        fromZoho: Boolean(c.zohoVendorCreditId),
        lastSyncedAt: c.lastSyncedAt,
        storeId: c.storeId,
        store: c.store,
        amount: round2(c.amount),
        usedAmount: round2(c.usedAmount),
        applied: round2(appliedHere + appliedInZoho),
        appliedHere,
        appliedInZoho,
        refunded,
        open,
        overApplied,
        overAppliedBy: overApplied ? round2(-open) : 0,
        applications,
        refunds,
        issues: c.issues,
      };
    });

    // "Open" = still usable, or over-applied (D17: flagged, never hidden).
    const isOpen = (c: (typeof credits)[number]) => (c.status === "OPEN" && c.open > EPS) || c.overApplied;
    const listed = status === "all" ? credits : credits.filter(isOpen);

    const usable = credits.filter((c) => c.status === "OPEN" && c.open > EPS);
    const totals = {
      // Across ALL the vendor's credits, whatever the filter — the strip on the Credits tab.
      openAmount: round2(usable.reduce((s, c) => s + c.open, 0)),
      openCount: usable.length,
      overAppliedCount: credits.filter((c) => c.overApplied).length,
      allCount: credits.length,
      // Across the credits in this response.
      count: listed.length,
      amount: round2(listed.reduce((s, c) => s + c.amount, 0)),
      applied: round2(listed.reduce((s, c) => s + c.applied, 0)),
      appliedHere: round2(listed.reduce((s, c) => s + c.appliedHere, 0)),
      appliedInZoho: round2(listed.reduce((s, c) => s + c.appliedInZoho, 0)),
      refunded: round2(listed.reduce((s, c) => s + c.refunded, 0)),
    };

    if (totals.overAppliedCount > 0) {
      log.warn("vendor has over-applied credits", { vendorId: id, count: totals.overAppliedCount });
    }
    log.debug("credits listed", { vendorId: id, status, rows: listed.length, all: credits.length, ms: Date.now() - started });
    return successResponse({ vendor, status, credits: listed, totals });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid filter";
      log.warn("credits query refused", { vendorId, message });
      return errorResponse(message, 400);
    }
    log.error("credits list failed", { vendorId, message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not load this vendor's credit notes. Try again.", 500);
  }
}
