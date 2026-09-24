// ─── Stock-audit and assembly-assignment pushes ────────────────────────────────────────────
//
// Plan 2409-stock-audit-push-notifications. Four stock-audit moments and one assembly moment:
//
//   assigned   → the assignee                         stock_audit.assigned   (R1)
//   completed  → holders of stock_audit.approve       approval.requested     (R2)
//   approved   → the assignee                         stock_audit.approved   (R3)
//   rejected   → the assignee, with the reason        approval.returned      (R3)
//   assembly   → the mechanic, ONE per assignment     assembly.assigned      (R5)
//
// Nobody is ever pushed about something they did themselves (Q4): the actor is removed from
// every audience, which also makes a self-count and a self-assignment silent.
//
// Every function here schedules its send with `after()` — the caller's transaction has
// already committed and its response is not held up — and NEVER throws: a failed push must
// not surface as a failed audit or assignment. Same shape as src/lib/approvals/actions/transfer.ts.

import { after } from "next/server";
import { notify } from "@/lib/notify";
import { usersWithPermission } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";

const log = createLogger("notify:stock-audit");

export type StockAuditPushKind = "assigned" | "completed" | "approved" | "rejected";

export interface StockAuditPushInput {
  stockCountId: string;
  countNo: string | null;
  title: string;
  assignedToId: string;
  /** Who caused this moment — never a recipient. */
  actorId: string;
  actorName: string;
  /** "Store · Warehouse · Bin L1" — shown on the assigned push. */
  scopeLabel?: string;
  dueDate?: Date;
  /** The rejection note, for `rejected`. */
  reason?: string | null;
}

export function notifyStockAudit(kind: StockAuditPushKind, input: StockAuditPushInput): void {
  after(async () => {
    try {
      const ref = input.countNo ?? "Stock audit";
      const link = `/stock-audit/${input.stockCountId}`;
      const notActor = (ids: string[]) => ids.filter((id) => id && id !== input.actorId);

      if (kind === "completed") {
        const recipients = notActor(await usersWithPermission("stock_audit", "approve"));
        if (recipients.length === 0) {
          log.debug("audit completed but nobody else holds stock_audit.approve", { stockCountId: input.stockCountId });
          return;
        }
        // No `actions`: a stock audit cannot be approved from a notification — the approver
        // chooses on the audit screen whether to apply counts to stock, and
        // POST /api/approvals/quick refuses STOCK_AUDIT (plan Q3). Tapping opens the audit.
        await notify("approval.requested", {
          recipients,
          title: `Stock audit ${ref} needs approval`,
          body: `${input.title} — counted by ${input.actorName}`,
          refId: input.stockCountId,
          link,
          data: { activity: "STOCK_AUDIT", recordId: input.stockCountId },
        });
        log.info("stock audit push sent", { kind, stockCountId: input.stockCountId, recipients: recipients.length });
        return;
      }

      const recipients = notActor([input.assignedToId]);
      if (recipients.length === 0) {
        log.debug("assignee is the actor — no push", { kind, stockCountId: input.stockCountId });
        return;
      }

      if (kind === "assigned") {
        const due = input.dueDate ? `, due ${input.dueDate.toISOString().slice(0, 10)}` : "";
        await notify("stock_audit.assigned", {
          recipients,
          title: `Stock audit ${ref} assigned to you`,
          body: `${input.title}${input.scopeLabel ? ` — ${input.scopeLabel}` : ""}${due}. From ${input.actorName}`,
          refId: input.stockCountId,
          link,
          data: { stockCountId: input.stockCountId },
        });
      } else if (kind === "approved") {
        await notify("stock_audit.approved", {
          recipients,
          title: `Stock audit ${ref} approved`,
          body: `${input.title} — approved by ${input.actorName}`,
          refId: input.stockCountId,
          link,
          data: { stockCountId: input.stockCountId },
        });
      } else {
        await notify("approval.returned", {
          recipients,
          title: `Stock audit ${ref} sent back`,
          body: `${input.reason?.trim() || "No reason given"} — ${input.actorName}`,
          refId: input.stockCountId,
          link,
          data: { activity: "STOCK_AUDIT", recordId: input.stockCountId },
        });
      }
      log.info("stock audit push sent", { kind, stockCountId: input.stockCountId, recipients: recipients.length });
    } catch (error) {
      log.error("stock audit push failed", {
        kind,
        stockCountId: input.stockCountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export interface AssemblyAssignedInput {
  assignedToId: string;
  actorId: string;
  actorName: string;
  unitCount: number;
  /** Product names of the assigned units, for "<first> and N more". */
  productNames: string[];
}

/** ONE push for the whole assignment request, however many bicycles it carried (plan Q6). */
export function notifyAssemblyAssigned(input: AssemblyAssignedInput): void {
  after(async () => {
    try {
      if (!input.assignedToId || input.assignedToId === input.actorId) {
        log.debug("assembly assigned to the actor — no push", { units: input.unitCount });
        return;
      }
      const n = input.unitCount;
      const distinct = [...new Set(input.productNames.filter(Boolean))];
      const what =
        distinct.length === 0 ? "" : distinct.length === 1 ? distinct[0] : `${distinct[0]} and ${distinct.length - 1} more`;
      await notify("assembly.assigned", {
        recipients: [input.assignedToId],
        title: `${n} bicycle${n === 1 ? "" : "s"} assigned to you for assembly`,
        body: `${what ? `${what} — ` : ""}from ${input.actorName}`,
        link: "/assembly",
        data: { units: String(n) },
      });
      log.info("assembly push sent", { assignedToId: input.assignedToId, units: n });
    } catch (error) {
      log.error("assembly push failed", {
        assignedToId: input.assignedToId,
        units: input.unitCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
