# Push notifications for stock audits (assigned, waiting for approval, approved / rejected) and assembly assignment

Status: pending — **built 24 Sep 2026** on `feat/audit-assembly-push` (from `origin/main` @ `045c89d`). `tsc`, `eslint`, `npm run build` pass. **Not yet tested with real pushes** — §4 step 2 needs push configured on the test site.
Branch: `feat/audit-assembly-push`. Helper: `src/lib/notify/stock-audit.ts`.

Every `file:line` below was read from disk on 24 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (24 Sep 2026)

> "ok i need this like when a stock audit is created and assigned the user must get the push
> notfication is it implemented"

Then, answering "which stock-audit moments should send a push?" (multi-select):
**"Assigned to me", "Completed → needs approval", "Approved / rejected"** — not "Re-assigned".

Then, answering Q3:

> "for transfer let me have the push notification and we dont need for the outbound and inbound
> and i need for the build line assembly build thing when the items are assigned to the user the
> user need to see the push notification"

Clarified the same day: transfers keep the pushes they already have; inbound and outbound stay
**exactly as they are** ("Nothing — just don't add more"); assembly assignment gets **one push per
assignment**.

### 0.2 Restated as requirements

- **R1** — When a stock audit is created, the person it is assigned to gets a push (and an inbox
  row) saying an audit is assigned to them, opening that audit. The creator does not get it.
- **R2** — When the assignee completes the count, the holders of `stock_audit → approve` get an
  "approval requested" push opening that audit. The person who completed it does not get it.
- **R3** — When an approver approves or rejects the audit, the assignee gets a push saying so;
  a rejection carries the reason.
- **R4** — Every push is also an inbox row and is switchable per event on Settings →
  Notifications, like every existing event. No role names anywhere — audiences come from the
  record's own assignee or from grants.
- **R5** — When bicycles are assigned to a mechanic for assembly, the mechanic gets **one** push
  per assignment ("5 bicycles assigned to you for assembly"), opening their assembly queue.
- **R6** — Transfers keep their existing pushes; inbound and outbound pushes are unchanged.

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|---|
| Q1 | all | Which moments push? | Scope. | assigned / completed / re-assigned / approved-rejected | — | **Answered** — see §0.1 |
| Q2 | R3 | Which event carries approved / rejected? | Decides whether the admin can switch them separately. | (a) **reject → existing "Returned for correction" (`approval.returned`); approve → new "Stock audit approved"** (b) one new event "Stock audit reviewed" for both (c) two new events | (a) | |
| Q3 | R2 | The "needs approval" push on other records carries a one-tap **Approve** button. A stock audit cannot be approved from a notification — `POST /api/approvals/quick` refuses `STOCK_AUDIT` because the approver must choose whether to apply counts to stock (`src/app/api/approvals/quick/route.ts:91-97`). | A button that always fails is worse than none. | (a) **no buttons — tapping opens the audit** (b) an "Open" button only | (a) | |
| Q4 | R1 | An audit assigned to **its own creator** (a self-count is allowed, `stock-counts/route.ts:110`). | Pushing yourself is noise. | (a) **no push when assignee = creator** (b) push anyway | (a) | |

### 1.1 Decisions on record

| Date | Q | Decision |
|---|---|---|
| 24 Sep 2026 | Q1 | Assigned, completed → needs approval, approved / rejected. **Not** re-assigned. |
| 24 Sep 2026 | Q2 | **(a)** Reject → existing `approval.returned`; approve → new `stock_audit.approved`. |
| 24 Sep 2026 | Q3 | No option picked; the recommended default **(a)** applies — no buttons, tapping opens the audit. |
| 24 Sep 2026 | Q5 | Inbound / outbound: **nothing changes** — their existing approval pushes stay; nothing is added. Transfers keep theirs. |
| 24 Sep 2026 | Q4 | **(a)** No push to yourself — a self-count sends no "assigned" push (same rule as assembly, Q6). |
| 24 Sep 2026 | Q6 | Assembly: **one push per assignment**, not one per bicycle; no push when assigning to yourself. |

---

## 2. How it works today — verified against the code

### 2.1 An audit always has an assignee, and nobody is told

- `StockCount.assignedToId` is required (`prisma/schema.prisma`, model `StockCount`); creation
  refuses without one (`src/app/api/stock-counts/route.ts:108`) and refuses assigning to yourself
  unless it is a self-count (`:110`). The audit is created in a transaction at `:207-245` and
  returned at `:264`.
- Statuses: `PENDING → IN_PROGRESS → COMPLETED → APPROVED | REJECTED`, and `REJECTED →
  IN_PROGRESS` (`src/app/api/stock-counts/[id]/route.ts:204-210`). Completion is set at `:338`,
  approval at `:352`, rejection (with `rejectionReason`) at `:356-357`; an `ApprovalEvent` is
  recorded for approve / reject at `:579-592`; the route answers at `:634`.
- **No `notify()` call exists anywhere in the stock-audit code.** The assignee finds an audit
  only by opening the stock-audit screen ("mine" filter on `assignedToId`, `route.ts:37`).

### 2.2 The event catalog already claims stock audits, falsely

