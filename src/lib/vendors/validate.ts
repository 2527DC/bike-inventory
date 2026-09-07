import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("vendors:validate");

/**
 * "This vendor exists and is still active."
 *
 * Shared because THREE write paths set `Product.reorderVendorId` — the reorder sheet
 * (`api/products/[id]/reorder`), the bulk bar (`api/products/bulk`) and the reorder screen's
 * batch save (`api/reorder/update-levels`) — and a rule enforced in three places is a rule
 * enforced in two places as soon as someone edits one of them. Same reasoning, and the same
 * `Promise<string | null>` shape, as `validateSiteAssignment` in src/lib/site-assignment.ts.
 *
 * WHY ACTIVE MATTERS, not just existence: every existing vendor check in this codebase
 * (vendor-issues, ledger) verifies the row is THERE and stops. `Vendor.isActive` is a soft
 * delete — `api/vendors/[id]` DELETE flips the flag rather than removing the row — so an
 * existence check alone happily points a product's reorder vendor at a vendor the shop has
 * stopped buying from. Nothing downstream would object: the FK is satisfied, and P10 would
 * then derive that dead vendor onto a purchase order.
 *
 * Returns null when the id is acceptable, otherwise the sentence to put in the 400.
 *
 * @param vendorId null or "" means "clear the vendor", which is always allowed — the column
 *                 is nullable and unsetting it is how you undo a mistake.
 */
export async function validateReorderVendor(vendorId: string | null | undefined): Promise<string | null> {
  if (!vendorId) return null;

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, isActive: true },
  });

  if (!vendor) {
    log.warn("reorder vendor not found", { vendorId });
    return "Vendor not found or inactive";
  }

  if (!vendor.isActive) {
    // Named, because "Vendor not found or inactive" in front of a vendor the person can see
    // in their own list reads as a bug rather than as a deactivation.
    log.warn("reorder vendor is deactivated", { vendorId });
    return `${vendor.name} is deactivated`;
  }

  return null;
}
