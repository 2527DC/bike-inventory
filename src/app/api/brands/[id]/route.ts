export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:brands:id");

// Every field optional: this screen edits one cell at a time (a rename, a lead time) and
// sending the whole brand back on every keystroke would be a worse API, not a stricter one.
const updateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  whatsappNumber: z.string().max(30).nullable().optional(),
  // Days this brand takes to deliver. Folded onto Brand from the old BrandLeadTime table.
  leadDays: z.number().int().min(1, "Lead time must be at least 1 day").max(365).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brands", "edit");
    const { id } = await params;

    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message ?? "Invalid brand", 400);
    }
    const data = parsed.data;

    const existing = await prisma.brand.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return errorResponse("Brand not found", 404);

    // Brand.name is @unique. Catching the clash here turns a raw constraint violation into
    // a sentence that names the brand already holding it.
    if (data.name && data.name.trim() !== existing.name) {
      const clash = await prisma.brand.findFirst({
        where: { name: { equals: data.name.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== id) {
        return errorResponse(`"${clash.name}" already exists. Merge into it instead of renaming.`, 409);
      }
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName?.trim() || null } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone?.trim() || null } : {}),
        ...(data.whatsappNumber !== undefined ? { whatsappNumber: data.whatsappNumber?.trim() || null } : {}),
        ...(data.leadDays !== undefined ? { leadDays: data.leadDays } : {}),
      },
      include: { _count: { select: { products: true } } },
    });

    log.info("brand updated", { brandId: id, fields: Object.keys(data) });
    return successResponse(brand);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to update the brand";
    log.error("brand update failed", { message });
    return errorResponse(message, 400);
  }
}

/**
 * Delete a brand, but only when nothing points at it.
 *
 * Follows the rule /team already uses for a user with history: count the references, remove
 * the row only when every count is zero, otherwise REFUSE and name what is holding it. A
 * brand with products is not clutter — deleting it would orphan or destroy real records.
 *
 * Merge is the operation that actually cleans up this data. POST /api/brands/[id]/merge moves
 * the products first, and that is what the refusal points at.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brands", "delete");
    const { id } = await params;

    const brand = await prisma.brand.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            products: true,
            inboundShipments: true,
            preBookings: true,
            stockUploads: true,
            skuMappings: true,
            ledgerEntries: true,
            ledgerGaps: true,
            discountTerms: true,
            vendors: true,
          },
        },
      },
    });
    if (!brand) return errorResponse("Brand not found", 404);

    const blockers: string[] = [];
    const c = brand._count;
    if (c.products) blockers.push(`${c.products} product(s)`);
    if (c.inboundShipments) blockers.push(`${c.inboundShipments} inbound shipment(s)`);
    if (c.preBookings) blockers.push(`${c.preBookings} pre-booking(s)`);
    if (c.stockUploads) blockers.push(`${c.stockUploads} stock upload(s)`);
    if (c.skuMappings) blockers.push(`${c.skuMappings} SKU mapping(s)`);
    if (c.ledgerEntries) blockers.push(`${c.ledgerEntries} ledger entry(ies)`);
    if (c.ledgerGaps) blockers.push(`${c.ledgerGaps} ledger gap(s)`);
    if (c.discountTerms) blockers.push(`${c.discountTerms} discount term(s)`);
    if (c.vendors) blockers.push(`${c.vendors} vendor link(s)`);

    if (blockers.length) {
      log.info("brand delete refused", { brandId: id, blockers });
      return successResponse({
        deleted: false,
        name: brand.name,
        message:
          `${brand.name} still has ${blockers.join(", ")}. ` +
          `Merge it into another brand to move them, then delete it.`,
      });
    }

    await prisma.brand.delete({ where: { id } });
    log.info("brand deleted", { brandId: id, name: brand.name });
    return successResponse({ deleted: true, name: brand.name, message: `${brand.name} deleted.` });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete the brand";
    log.error("brand delete failed", { message });
    return errorResponse(message, 400);
  }
}
