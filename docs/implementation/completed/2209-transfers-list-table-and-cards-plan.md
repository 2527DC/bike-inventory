# /transfers: a table on PC, clear cards on phone, and the whole row opens the transfer

Status: completed — 22 Sep 2026, /transfers is a table on PC (≥ 1024 px) and compact cards on phone, and a tap anywhere on a row or card opens the transfer while Approve / Reject act in place; on `feat/2209-audit-bin-transfers-list-permissions`; tsc and lint clean; owner owes `npm run build` + browser walk.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (22 Sep 2026)

> /transfers in this screen why i am not able to open the stcok transfer details why

> and i think i can have the table like listing screen in te big screen and a good and perfect
> card type listing for small screens

Scope, answered the same day: **"Only /transfers"**. Other list screens come later, one at a
time.

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **Tapping a transfer anywhere on its row or card opens its details** (`/transfers/[id]`). Today only a small, pale `>` arrow does (§2). |
| R2 | At **≥ 1024 px** the list is a **table**, one row per transfer. |
| R3 | At **< 1024 px** each transfer is a **clear, compact card**. |
| R4 | Nothing the list shows or does today is lost: status badge and colour edge, route From → To, item count and products, document-attached tick, created by and date, reviewed by, sent-back / rejection note, **Approve / Reject** for approvers on PENDING orders, the status and date filters, New Order, and the empty and error states. |
| R5 | Approve, Reject and any link inside a row never also open the transfer. |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| Q1 | R2 | Table columns? | Sets the PC layout. | (a) **Order no · Status · From → To · Items · Doc · Created (by + date) · Reviewed by · Actions** (Approve / Reject when PENDING and the viewer can approve). The note shows as a small second line under the order no. (b) fewer columns | **(a)** |
| Q2 | R3 | What goes on a phone card? | Sets the phone layout. | (a) **Line 1:** order no + status. **Line 2:** From → To. **Line 3:** "3 items · Hero Kids 20T +2 more" · date. **Line 4**, only when present: sent-back / rejection note. **Line 5**, only for approvers on PENDING: Approve / Reject. (b) keep today's card as it is and only make it tappable | **(a)** |
| Q3 | R4 | The in-list **item preview** (first 2 products, "+N more" expands) | With the whole card opening the details, the expand competes with the tap. | (a) **drop the expand**: show the first product name + "+N more"; the full list is on the detail page (b) keep the expand | **(a)** |
| Q4 | R2 | The table breakpoint: **1024 px**, as `/stock`? | Consistency across screens. | (a) **1024 px** (b) other | **(a)** |
| Q5 | R2 | Sortable columns? The API returns newest first. | Sorting needs an API change. | (a) **no sorting**, newest first as today (b) sort by date / status (API change) | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 22 Sep 2026 | scope | **Only /transfers.** |
| 22 Sep 2026 | Q1–Q5 | **All defaults** (owner): the Q1a columns, the Q2a card, the item expand removed, the table from 1024 px, no sorting. |

---

## 2. How it works today — verified against the code (22 Sep 2026)

- **Why a transfer "won't open":** `src/app/(dashboard)/transfers/page.tsx:320–326`. The only way
  into a transfer is a `<Link>` wrapping a `ChevronRight` icon at the card's top-right, coloured
  `text-slate-300` (pale grey). The `Card` (`:291`) has no link or click handler, so tapping the
  order number, the route or the items does nothing.
- **The detail page itself works.** `src/app/(dashboard)/transfers/[id]/page.tsx` (671 lines)
  loads through `apiTry` (`:129`). The API `GET /api/transfer-orders/[id]` needs
  `transfers.view`, the same grant as the list (`src/app/api/transfer-orders/[id]/route.ts:48`).
  Verified 22 Sep on the local production build as the seed admin: `TRF-202609-0001` returned 200
  from the API, and `/transfers/<id>` served 200.
