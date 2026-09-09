# Vendor opening balance reaches the listing

Status: in-progress — 8 Sep 2026, the list route select, the /vendors listing, and its fetch
Branch: **`chore/brand-stock-module-and-tooling`** — the owner decided on 8 Sep 2026 that this ships on the current branch, not on a branch of its own (see Clarifications).

Opening balance shows on `/vendors/[id]` and is blank on `/vendors`. One field, missing from
one `select`.

Everything below was read from the code on disk on 8 Sep 2026. File and line are given so the
next reader can check rather than trust.

---

## 1. Root cause — the list route's `select`, not the data

`src/app/api/vendors/route.ts:31-38` selects eight named fields:

```ts
select: {
  id: true, name: true, code: true, city: true, phone: true,
  whatsappNumber: true, isActive: true, paymentTermDays: true,
  _count: { select: { purchaseOrders: true, bills: true } },
  bills: { where: { status: { not: "PAID" } }, select: { amount: true, paidAmount: true } },
},
```

`openingBalance` is not among them, so it never leaves the server.

`GET /api/vendors/[id]` (`api/vendors/[id]/route.ts:13-30`) uses `include` with **no**
`select`, so Prisma returns every Vendor scalar — `openingBalance` included. That single
difference is the whole bug.

The column exists and is populated: `prisma/schema.prisma:757` —
`openingBalance Float @default(0) // As of 2026-04-01`, created in `0_init/migration.sql:439`.
The detail screen reads it at `vendors/[id]/page.tsx:239` and can edit it at `:275`.

### It is not the same number as `outstandingBalance`

The listing already shows `outstandingBalance`, computed at `api/vendors/route.ts:46-51` from
bills that are not `PAID`:

```ts
const balance = v.bills.reduce((sum, b) => sum + (b.amount - b.paidAmount), 0);
```

That is current exposure. `openingBalance` is the carried-forward figure as of 1 Apr 2026.
Both belong on the listing; neither replaces the other.

---

## 2. The change

| File | Line | Change |
|---|---|---|
| `src/app/api/vendors/route.ts` | `:33` | add `openingBalance: true` to the select |
| `src/app/(dashboard)/vendors/page.tsx` | `:27-37` | add `openingBalance: number` to `VendorItem` |
| `src/app/(dashboard)/vendors/page.tsx` | `:179` | new **Opening Bal.** column in `DesktopTable`, beside Outstanding |
| `src/app/(dashboard)/vendors/page.tsx` | `:222` | show it on the mobile card |
| `src/app/(dashboard)/vendors/page.tsx` | `:15-25` | add to `VENDOR_COLUMNS`, so the Excel and PDF exports carry it |
| `src/app/(dashboard)/vendors/page.tsx` | `:70-79` | **added 8 Sep 2026 (owner):** replace the raw `fetch().then(r => r.json())` and the bare `.catch(() => {})` with `apiFetchEnvelope<VendorItem[]>` in a try/catch that sets an error state and calls `log.error` — the pattern `customers/page.tsx:100-114` already uses. `apiFetchEnvelope`, not `apiTry`, because the page reads `pagination.total`, which sits beside `data` and `apiFetch` discards. |

Render `₹0` as a muted `—`, the way the Outstanding column already treats zero
(`vendors/page.tsx:181`). Most vendors will read zero until balances are entered, and a column
of `₹0` is noise that hides the rows that matter.

Format with the same `toLocaleString("en-IN")` the neighbouring column uses (`:180`), so the
two money columns agree on grouping.

Colour: Outstanding is red because it is money owed and actionable. Opening balance is a
carried-forward fact, so keep it neutral (`text-slate-700 tabular-nums`) — the same treatment
the detail screen gives it at `vendors/[id]/page.tsx:239`.

### No API contract break

`openingBalance` is `Float @default(0)`, non-nullable, so every row returns a number and no
existing consumer sees a new null. The field is additive to the response; nothing that reads
`/api/vendors` today can break by receiving it.

---

## 3. The second bug, in the other vendor listing

> **Out of scope — 8 Sep 2026, owner's decision.** `/desktop/vendors` is not touched by this
> plan. Work concentrates on `/vendors`, which serves both the PWA and the laptop screen.
> The findings below stand as a record of the bug; fix it under its own plan.

`src/app/desktop/vendors/page.tsx` reads the same endpoint and declares (`:8-18`):

```ts
interface Vendor {
  …
  isStarred: boolean;
  balance: number;
  _count: { bills: number };
}
```

**The API returns neither.** It returns `outstandingBalance`, and no `isStarred` field exists
in the schema or anywhere in the route. So that screen's balance column renders `undefined`
and its star column is permanently false.

Nothing catches it because `:31` does:

```ts
fetch("/api/vendors?limit=500").then((r) => r.json())
```

— the raw pattern CLAUDE.md bans. `apiFetch` / `apiTry` from `src/lib/api-client.ts` would
have carried a response type; a bare `.json()` returns `any` and the interface is never
checked against reality.