`src/lib/notify/events.ts` — `approval.requested`'s description says "An inbound, outbound,
transfer **or stock audit** is waiting for approval". Only inbound, outbound and transfer raise
it (`src/lib/approvals/actions/{inbound,delivery,transfer}.ts`, `deliveries/[id]/find-stock`).

### 2.3 Assembly assignment sends nothing

`POST /api/assembly/tasks` (`src/app/api/assembly/tasks/route.ts:416`, guard
`requireFeature("assembly","approve")`) assigns one unit or up to 500 (`unitIds`) to one
`assignedToId`, creates the `AssemblyTask` rows in a transaction (`:519`), moves the units to the
assembly bin, logs at `:572` and answers at `:577`. **No `notify()` call.** The mechanic's queue is
`/assembly` (filtered to their own tasks, `:138`).

### 2.4 The pattern to copy

`src/lib/approvals/actions/transfer.ts:278-306`: recipients from `usersWithPermission(module,
"approve")` minus the actor, `notify()` inside `after()` so the response is not held up and the
send happens after the commit, every failure logged and swallowed.

---

## 3. Implementation plan

No schema change, no migration, no RBAC change. `NotificationEventSetting` rows are keyed by
event key, so a new event appears on Settings → Notifications with its default.

### 3.1 Events — `src/lib/notify/events.ts`

- New **`stock_audit.assigned`** — "Stock audit assigned to you", default push on.
- (Q2a) New **`stock_audit.approved`** — "Your stock audit was approved", default push on.
- `approval.requested` description stays true once R2 ships; `approval.returned` description
  gains "stock audit".

### 3.2 One helper — `src/lib/notify/stock-audit.ts` (new)

`notifyStockAudit(kind, { stockCountId, countNo, title, scopeLabel, assignedToId, actorId,
actorName, reason? })`, run inside `after()`, never throws, logs every failure:

| kind | Event | Recipients | Title / body | Link |
|---|---|---|---|---|
| `assigned` (R1) | `stock_audit.assigned` | `[assignedToId]`, skipped when it equals `actorId` (Q4a) | "Stock audit SC-… assigned to you" / "<title> — <scope>, due <date>, from <actor>" | `/stock-audit/<id>` |
| `completed` (R2) | `approval.requested` | `usersWithPermission("stock_audit","approve")` minus `actorId` | "Stock audit SC-… needs approval" / "<title> — counted by <actor>" | same; `data: { activity: "STOCK_AUDIT", recordId }`, **no `actions`** (Q3a) |
| `approved` (R3) | `stock_audit.approved` | `[assignedToId]` minus `actorId` | "Stock audit SC-… approved" / "by <actor>" | same |
| `rejected` (R3) | `approval.returned` | `[assignedToId]` minus `actorId` | "Stock audit SC-… sent back" / "<reason or 'no reason given'> — <actor>" | same |

### 3.2b Assembly — `stock_audit.assigned`'s sibling

- New event **`assembly.assigned`** — "Bicycles assigned to you for assembly", default push on.
- After the transaction in `POST /api/assembly/tasks` returns (before `:577`), inside `after()`:
  recipient `[assignedToId]`, skipped when it equals the assigner; title "N bicycle(s) assigned
  to you for assembly", body "<first product name>[ and N−1 more] — from <assigner>", link
  `/assembly`. One push for the whole request, whatever N is (Q6).

### 3.3 Call sites

- `src/app/api/stock-counts/route.ts` POST — after the transaction returns (`:264`), `assigned`.
- `src/app/api/stock-counts/[id]/route.ts` PUT — after the update commits (`:634`), one call
  keyed on the transition that just happened: `COMPLETED` → `completed`; `APPROVED` →
  `approved`; `REJECTED` → `rejected`. Never inside the transaction (notify does network I/O).

### 3.4 Logging

`createLogger("notify:stock-audit")` — `debug` for recipients resolved, `info` for sent with
`{ stockCountId, kind, recipients }`, `error` for a failed send. Identifiers only.

### 3.5 Board of agents — to check at build

backend-engineer (after-commit sends, no N+1), inventory-consultant (audit lifecycle wording),
warehouse-consultant (assembly assignment wording),
frontend-engineer (the link opens the right screen for assignee and approver).

---

## 4. Verification

1. `npx tsc --noEmit`, `npm run build`.
2. On the test site, with push configured and two users each with a registered device:
   - A creates an audit assigned to B → **B** gets "assigned to you"; A gets nothing.
   - B starts and completes it → approvers (not B) get "needs approval", with no Approve button;
     tapping opens the audit.
   - An approver rejects with a reason → B gets "sent back" with the reason; approves → B gets
     "approved".
   - A self-count (A assigns to A) → no "assigned" push.
   - A supervisor assigns 5 bicycles to mechanic M → M gets **one** push "5 bicycles assigned to
     you for assembly"; tapping opens `/assembly`.
   - An inbound or outbound still sends exactly the pushes it sends today.
3. Settings → Notifications lists the new event(s) and switching one off stops it (an
   `NotificationLog` row with status `SKIPPED`).

---

## 5. Out of scope, deliberately

- **Re-assigning** an audit (not asked for, Q1).
- A one-tap Approve for stock audits — approval stays on its own screen (Q3).
- Reminders for overdue audits (`dueDate`) — would need a scheduler, which this app does not have.
- Transfer assignment — transfers have no assignee field; a separate feature if wanted.