- **The list (451 lines):**
  - one `Card` per order with a colour edge by status (`:282–290`)
  - order no + status badge + document tick (`:296–305`)
  - item count · created by · date (`:307–309`)
  - header route From → To (`:312–318`)
  - item preview, first 2 with an expand (`:329–355`)
  - notes and the sent-back / rejection note (`:358–363`)
  - reviewed by, and Approve / Reject for `transfers.approve` holders on PENDING orders
    (`:366–393`)
  - the reject dialog (`:398+`)
  - filters: a status + date `FilterSheet` (`:231–260`)
  - loading, empty and error states (`:263–280`)

---

## 3. Implementation plan

Front end only. No API, schema or RBAC change.

- **Shared row contract** `src/app/(dashboard)/transfers/_components/transfer-row.tsx`: the
  `TransferOrder` type, `statusBadge`, the colour-edge helper, the route label, and a
  `TransferRowContext` (canApprove, approvingId, onApprove, onReject, hrefFor). Same pattern as
  `/stock`, so the table and the cards cannot drift apart.
- **`transfer-table.tsx`** (≥ 1024 px): the Q1 columns, row click → `router.push`, and the order
  no as a real `<Link>` for keyboard and middle-click. Approve / Reject stop propagation (R5).
  Sticky header; the same in-box scroll below 1280 px as `/stock`.
- **`transfer-card.tsx`** (< 1024 px): the Q2 lines, wrapped in a `<Link>`, with the colour
  edge. Approve / Reject stop propagation and `preventDefault` (R5).
- **`page.tsx`:** renders both behind `hidden lg:block` / `lg:hidden` from one `orders` list.
  The filters, New Order, reject dialog, confirmation, loading, empty and error states are
  unchanged. The expand state goes (Q3a).
- **Logging:** no new events. Approve / reject already log.

**Board of agents:** frontend engineer (row-as-link accessibility, touch targets, no layout
shift).

---

## 4. Verification

- `npx tsc --noEmit`. `npm run build` is run by the owner.
- Browser, at 1366 px: the table shows; clicking anywhere on a row opens the transfer; Approve /
  Reject on a PENDING row act without opening it.
- At 390 px (phone): cards show; tapping a card opens the transfer; Approve / Reject work in
  place; there is no sideways scroll.
- The status and date filters, New Order, and the empty and error states behave as before.

---

## 5. Out of scope

- Other list screens (Inbound, Deliveries, Stock audit, Purchase orders, Bins). One at a time,
  later.
- Sorting (Q5a).
- Any change to the detail page.

---

## 6. Build record — 22 Sep 2026

On `feat/2209-audit-bin-transfers-list-permissions`.

- `_components/transfer-row.tsx` (shared): the types, `StatusBadge`, `transferAccent`,
  `routeLabel`, `itemsSummary`, `reviewNote`, `showReview`, `TransferRowContext`.
- `_components/transfer-table.tsx` (≥ 1024 px):
  - columns: Order no (a link, with the notes / sent-back / rejection lines under it) · Status ·
    From → To · Items · Doc · Created · Reviewed by · Approve / Reject
  - whole-row click opens the transfer, with the colour edge on the first cell
  - sticky header, and the in-box scroll below 1280 px
- `_components/transfer-card.tsx` (< 1024 px):
  - order no + status + doc · From → To · items + date
  - a muted "By X · Reviewed by Y" line, so created-by and reviewed-by are not lost on a phone
  - the notes · Approve / Reject at 44 px
  - wrapped in a `<Link>`
- Approve / Reject call `preventDefault` + `stopPropagation`, so they never open the transfer.
- `page.tsx`: 451 → 292 lines. The expand and the pale ChevronRight link are removed; the filters,
  New Order, reject dialog, confirmation, and the empty and error states are unchanged.
- `tsc --noEmit`: 0 source errors. ESLint on `transfers/`: clean.
- Not done: `npm run build`, browser walk.
