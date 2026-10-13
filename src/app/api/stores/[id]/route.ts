export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { clearStoreCache } from "@/lib/stores";
import { storeUpdateSchema } from "@/lib/validations";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:stores:id");
const zohoLog = createLogger("stores:zoho-location");

/**
 * The Zoho location ids that book to `zohoLocationId`'s store: the location itself plus its
 * sub-locations (Zoho's warehouse locations carry `parent_location_id`) that are not linked to a
 * store of their own — the same rule `storeIdForLocation()` applies at import. One read of
 * Zoho's location list; when Zoho cannot be read, only the location itself is used and the
 * caller is told, so a sub-location's rows wait for the next save or the next import.
 */
async function locationFamily(zohoLocationId: string): Promise<{ ids: string[]; subLocationsChecked: boolean }> {
  try {
    const books = await getBooks();
    if (!books) {
      zohoLog.warn("sub-locations not checked — Zoho Books is not connected", { zohoLocationId });
      return { ids: [zohoLocationId], subLocationsChecked: false };
    }
    const all = (await books.listLocations()).locations ?? [];
    const children = all.filter((l) => l.parent_location_id === zohoLocationId).map((l) => l.location_id);
    if (children.length === 0) return { ids: [zohoLocationId], subLocationsChecked: true };
    const linkedElsewhere = await prisma.store.findMany({
      where: { zohoLocationId: { in: children } },
      select: { zohoLocationId: true },
    });
    const taken = new Set(linkedElsewhere.map((s) => s.zohoLocationId));
    return { ids: [zohoLocationId, ...children.filter((c) => !taken.has(c))], subLocationsChecked: true };
  } catch (e) {
    zohoLog.warn("sub-locations not checked — Zoho locations read failed", {
      zohoLocationId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ids: [zohoLocationId], subLocationsChecked: false };
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("stores", "edit");
    const { id } = await params;
    const data = storeUpdateSchema.parse(await req.json());

    const existing = await prisma.store.findUnique({ where: { id }, select: { id: true, zohoLocationId: true } });
    if (!existing) return errorResponse("Store not found", 404);

    if (data.code) {
      const code = data.code.trim().toUpperCase();
      const clash = await prisma.store.findUnique({ where: { code }, select: { id: true, name: true } });
      if (clash && clash.id !== id) {
        return errorResponse(`Code "${code}" is already used by ${clash.name}`, 409);
      }
    }

    // Zoho location link (plan 1210 credit notes, Part 2.3). One location books to one store.
    const zohoLocationId = data.zohoLocationId === undefined ? undefined : data.zohoLocationId?.trim() || null;
    const linking = zohoLocationId !== undefined && zohoLocationId !== (existing.zohoLocationId ?? null);
    if (linking && zohoLocationId) {
      const clash = await prisma.store.findUnique({ where: { zohoLocationId }, select: { id: true, name: true } });
      if (clash && clash.id !== id) {
        zohoLog.warn("link refused", { storeId: id, zohoLocationId, reason: "location linked to another store", otherStoreId: clash.id });
        return errorResponse(`That Zoho location is already linked to ${clash.name}. Unlink it there first.`, 409);
      }
    }
    // Whenever a link stands after this save — new or unchanged — the rows waiting for it are
    // filled. Re-saving an unchanged link therefore re-applies it: rows fetched since, or a
    // sub-location Zoho could not be asked about last time. Idempotent: only null stores move.
    // Read before the transaction: a Zoho call does not belong inside one.
    const family = zohoLocationId ? await locationFamily(zohoLocationId) : null;

    // No invoice prefix on a store since plan 1609 (R30): it is set on the FLOOR warehouse via
    // PUT /api/warehouses/[id]. Store.invoicePrefix is neither read nor written here any more.
    // The location link and the rows it decides are one transaction: a bill, credit or customer
    // credit note that carries this Zoho location and has no store yet takes this store now.
    const { store, filled } = await prisma.$transaction(async (tx) => {
      const store = await tx.store.update({
        where: { id },
        data: {
          ...(data.code !== undefined ? { code: data.code.trim().toUpperCase() } : {}),
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
          ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          // Upper-cased on the way in as well as in the form: a GSTIN typed in lower case would
          // pass the browser but fail the schema's uppercase-only regex on the next edit.
          ...(data.gstin !== undefined ? { gstin: data.gstin.trim().toUpperCase() || null } : {}),
          ...(data.stateCode !== undefined ? { stateCode: data.stateCode.trim() || null } : {}),
          ...(zohoLocationId !== undefined ? { zohoLocationId } : {}),
        },
        // The retired Store.invoicePrefix column is not echoed back (plan 1609, T1).
        omit: { invoicePrefix: true },
      });

      // Unlinking (or saving other fields) touches no payables: a store already set stays set.
      if (!family) return { store, filled: null };
      const where = { storeId: null, zohoLocationId: { in: family.ids } };
      const bills = await tx.vendorBill.updateMany({ where, data: { storeId: id } });
      const credits = await tx.vendorCredit.updateMany({ where, data: { storeId: id } });
      const creditNotes = await tx.customerCreditNote.updateMany({ where, data: { storeId: id } });
      // A payment belongs to its bill's store (Q9): payments recorded while their bill had none.
      const payments = await tx.$executeRaw`
        UPDATE "VendorPayment" p
           SET "storeId" = b."storeId"
          FROM "VendorBill" b
         WHERE p."billId" = b.id
           AND p."storeId" IS NULL
           AND b."storeId" = ${id}`;
      return {
        store,
        filled: {
          billsUpdated: bills.count,
          creditsUpdated: credits.count,
          creditNotesUpdated: creditNotes.count,
          paymentsUpdated: payments,
          subLocationsChecked: family.subLocationsChecked,
          locationIds: family.ids.length,
        },
      };
    });

    log.info("store updated", { storeId: id, fields: Object.keys(data) });
    if (linking && zohoLocationId) {
      zohoLog.info("store linked to Zoho location", { storeId: id, zohoLocationId, ...filled });
    } else if (linking) {
      zohoLog.info("store unlinked from Zoho location", { storeId: id, previousZohoLocationId: existing.zohoLocationId });
    } else if (filled) {
      const moved = filled.billsUpdated + filled.creditsUpdated + filled.creditNotesUpdated + filled.paymentsUpdated;
      if (moved > 0) zohoLog.info("store Zoho location re-applied", { storeId: id, zohoLocationId, ...filled });
      else zohoLog.debug("store Zoho location re-applied, nothing waiting", { storeId: id, zohoLocationId });
    }
    // A rename or a deactivation changes what the cached set says.
    // The cached array would otherwise outlive the change for the life of the process —
    // which is how a warehouse the picker offers gets refused by the server that offered it.
    clearStoreCache();
    return successResponse(filled ? { ...store, zohoLink: filled } : store);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // Two people linking the same location at once: the unique index decides, in a sentence.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      zohoLog.warn("link refused", { reason: "unique clash on save", target: error.meta?.target });
      return errorResponse("That code or Zoho location was just taken by another store. Reload.", 409);
    }
    const message = error instanceof Error ? error.message : "Failed to update the store";
    log.error("store update failed", { message });
    return errorResponse(message, 400);
  }
}

