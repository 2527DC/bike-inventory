import type { TransferOrderStatus } from "@prisma/client";
import { canTransition } from "./transitions";

/**
 * What this person may do to this transfer, decided on the SERVER.
 *
 * ─── WHY THE SERVER DECIDES THE BUTTONS ───────────────────────────────────────────────────
 *
 * The detail screen must not derive its action bar from role names — that is the architecture
 * rule this codebase is built around, and the old `/transfers` list broke it in spirit by
 * keying Approve off `canApprove && status === "PENDING"` in the client. That works only while
 * the client's copy of the rules agrees with the server's, and the purchase-order module has
 * already demonstrated three copies drifting apart.
 *
 * So the API answers "what can you do", the screen renders exactly that, and the routes
 * re-check anyway. The client list is cosmetic; the route's `requireFeature` is the gate.
 *
 * Site scoping is included here for the same reason: a clerk pinned to one warehouse should
 * not see a Dispatch button for a van leaving a different building.
 */
export type TransferAction = "approve" | "reject" | "dispatch" | "receive" | "cancel" | "attach_document";

export interface ActionContext {
  status: TransferOrderStatus;
  createdById: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  /** Null when the order predates the document policy — dispatch is not gated for those. */
  requiredDocType: string | null;
  docType: string | null;
  docUrl: string | null;
  user: {
    id: string;
    /** `User.warehouseId`. Null means unpinned: this user works across every site. */
    warehouseId: string | null;
    canApprove: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
}

/**
 * A user pinned to a warehouse acts only on that warehouse's side of a lane.
 *
 * `User.warehouseId` has existed for a while and NOTHING has ever enforced it — P14 writes the
 * first site scoping in the application. An unpinned user (null) passes everything, which is
 * every user today, so this is inert until somebody is actually pinned.
 */
function atSite(userWarehouseId: string | null, warehouseId: string | null): boolean {
  if (!userWarehouseId) return true; // unpinned: works everywhere
  if (!warehouseId) return true; // legacy order with no header lane: do not strand it
  return userWarehouseId === warehouseId;
}

/** True when the document gate would let a dispatch through right now. */
export function documentSatisfied(ctx: Pick<ActionContext, "requiredDocType" | "docType" | "docUrl">): boolean {
  // A pre-policy order (null) has no document requirement and must never be read as "no
  // document needed" in the UI — but it does dispatch freely, because demanding a tax invoice
  // for a movement that happened before the rule existed would strand it forever.
  if (!ctx.requiredDocType) return true;
  return Boolean(ctx.docUrl) && ctx.docType === ctx.requiredDocType;
}

export function computeActions(ctx: ActionContext): TransferAction[] {
  const actions: TransferAction[] = [];
  const { user } = ctx;

  if (ctx.status === "PENDING" && user.canApprove) {
    actions.push("approve", "reject");
  }

  // Dispatch empties the SOURCE, so it is the source warehouse that scopes it.
  if (
    ctx.status === "APPROVED" &&
    user.canEdit &&
    canTransition(ctx.status, "IN_TRANSIT") &&
    atSite(user.warehouseId, ctx.fromWarehouseId) &&
    documentSatisfied(ctx)
  ) {
    actions.push("dispatch");
  }

  // Receipt fills the DESTINATION.
  if (
    ctx.status === "IN_TRANSIT" &&
    user.canEdit &&
    atSite(user.warehouseId, ctx.toWarehouseId)
  ) {
    actions.push("receive");
  }

  if (canTransition(ctx.status, "CANCELLED") && (user.canDelete || ctx.createdById === ctx.user.id)) {
    actions.push("cancel");
  }

  // The document may be attached or replaced right up until dispatch — after that it is what
  // the driver is carrying, and changing it would make the record disagree with the paperwork.
  if (
    ctx.requiredDocType &&
    (ctx.status === "PENDING" || ctx.status === "APPROVED") &&
    (user.canEdit || ctx.createdById === ctx.user.id)
  ) {
    actions.push("attach_document");
  }

  return actions;
}
