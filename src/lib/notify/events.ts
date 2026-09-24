// ─── The event registry ────────────────────────────────────────────────────────
//
// The ONLY place an event key is defined. Every `notify()` call, every row in
// NotificationEventSetting, every checkbox on the settings screen and every row on the /more
// preferences section keys off this object. Add an event here, and the rest of the system
// picks it up; add a string literal anywhere else and it is a bug.
//
// Plan: docs/implementation/pending/notifications-and-settings-rbac-plan.md, Part F.
//
// `defaults` is what applies when NotificationEventSetting has NO row for the key — the
// column default on that table is deliberately not the whole story, because the right
// default can differ per event.
//
// Push is the only channel. Email was withdrawn as a notification channel on 23 Sep 2026
// (plan 2309); SMTP remains only for emailing purchase orders to vendors.

export interface EventDefinition {
  /** Shown in the settings table and the personal preferences list. */
  label: string;
  /** One line under the label. Say when it fires, in the business's words. */
  description: string;
  /** Applies when the admin has never touched this event's row. */
  defaults: { push: boolean };
}

export const NOTIFICATION_EVENTS = {
  "stock.below_reorder": {
    label: "Stock below reorder level",
    description: "A sale or delivery took a product below its reorder level",
    defaults: { push: true },
  },
  "service.job_ready": {
    label: "Service job ready",
    description: "A workshop job was marked READY for the customer",
    defaults: { push: true },
  },
  "inbound.delivered": {
    label: "Inbound shipment delivered",
    description: "An inbound shipment was marked DELIVERED",
    defaults: { push: true },
  },
  "zoho.pull_started": {
    label: "Zoho pull started",
    description: "Someone started a bills-and-invoices pull from Zoho Books or Zakya",
    defaults: { push: true },
  },
  "zoho.pull_finished": {
    label: "Zoho pull finished",
    description: "A pull ended — clean, or partial with errors",
    defaults: { push: true },
  },
  // Plan 1709-priority-build-and-stock-flow. Recipients are resolved from grants
  // (`usersWithPermission`), never from role names; the actor is always excluded.
  "stock.transfer_needed": {
    label: "Stock transfer needed for an outward",
    description:
      "An outward's floor is short, or Find stock raised a transfer request — goes to holders of transfers.create",
    defaults: { push: true },
  },
  "approval.requested": {
    label: "Approval requested",
    description:
      "An inbound, outbound, transfer or stock audit is waiting for approval — goes to holders of that module's approve grant",
    defaults: { push: true },
  },
  "approval.returned": {
    label: "Returned for correction",
    description:
      "An approver sent your inbound, outbound, transfer or stock audit back with a note to fix and resubmit",
    defaults: { push: true },
  },
  // Plan 2409-stock-audit-push-notifications. Recipients come from the record's own assignee,
  // never from role names; nobody is pushed about something they did themselves.
  "stock_audit.assigned": {
    label: "Stock audit assigned to you",
    description: "A stock audit was created and assigned to you to count",
    defaults: { push: true },
  },
  "stock_audit.approved": {
    label: "Your stock audit was approved",
    description: "An approver approved a stock audit you counted",
    defaults: { push: true },
  },
  "assembly.assigned": {
    label: "Bicycles assigned to you for assembly",
    description: "Bicycles were assigned to you on the assembly line — one notification per assignment",
    defaults: { push: true },
  },
} as const satisfies Record<string, EventDefinition>;

export type EventKey = keyof typeof NOTIFICATION_EVENTS;

/** Stable display order — the order above. */
export const EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as EventKey[];

export function isEventKey(value: string): value is EventKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENTS, value);
}

export function eventDefinition(key: EventKey): EventDefinition {
  return NOTIFICATION_EVENTS[key];
}