This is the same class of failure as the `/stock/by-bin` one fixed in `3b0e407`: a page
reading fields the API never sends, invisible because the JSON is cast rather than parsed.

**Recommendation: fix it here.** It is small and the alternative is shipping a correct vendor
listing next to a broken one:

- `balance` → `outstandingBalance`;
- drop `isStarred`, or derive the stars from `_count.bills` the way `/vendors` already does
  (`vendors/page.tsx:42-46`, `getStarRating`);
- switch `:31` to `apiTry`, which is what makes the next mismatch a type error;
- add `openingBalance` here too, so both listings show the same facts.

---

## 4. Verification

1. `npx tsc --noEmit` — clean.
2. `npm run build` — must pass.
3. `/vendors` — a vendor with a non-zero opening balance shows it in the desktop table and on
   the mobile card. A vendor with zero shows `—`, not `₹0`.
4. Export to Excel and to PDF; the Opening Balance column is present and matches the screen.
5. Compare one vendor's listing figure against `/vendors/[id]` — the two must agree, since
   they now read the same column.
6. ~~`/desktop/vendors` — the balance column shows a number rather than blank, and the stars
   reflect bill counts.~~ Dropped 8 Sep 2026 — the desktop listing is out of scope.
8. **Added 8 Sep 2026.** Stop the API (or force a 500) and load `/vendors`: the page shows an
   error with a retry, not a silent empty list, and the browser console carries the
   `vendors` logger line.
7. Search and the `highest_due` / `lowest_due` sorts still work: they key on
   `outstandingBalance` (`vendors/page.tsx:92-93`) and must be untouched by this change.

---

## 5. Out of scope, deliberately

- **Sorting or filtering by opening balance.** Nobody asked, and the two existing sorts are
  about money currently owed. Add it when someone wants it.
- **Making `openingBalance` editable from the listing.** It is editable on the detail screen
  (`vendors/[id]/page.tsx:255-278`), which is where a single-vendor correction belongs.
- **Backfilling opening balances.** This plan makes an existing column visible; what is in it
  is a data question, not a code one.

## Clarifications — 8 September 2026

### Verified against code
- List route `select` has eight fields and no `openingBalance` — CONFIRMED, `src/app/api/vendors/route.ts:30-38`
- Detail route uses `include` with no `select` — CONFIRMED, `src/app/api/vendors/[id]/route.ts:13-30`
- `openingBalance Float @default(0)` — CONFIRMED, `prisma/schema.prisma:757`, `0_init/migration.sql:439`
- Detail page reads at :239 and edits at :275 — CONFIRMED, `vendors/[id]/page.tsx:238-239`, `:275`
- `outstandingBalance` computed from non-PAID bills — CONFIRMED, `route.ts:47-50`
- `VendorItem` :27-37, Outstanding column :179, mobile card :222, `VENDOR_COLUMNS` :15-25 — CONFIRMED, all four ranges match
- Export handles dotted keys and `format` — CONFIRMED, `src/lib/export.ts:3-11`
- Sorts key on `outstandingBalance` — CONFIRMED, `vendors/page.tsx:92-93`
- Detail screen colour is `text-slate-700 tabular-nums` — DRIFTED, it is `text-sm font-bold text-slate-900 tabular-nums` at `[id]/page.tsx:238`. The listing keeps neutral slate-700; only the justification was off.
- Desktop page declares `isStarred` and `balance`, API sends neither — CONFIRMED, `desktop/vendors/page.tsx:16-17`; `isStarred` exists nowhere else. Out of scope now (§3).
- `/vendors` itself uses raw `fetch().then(r => r.json())` and a bare `.catch(() => {})` — CONFIRMED, `vendors/page.tsx:70-79`. Not in the original plan; added to §2.
- `apiFetchEnvelope` exists and is the helper that carries `pagination` — CONFIRMED, `src/lib/api-client.ts:137`
- Branch does not exist yet — MISSING, `git branch`
- Plan's files are identical on HEAD and `origin/main` (`58bcfab`, squash of PR #39) — CONFIRMED, `git diff --stat` empty
- No other pending plan touches these files — CONFIRMED
- Working tree holds uncommitted AI-provider work (10 modified, 8 untracked); none of it is this plan's files — CONFIRMED, `git status --short`

### Answers
- Q1 Branch base — **current branch** `chore/brand-stock-module-and-tooling`, not `origin/main`. Then, on go: **no separate branch at all**; implement directly on the current branch.
- Q2 Convert the `/vendors` raw fetch too — **yes**. Use `apiFetchEnvelope` with a logged error and an error state (§2 row added).
- Q3 `/desktop/vendors` zero rendering — **do not work on the desktop vendor module at all.** Concentrate on `/vendors`, which serves both the PWA and the laptop screen. §3 and verification item 6 dropped.
