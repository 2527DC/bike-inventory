// "A transfer is needed" — the push behind a short outward (plan 1709-priority-build-and-stock-flow,
// R13, R14, Q31, Q14).
//
// ─── WHO IS TOLD, AND WHEN ────────────────────────────────────────────────────────────────
//
// Recipients are the holders of `transfers.create`, resolved at send time from the GRANT
// (`usersWithPermission`) — never a role name, never a stored list (CLAUDE.md "Access control is
// DATA"). The actor is removed: the person who just saw the refusal on their own screen does not
// need a push about it. A public self-fill submit has no actor, so nobody is removed.
//
// ─── CALLED AFTER COMMIT, OR AFTER A ROLLBACK ─────────────────────────────────────────────
//
// `notify()` does SMTP and FCM I/O and must never run inside a Prisma interactive transaction
// (notify/types.ts §F.0). Two shapes of caller exist here:
//
//   1. The hold was short but the status change was ACCEPTED (SCHEDULED / PACKED / self-fill):
//      call this after the transaction commits.
//   2. The handover or dispatch was REFUSED and the transaction rolled back: call this in the
//      catch, once the rollback is done. The shortage is a real fact either way — the stock is
//      genuinely not on the floor — so it is worth telling someone who can move it.
//
// It never throws: a failed notification must not turn an accepted status change into an error.

import { usersWithPermission } from "@/lib/rbac";
import { notify } from "@/lib/notify";
import { createLogger } from "@/lib/logger";
import type { ShortLine } from "./floor-stock";

const log = createLogger("deliveries:transfer-needed");

export interface TransferNeededDelivery {
  id: string;
  invoiceNo: string;
  customerName?: string | null;
  warehouse?: { name: string } | null;
}

/** "Hero Sprint 29: 0 on BCH Floor · 2 in BCH Godown" — one line per short product. */
function bodyFor(short: ShortLine[], floorName: string): string {
  return short
    .map((l) => {
      const there = l.elsewhere.map((e) => `${e.quantity} in ${e.warehouseName}`).join(" · ");
      return `${l.name}: ${l.available} on ${floorName}${there ? ` · ${there}` : ""} (needs ${l.needed})`;
    })
    .join("\n");
}

/**
 * Tell everyone who can raise a transfer that an outward's floor is short.
 *
 * @param actorId the user whose action produced the shortage; omitted on the public form.
 */
export async function notifyTransferNeeded(
  delivery: TransferNeededDelivery,
  short: ShortLine[],
  actorId?: string | null
): Promise<void> {
  try {
    if (short.length === 0) return;
    const floorName = delivery.warehouse?.name ?? "the floor";

    const holders = await usersWithPermission("transfers", "create");
    const recipients = holders.filter((id) => id !== actorId);
    if (recipients.length === 0) {
      log.info("outward short but nobody else holds transfers.create", {
        deliveryId: delivery.id,
        invoiceNo: delivery.invoiceNo,
        lines: short.length,
      });
      return;
    }

    await notify("stock.transfer_needed", {
      recipients,
      title: `Transfer needed — ${delivery.invoiceNo}`,
      body: `${floorName} is short for this outward.\n${bodyFor(short, floorName)}`,
      refId: delivery.id,
      link: `/deliveries/${delivery.id}`,
      data: {
        deliveryId: delivery.id,
        invoiceNo: delivery.invoiceNo,
        shortLines: String(short.length),
      },
    });

    log.info("transfer-needed notification raised", {
      deliveryId: delivery.id,
      invoiceNo: delivery.invoiceNo,
      lines: short.length,
      recipients: recipients.length,
    });
  } catch (error) {
    // Never rethrow: the caller has already answered the request, and a missed push must not
    // become a failed status change or mask the refusal the user is reading.
    log.error("transfer-needed notification failed", {
      deliveryId: delivery.id,
      invoiceNo: delivery.invoiceNo,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
