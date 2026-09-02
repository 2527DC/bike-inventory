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
// column defaults on that table are deliberately not the whole story, because the right
// default differs per event (zoho.pull_finished is the one that mails by default: it is the
// event most likely to report something already broken while nobody is watching).
//
// Email defaults off nearly everywhere because it is the scarce channel: a free Gmail account
// sends ~500/day, and one event to 40 staff is 8% of that. Push is free.

export interface EventDefinition {
  /** Shown in the settings table and the personal preferences list. */
  label: string;
  /** One line under the label. Say when it fires, in the business's words. */
  description: string;
  /** Applies when the admin has never touched this event's row. */
  defaults: { push: boolean; email: boolean };
}

export const NOTIFICATION_EVENTS = {
  "stock.below_reorder": {
    label: "Stock below reorder level",
    description: "A sale or delivery took a product below its reorder level",
    defaults: { push: true, email: false },
  },
  "service.job_ready": {
    label: "Service job ready",
    description: "A workshop job was marked READY for the customer",
    defaults: { push: true, email: false },
  },
  "inbound.delivered": {
    label: "Inbound shipment delivered",
    description: "An inbound shipment was marked DELIVERED",
    defaults: { push: true, email: false },
  },
  "zoho.pull_started": {
    label: "Zoho pull started",
    description: "Someone started a bills-and-invoices pull from Zoho Books or Zakya",
    defaults: { push: true, email: false },
  },
  "zoho.pull_finished": {
    label: "Zoho pull finished",
    description: "A pull ended — clean, or partial with errors",
    defaults: { push: true, email: true },
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
