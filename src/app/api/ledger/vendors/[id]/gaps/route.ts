export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { ledgerGapSchema } from "@/lib/validations";

// GET — the claim register for one vendor.
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
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST — raise a claim.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFeature("brand_ledger_gaps", "create");
    const { id } = await params;
    const data = ledgerGapSchema.parse(await req.json());

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    // Per-vendor numbering, continuing the existing register's #1, #2 … convention.
    const last = await prisma.ledgerGap.findFirst({
      where: { vendorId: id },
      orderBy: { number: "desc" },
      select: { number: true },
    });

    const gap = await prisma.ledgerGap.create({
      data: {
        vendorId: id,
        brandId: data.brandId || null,
        number: (last?.number ?? 0) + 1,
        title: data.title,
        gapType: data.gapType,
        tier: data.tier ?? null,
        status: data.status ?? "OPEN",
        amount: data.amount ?? null,
        amountNote: data.amountNote || null,
        promisedBy: data.promisedBy || null,
        promisedOn: data.promisedOn ? new Date(data.promisedOn) : null,
        evidenceText: data.evidenceText || null,
        action: data.action || null,
        result: data.result || null,
        createdById: user.id,
      },
      include: { evidence: true },
    });

    return successResponse(gap, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
