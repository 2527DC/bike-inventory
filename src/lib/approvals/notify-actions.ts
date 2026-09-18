// ─── The buttons on an "X needs approval" notification ────────────────────────────────────
//
// Plan 1709-priority-build-and-stock-flow §3.8 (Part Q), R24, requirements §2 Q19.
//
// One definition, imported by every caller that raises `approval.requested`, so the four
// activities cannot drift into four different button sets. What travels is only a payload:
// the decision still belongs to `src/lib/approvals/actions/*`, reached through
// `POST /api/approvals/quick`, which re-checks the grant.
//
// ─── WHY THE SECOND BUTTON SAYS "Open" AND NOT "Reject" ───────────────────────────────────
//
// Returning a record for correction REQUIRES a note (R25) — a return with no reason is the
// exact defect the returned-record rule exists to fix. A notification button cannot collect
// one, so "Reject" from the lock screen would either write a noteless return or pop a screen
// anyway. It opens the record instead, where the note field is. The action id stays `reject`
// because that is what the plan and the service worker agreed to call it; only the label the
// approver reads is honest about what happens.
//
// ─── WHAT A BROWSER WITHOUT BUTTONS DOES ──────────────────────────────────────────────────
//
// iOS Safari ignores `actions` completely (Q19). So does any notification surface we do not
// control. Every notification carrying these is therefore still correct with NO buttons at
// all: its body opens `link`, which is the same place "Open" goes, and the approval happens
// on the screen. Nothing here may ever become the only way to approve something.

import type { PushAction } from "@/lib/notify";

/**
 * Approve in one tap, or open the record. Two, because two is all any browser shows
 * (`MAX_PUSH_ACTIONS` in src/lib/notify/types.ts).
 */
export const APPROVAL_NOTIFICATION_ACTIONS: PushAction[] = [
  { action: "approve", title: "Approve" },
  { action: "reject", title: "Open" },
];

/**
 * ─── WHAT EVERY CALLER MUST ALSO SEND ─────────────────────────────────────────────────────
 *
 * `data` has to carry **`activity`** (INBOUND / OUTBOUND / TRANSFER) and **`recordId`**, plus
 * a `link`. They are all the service worker has: it holds no session state and no idea what
 * the notification was about beyond what is written there, and without both ids it shows
 * "this notification does not say what to approve" instead of approving. The caller's own
 * keys — `invoiceNo`, `orderNo`, `shipmentId` — stay beside them for the screens and the logs.
 */
