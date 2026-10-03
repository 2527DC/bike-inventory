export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { binSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { getBinUnitCounts, EMPTY_BIN_COUNTS } from "@/lib/bins/unit-counts";
import { binDeleteBlockers, binDeleteRefusal } from "@/lib/bins/delete-check";

const log = createLogger("bins:crud");

export async function GET(req: NextRequest) {
  try {
    await requireFeature("bins", "view");
    const { searchParams } = new URL(req.url);
    const warehouseId = searchParams.get("warehouseId");

    const where: Record<string, unknown> = { isActive: true };
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }

    const bins = await prisma.bin.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true, kind: true } },
        // `homeBinRules` lets the delete dialog say how many rules go with the bin (plan 0310, Q1).
        _count: { select: { products: true, binStocks: true, units: true, homeBinRules: true } },
      },
      orderBy: [{ warehouse: { name: "asc" } }, { code: "asc" }],
    });
    // R5: Total · Assembled · Unassembled per bin, live units only — one groupBy for all bins.
    const counts = await getBinUnitCounts(bins.map((b) => b.id));
    return successResponse(
      bins.map((b) => ({ ...b, unitCounts: counts.get(b.id) ?? EMPTY_BIN_COUNTS }))
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bins fetch failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch bins", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("bins", "create");
    const body = await req.json();
    const data = binSchema.parse(body);
    // Normalised ONCE, before the lookup: rows are stored trimmed and upper-cased, so looking up
    // the raw "a1" missed a deleted "A1" and the create then died on the unique index.
    const code = data.code.trim().toUpperCase();

    // Check for duplicate code within the same warehouse
    const existing = await prisma.bin.findUnique({
      where: {
        warehouseId_code: {
          warehouseId: data.warehouseId,
          code,
        },
      },
    });

    if (existing?.isActive) {
      return errorResponse(
        `Bin code "${code}" already exists in this warehouse. Try a different code.`,
        409
      );
    }

    // ── NON-ASSEMBLABLE, AT CREATION ONLY (R42, P6, P6a) ──
    //
    // Items in such a bin need no building and never reach the assembly line; a unit that
    // enters one is stamped, and `api/bins/[id]` PATCH refuses to change the flag afterwards.
    // Read off the raw body rather than `binSchema`: that schema is shared with other callers
    // and this is the only route that may set the flag.
    const nonAssemblable = body?.nonAssemblable === true;

    const fields = {
      code,
      name: data.name.trim(),
      location: data.location || null,
      directions: data.directions || null,
      floor: data.floor || null,
      zone: data.zone || null,
      capacity: data.capacity ?? null,
      isAssemblyArea: data.isAssemblyArea ?? false,
      nonAssemblable,
    };
    const include = { warehouse: { select: { id: true, name: true, code: true, kind: true } } };

    // ── A DELETED BIN'S CODE IS REUSABLE (plan 0310, Q3) ──
    //
    // Delete is soft, so the row — and `@@unique([warehouseId, code])` — survive it. Creating
    // that code again brings the row back with the new details, keeping its movement history.
    // Choosing `nonAssemblable` afresh is safe only because the bin is empty; a bin retired by the
    // old Active checkbox may still hold items, and is refused rather than revived around them.
    if (existing) {
      const blockers = await binDeleteBlockers(prisma, existing.id);
      if (!blockers.empty) {
        log.warn("bin revive refused", { binId: existing.id, code: existing.code, items: blockers.items });
        return errorResponse(
          `A deleted bin ${existing.code} in this warehouse still holds items, so its code cannot be reused yet. ${binDeleteRefusal(existing.code, blockers)}`,
          409
        );
      }
      const revived = await prisma.bin.update({
        where: { id: existing.id },
        data: { ...fields, isActive: true },
        include,
      });
      log.info("bin revived from retired row", {
        binId: revived.id,
        code: revived.code,
        warehouseId: revived.warehouseId,
        nonAssemblable: revived.nonAssemblable,
      });
      return successResponse(revived, 201);
    }

    const bin = await prisma.bin.create({
      data: { ...fields, warehouseId: data.warehouseId, isActive: data.isActive ?? true },
      include,
    });
    log.info("bin created", {
      binId: bin.id,
      code: bin.code,
      warehouseId: bin.warehouseId,
      nonAssemblable: bin.nonAssemblable,
      isAssemblyArea: bin.isAssemblyArea,
    });
    return successResponse(bin, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("bin create failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Failed to create bin", 400);
  }
}