/**
 * Hard-delete only when nothing references the store. Otherwise refuse with the counts and
 * point at deactivation — the same rule /team applies to a user with history.
 *
 * The FK is Restrict, so the database would refuse anyway. This check exists so the refusal
 * is a sentence a person can act on rather than a constraint-violation string, and so it
 * names WHICH relation is holding the row.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("stores", "delete");
    const { id } = await params;

    const store = await prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            warehouses: true,
            users: true,
            countEvents: true,
            analyticsDevices: true,
            deliveries: true,
            stockCounts: true,
            expenses: true,
            vendorBills: true,
            vendorPayments: true,
            vendorCredits: true,
            customerCreditNotes: true,
          },
        },
      },
    });
    if (!store) return errorResponse("Store not found", 404);

    const blockers: string[] = [];
    if (store._count.warehouses) blockers.push(`${store._count.warehouses} warehouse(s)`);
    if (store._count.countEvents) blockers.push(`${store._count.countEvents} footfall event(s)`);
    if (store._count.analyticsDevices) blockers.push(`${store._count.analyticsDevices} counting device(s)`);
    // Both added by MIG-1a as Restrict foreign keys. Without them on this list the database
    // still refuses the delete, but with a constraint-violation string instead of the
    // sentence this route exists to produce.
    if (store._count.deliveries) blockers.push(`${store._count.deliveries} delivery/deliveries`);
    if (store._count.stockCounts) blockers.push(`${store._count.stockCounts} stock audit(s)`);
    // Expense.storeId is Restrict too (plan 1210-expense-store, A3) — same reason as above.
    if (store._count.expenses) blockers.push(`${store._count.expenses} expense(s)`);
    // Payables and credit notes are Restrict too (plan 1210 credit notes, Part 2.1).
    if (store._count.vendorBills) blockers.push(`${store._count.vendorBills} vendor bill(s)`);
    if (store._count.vendorPayments) blockers.push(`${store._count.vendorPayments} vendor payment(s)`);
    if (store._count.vendorCredits) blockers.push(`${store._count.vendorCredits} vendor credit note(s)`);
    if (store._count.customerCreditNotes) blockers.push(`${store._count.customerCreditNotes} customer credit note(s)`);
    // Users are NOT a blocker: User.storeId is SetNull, so deleting a store unassigns staff
    // rather than destroying them. Mentioned in the message so the effect is not a surprise.

    if (blockers.length) {
      log.info("store delete refused", { storeId: id, blockers });
      return successResponse({
        deleted: false,
        name: store.name,
        message:
          `${store.name} still has ${blockers.join(", ")}. ` +
          `Move or remove them first, or deactivate the store to hide it from pickers while keeping its history.`,
      });
    }

    await prisma.store.delete({ where: { id } });
    log.info("store deleted", { storeId: id, unassignedUsers: store._count.users });
    // The deleted store is still in the cached set.
    // The cached array would otherwise outlive the change for the life of the process —
    // which is how a warehouse the picker offers gets refused by the server that offered it.
    clearStoreCache();
    return successResponse({
      deleted: true,
      name: store.name,
      message:
        store._count.users > 0
          ? `${store.name} deleted. ${store._count.users} user(s) are now unassigned.`
          : `${store.name} deleted.`,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to delete the store";
    log.error("store delete failed", { message });
    return errorResponse(message, 400);
  }
}
