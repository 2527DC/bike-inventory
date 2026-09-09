export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { ledgerGapWriteSchema } from "@/lib/validations";
import { GAP_STATUS_FROM_VIEW, GAP_TYPE_FROM_VIEW, isoDay } from "@/lib/brand-ledger/view-types";
import type { GapStatus, GapType } from "@prisma/client";

const log = createLogger("ledger:gaps");

// GET — the claim register for one vendor, enum-shaped (the screen reads the view route instead).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger_gaps", "view");
    const { id } = await params;

    const gaps = await prisma.ledgerGap.findMany({
      where: { vendorId: id },
      orderBy: { number: "asc" },
      include: {
        evidence: true,
        notes: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { id: true, name: true } } },
        },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { entries: true } },
      },
    });

    // Only live claims count toward the total — a resolved one is history, not an ask.
    const open = gaps.filter((g) => ["OPEN", "PROMISED", "VERIFY"].includes(g.status));
    const openValue = open.reduce((s, g) => s + (g.amount ?? 0), 0);

    // Claims with no proof attached. Worth surfacing on its own: a claim you cannot evidence
    // is one you cannot press, and you want to know that before the conversation, not during.
    const unevidenced = open.filter((g) => g.evidence.length === 0 && !g.evidenceText).length;

    return successResponse({
      gaps,
      summary: { total: gaps.length, open: open.length, openValue, unevidenced },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:gaps" });
  }
}

// POST — raise a claim, in the ledger app's own vocabulary (GapForm, App.jsx:446-487).
//
// Per-vendor numbering continues the register's #1, #2 … convention (App.jsx:419), and the
// first progress note is "Added" (App.jsx:420) — written in the same transaction so a claim
// never exists without its history.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger_gaps", "create");
    const { id } = await params;
    const data = ledgerGapWriteSchema.parse(await req.json());

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.ledgerGap.findFirst({
        where: { vendorId: id },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const gap = await tx.ledgerGap.create({
        data: {
          vendorId: id,
          number: (last?.number ?? 0) + 1,
          title: data.title,
          gapType: GAP_TYPE_FROM_VIEW[data.type] as GapType,
          status: GAP_STATUS_FROM_VIEW[data.status] as GapStatus,
          amount: data.amt,
          amountNote: data.amtText || null,
          evidenceText: data.evidence || null,
          action: data.action || null,
          createdById: user.id,
          notes: { create: { body: "Added", authorId: user.id } },
        },
        select: { id: true, number: true, status: true, createdAt: true },
      });
      return gap;
    });

    log.info("claim raised", { vendorId: id, gapId: created.id, number: created.number });
    return successResponse(
      { id: created.id, n: created.number, status: data.status, date: isoDay(created.createdAt) },
      201
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:gaps", status: 400 });
  }
}
