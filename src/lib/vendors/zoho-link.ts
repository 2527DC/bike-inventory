import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";
import type { AppVendorRef, MatchKind } from "./zoho-match";

const log = createLogger("vendors:zoho-link");

/**
 * Every vendor, as the matcher needs it — linked or not, active or not (Q3). The matcher must see
 * the linked ones too: a GSTIN already on a linked vendor is a conflict, not a new vendor.
 */
export async function listVendorsForMatching(): Promise<AppVendorRef[]> {
  return prisma.vendor.findMany({
    select: { id: true, code: true, name: true, gstin: true, isActive: true, zohoVendorId: true },
  });
}

export type LinkResult = "linked" | "already-linked" | "id-taken";

/**
 * Save a Zoho vendor id on an app vendor that has none — the only write plan
 * 1410-link-vendors-to-zoho makes (R1, R5: nothing else on the vendor changes). Used by the Link
 * step on /vendors and by bill approval.
 *
 * Guarded: `updateMany` on `zohoVendorId: null`, so two tabs, or a tab and a bill approval, cannot
 * both link the same vendor — the second finds it linked and says so. A Zoho id already on another
 * vendor is refused by the unique index and reported as `id-taken`.
 */
export async function linkVendorToZoho(args: {
  vendor: Pick<AppVendorRef, "id" | "code" | "name">;
  zohoVendorId: string;
  kind: MatchKind;
  actor: { id: string; name: string };
  /** Where the link came from, for the activity log: "the Link step" or "bill 26-27/DL/267". */
  via: string;
}): Promise<LinkResult> {
  const { vendor, zohoVendorId, kind, actor, via } = args;
  try {
    const updated = await prisma.vendor.updateMany({
      where: { id: vendor.id, zohoVendorId: null },
      data: { zohoVendorId },
    });
    if (updated.count === 0) {
      log.warn("vendor already linked — left as it is", { vendorId: vendor.id, zohoVendorId });
      return "already-linked";
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      log.warn("Zoho id already on another vendor — not linked", { vendorId: vendor.id, zohoVendorId });
      return "id-taken";
    }
    log.error("vendor link failed", { vendorId: vendor.id, zohoVendorId, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  log.info("vendor linked to Zoho", { vendorId: vendor.id, zohoVendorId, kind });
  await logActivity(prisma, {
    module: "vendors",
    action: "linked to Zoho",
    entityType: "Vendor",
    entityId: vendor.id,
    entityRef: `${vendor.name} (${vendor.code})`,
    toValue: zohoVendorId,
    details: `Matched on ${kind === "name" ? "name, ticked by hand" : kind === "ambiguous" ? "a person's choice" : "GSTIN"} · ${via}`,
    userId: actor.id,
    userName: actor.name,
  });
  return "linked";
}
