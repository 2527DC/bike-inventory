// ─── stock.below_reorder — the batch helper ────────────────────────────────────
//
// Plan §F.1. The three OUTBOUND stock paths (inventory/outwards, deliveries/batch,
// deliveries/[id]) hand this every product a committed transaction moved DOWN, and it fires
// one notification per product that crossed its reorder line on that write.
//
// RULE (§F.0): call this AFTER `prisma.$transaction` has returned — never inside the
// callback. notify() does SMTP + FCM network I/O, which would eat the transaction's 5-second
// budget and roll the stock write back. The caller pushes `ReorderCrossing`s into an array
// inside the transaction and calls this once the commit is real, ideally inside Next's
// `after()` so the sale's response is not held up by sending either.
//
// It NEVER throws. A notification failure must not surface as a failed sale.

import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { usersWithPermission } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";

const log = createLogger("notify:stock");

export type ReorderCrossing = { productId: string; previousStock: number; newStock: number };

export async function maybeNotifyBelowReorder(crossings: ReorderCrossing[]): Promise<void> {
  if (crossings.length === 0) return;

  try {
    // One read for the whole batch. deliveries/batch can touch dozens of products in one
    // request; a findUnique per product here would be that many round trips after every sale.
    const ids = [...new Set(crossings.map((c) => c.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, sku: true, reorderLevel: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // DOWNWARD crossings only: previousStock > reorderLevel >= newStock. A product that was
    // already at or below the line before this write does NOT re-notify — otherwise every
    // later sale of a short product would page the same people again. reorderLevel 0 is the
    // column default and means "no reorder level set"; it never fires.
    const crossed = crossings.filter((c) => {
      const p = byId.get(c.productId);
      if (!p) {
        // Deleted between commit and send — nothing to say about it.
        log.warn("product missing after commit; skipping", { productId: c.productId });
        return false;
      }
      return p.reorderLevel > 0 && c.previousStock > p.reorderLevel && c.newStock <= p.reorderLevel;
    });

    if (crossed.length === 0) {
      log.debug("no reorder crossings", { checked: crossings.length });
      return;
    }

    // The audience is whoever can act on a reorder — the `reorder` module's `edit` grant —
    // resolved at send time so it follows the grant rather than a stored list (§F.5). There is
    // no actor to exclude here: the request that caused the crossing has already been answered
    // and the seller is not the person who raises a purchase order.
    const recipients = await usersWithPermission("reorder", "edit");
    if (recipients.length === 0) {
      log.info("reorder crossings but nobody holds reorder.edit", {
        productIds: crossed.map((c) => c.productId),
      });
      return;
    }

    for (const c of crossed) {
      const p = byId.get(c.productId)!;
      await notify("stock.below_reorder", {
        recipients,
        title: `${p.sku} below reorder level`,
        body: `${p.name}: ${c.newStock} left, reorder level ${p.reorderLevel}`,
        refId: p.id,
        link: `/stock/${p.id}`,
        data: {
          productId: p.id,
          sku: p.sku,
          newStock: String(c.newStock),
          reorderLevel: String(p.reorderLevel),
        },
      });
    }

    log.info("below-reorder notifications sent", {
      products: crossed.map((c) => c.productId),
      recipients: recipients.length,
    });
  } catch (err) {
    // Never rethrow: the stock write is already committed and the caller has moved on.
    log.error("below-reorder notification failed", {
      count: crossings.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
