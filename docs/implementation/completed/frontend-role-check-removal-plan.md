# Frontend role-name checks — removal plan

Status: completed — 30 Aug 2026, all 21 sites in 18 files. Commit `53e36cf` on branch `fix/frontend-role-checks`. `activity.approve` added to the catalog and seeded (170 permissions, 1 new).

> **§11’s three greps all return nothing** — no `role === "ADMIN"`, no `["ADMIN"`, and no
> `session?.user as { role` survives anywhere in `src/`. `tsc --noEmit` is clean and
> `npm run build` passes.
>
> **The browser pass has NOT been run, and one test matters more than the rest.**
> `/price-correction` was failing OPEN (§2.1), so fixing it REMOVES access. Signing in as
> ADMIN proves nothing there — the page rendered for everyone. Sign in as a **non-admin**
> without `stock.view` and confirm the redirect. Skipping that is how the one
> behaviour-removing change in this plan ships unverified.
>
> **Found in passing, out of scope:** `src/app/api/services/prices/route.ts:19` compares role
> NAMES server-side — `!["MANAGER","STAFF","BILLING","SUPERVISOR"].includes(user.roleName)`.
> That is a real CLAUDE.md violation and it is load-bearing (a genuine API gate, not a
> cosmetic one), so changing it could break the workshop. This plan covered frontend gates
> only; raise it separately.
Suggested branch: `fix/frontend-role-checks` (its own branch — it touches 18 page files plus the RBAC catalog).
Prepared 29 Aug 2026. Counts and line numbers re-verified 29 Aug 2026 against `src/`.
Prerequisite: `app-logic-and-problems-removal-plan.md` — **DONE**, executed on branch
`chore/remove-app-logic-and-problems`. Its two sites (§8 Q2) were deleted rather than fixed, and
have been struck from every table below. All counts here are post-deletion.

---

## 1. The bug, in three lines

`src/app/(dashboard)/more/brands/page.tsx:20`

```ts
const role = (session?.user as { role?: string })?.role || "";
const isAdmin = role === "ADMIN" || role === "CEO";
```

`src/lib/auth.ts:101` — what the session callback actually sets:

```ts
u.userId   = token.userId;
u.roleKey  = token.roleKey;
u.roleName = token.roleName;
```

There is no `role` field. It was removed when the app moved to dynamic RBAC, because
CLAUDE.md requires the JWT to carry identity only. So `role` is `""`, `isAdmin` is `false`,
and the page reports **"Admin access required" to every user including ADMIN**.

## 2. Why this went unnoticed

For 21 of the 23 sites it fails in the safe direction. An over-restrictive gate hides a
feature; it does not leak one. Nothing throws, nothing 500s, no log line is written. The
screen simply renders its denial branch, which looks exactly like a permission that was never
granted — so the instinct is to go and fix the seed, which cannot possibly help, because the
page never asks the database anything.

Reseeding RBAC will not change the outcome. Neither will granting more permissions. The check
does not consult the permission system at all.

### 2.1 ⚠️ Two lines — one page — fail the OTHER way

An earlier draft of this plan said *"every one of them denies everybody"* and *"the frontend
is over-restrictive, not under."* **That is not true of `/price-correction`**, and the difference is the
guard's shape, not its intent:

```ts
// The 19 safe ones — an ALLOW-list. role is "", so isAdmin is false, so the UI hides.
const isAdmin = role === "ADMIN" || role === "CEO";

// The 2 unsafe ones — a DENY-list with a truthiness guard in front of it.
if (role && role !== "ADMIN") { /* redirect */ }
//  ^^^^ role is "" — falsy — so the whole check is SKIPPED and the page renders.
```

| File | Lines | Effect today |
|---|---|---|
| `(dashboard)/price-correction/page.tsx` | 68, 134 | renders for **every** signed-in user |

> `/more/app-logic:581` was a third such line, and the worst of them — it read `?.role` with no
> `\|\| ""`, so the value was `undefined`, falsy for the same reason. It is **deleted**.
> `app-logic-and-problems-removal-plan.md` ran first precisely so this one would not be patched
> and then thrown away.

**Still not a security hole, and this was checked rather than assumed.** Both APIs behind
price-correction guard themselves:

| Route | Guard |
|---|---|
| `api/stock/price-check/route.ts:25` | `requireFeature("stock", "view")` |
| `api/stock/price-check/[productId]/route.ts:14` | `requireFeature("stock", "edit")` |

So a user without `stock.edit` sees the screen and cannot save from it.

**Two consequences for this plan:**

1. Fixing these two **removes** access rather than restoring it. Every other site in the plan
   reveals hidden UI; these two hide currently-visible UI. Expect that in review.
2. §11's check *"signed in as ADMIN, every screen renders its full UI — today they render a
   denial"* is **not a valid test for these two**. They already render fully. The correct
   check is the opposite: sign in as a non-admin and confirm the page is now refused.

**Any future audit of this class must grep the field, not the comparison** — and must read
the guard's polarity, because an allow-list and a deny-list built on the same dead field fail
in opposite directions.

## 3. This is the rule CLAUDE.md puts first

> **Never compare a role name.** `if (user.role === "ADMIN")` and
> `["SUPERVISOR","MANAGER"].includes(role)` are both wrong.

The stated reason is that roles are rows an admin can create at runtime, so no list of names
in code can be correct. This plan is the second, sharper reason: the field those comparisons
read was deleted, and comparing against a name gave no compile-time signal when it went.
A `can("brands", "create")` call would have been a type error the day the field changed.

## 4. Not a security hole — including the two that fail open

Every API behind these screens guards itself properly:

| Route | Guard |
|---|---|
| `api/brands/[id]/merge/route.ts:13` | `requireFeature("brands", "create")` |
| `api/brands/route.ts:11,25` | `requireFeature("brands", "view" / "create")` |
| `api/bins/route.ts:11,26` | `requireFeature("settings", "view" / "create")` |
| `api/stock/price-check/route.ts:25` | `requireFeature("stock", "view")` |
| `api/stock/price-check/[productId]/route.ts:14` | `requireFeature("stock", "edit")` |

For the 19 allow-list sites the frontend is over-restrictive: the screens are just unusable.
For the 2 deny-list lines (§2.1) it is over-permissive, but the API is still the gate and it
holds — a non-admin can open `/price-correction` and cannot save from it.

Nothing is exposed either way, which is why this is a bug and not an incident.

## 5. Scope — 21 sites in 18 files

All read `session.user.role`. All evaluate against a value that is always `""` or `undefined`.

> **Counting history, because it went wrong twice.** The first sweep found **16** — it
> searched for `role === "` and missed every check written as `["ADMIN","CEO"].includes(role)`
> or assigned through an intermediate (`userRole`, `canApprove`, `canBulkEdit`). Grepping the
> *cast* instead — `session?.user as { role` — found the rest. A second draft then said "21
> sites in 19 files" in its header while its own tables listed 23 in 20, and §10/§11 still
> said 16.
>
> **23 sites in 20 files** was the verified figure on 29 Aug 2026, from
> `grep -rn 'session?.user as { role\|role === "ADMIN"\|role === "CEO"\|\["ADMIN"' src/`
> (36 matching lines: 20 field reads + 23 gates, with some lines doing both).
>
> **It is now 21 in 18.** `/more/problems` and `/more/app-logic` were deleted outright by
> `app-logic-and-problems-removal-plan.md` (§8 Q2), taking one gate each with them. That same
> grep returns **33** lines today. Every line number below was re-checked on 29 Aug 2026 and
> re-confirmed after the deletion.

16 sites in 14 files. `→` marks the polarity: **hides** = allow-list, denies everyone;
**shows** = deny-list, admits everyone (§2.1).

| File | Line(s) | Today |
|---|---|---|
| `(dashboard)/more/brands/page.tsx` | 21 | hides |
| `(dashboard)/more/bins/page.tsx` | 29 | hides |
| `(dashboard)/deliveries/page.tsx` | 29 | hides |
| `(dashboard)/price-correction/page.tsx` | 68, 134 | ⚠️ **shows** (both) |
| `(dashboard)/second-hand/page.tsx` | 58, 114 | hides |
| `(dashboard)/second-hand/verify/page.tsx` | 27 | hides |
| `(dashboard)/second-hand/[id]/page.tsx` | 56 | hides |
| `(dashboard)/stock/[id]/page.tsx` | 87 | hides |
| `(dashboard)/stock/by-brand/page.tsx` | 62 | hides |
| `(dashboard)/inbound/[id]/page.tsx` | 84 | hides |
| `(dashboard)/vendor-issues/page.tsx` | 104 | hides |
| `(dashboard)/activity/page.tsx` | 60 | hides |
| `desktop/activity/page.tsx` | 59 | hides |
| `(dashboard)/accounts/settlement/page.tsx` | 49 | hides (partial — see below) |

### Found in the second sweep — same bug, different spelling

5 sites in 4 files, all allow-lists, all hiding. 16 + 5 = **21**.

| File | Line(s) | Flag | What it gates |
|---|---|---|---|
| `(dashboard)/transfers/new/page.tsx` | 66 | `isAdmin` via `.includes()` | transfer auto-approval — an admin's transfer should skip the approval queue and currently never does |
| `(dashboard)/stock-audit/[id]/page.tsx` | 75 | `canApprove` (3 names) | approving a stock audit |
| `(dashboard)/stock-audit/[id]/page.tsx` | 76 | `isAdmin` | "Correct stock levels" — overwrites counted stock |
| `(dashboard)/stock-audit/[id]/review/page.tsx` | 71 | `canApprove` (4 names) | approving from the review screen |
| `(dashboard)/stock/page.tsx` | 111 | `canBulkEdit` (3 names) | bulk edit on the stock list |

`(dashboard)/stock-audit/new/page.tsx:43` casts `{ userId?: string; role?: string }` but reads
only `userId`. The `role` in that type is unused — harmless, not a bug, and left alone.

`accounts/settlement` is the only partial survivor: it reads
`role === "ADMIN" || role === "CEO" || canDeleteCheck("bills")`, so the permission half
still works and the role half is dead weight.

## 6. The mapping

Each permission is taken from what the API already enforces, or from the CLAUDE.md rule that
covers the case. No new judgement was invented where an existing guard already answered it.

| # | File | What it really gates | Becomes |
|---|---|---|---|
| 1 | `more/brands` | whole page (brand merge) | `canCreate("brands")` |
| 2 | `more/bins` | whole page | `canCreate("settings")` |
| 3 | `deliveries` | delete button + `isAdmin` prop to child | `canDelete("deliveries")` |
| 4 | `price-correction` | whole page + inline save | `canView("stock")` / `canEdit("stock")` — §8 Q1 |
| 5 | `second-hand` | cost value, revenue, prices **and** actions | split: `canView("cost_price")` + `canEdit("second_hand")` |
| 6 | `second-hand/verify` | whole page | `canApprove("second_hand")` |
| 7 | `second-hand/[id]` | margin, cost **and** an action | split, as row 5 |
| 8 | `stock/[id]` | the Pricing card (Cost / Selling / MRP) | `canView("cost_price")` |
| 9 | `stock/by-brand` | brand total value + "Highest Value" sort | `canView("cost_price")` |
| 10 | `inbound/[id]` | line rate/amount/total | `canView("cost_price")` — the approval bypass is **deleted**, see §8 Q3 |
| 11 | `vendor-issues` | delete button + delete column | `canDelete("vendor_issues")` |
| 12 | `activity` | Team Activity vs My Activity | `canApprove("activity")` |
| 13 | `desktop/activity` | same | `canApprove("activity")` |
| 14 | `accounts/settlement` | already permission-gated | delete the role half only |
| 15 | `transfers/new` | transfer auto-approval | `canApprove("transfers")` |
| 16 | `stock-audit/[id]` | approve the audit | `canApprove("stock_audit")` |
| 17 | `stock-audit/[id]` | "Correct stock levels" — overwrites counted stock | `canEdit("stock")` — **confirm**, see below |
| 18 | `stock-audit/[id]/review` | approve from the review screen | `canApprove("stock_audit")` |
| 19 | `stock` | bulk edit | `canEdit("stock")` |

Both `transfers` and `stock_audit` declare `["view","create","edit","delete","approve"]`, so
rows 15, 16 and 18 need no catalog change.

Row 17 is the one judgement call in this batch. "Correct stock levels" does not approve
anything — it **overwrites each product's `currentStock` with the counted quantity**. That is
a write to stock, not an audit decision, so it is mapped to `canEdit("stock")` rather than
`stock_audit.approve`. Someone who may approve a count is not automatically someone who may
overwrite the books. Say if you disagree.

### Flags doing two jobs

Rows 5 and 7 use one `isAdmin` to hide **money** and to gate an **action**. Those are
different questions and get different permissions. `cost_price` exists as its own module for
exactly this reason — CLAUDE.md: *"Cost-price visibility is its own module."* Collapsing the
two back together would recreate the problem in permission form.

Row 10 was a third such case until Q3 was answered: its action half (the approval bypass) is
deleted rather than mapped, leaving only `cost_price.view`.

### The shared edit

```ts
// out
const { data: session } = useSession();
const role = (session?.user as { role?: string })?.role || "";
const isAdmin = role === "ADMIN" || role === "CEO";

// in
const { canView, canEdit, canDelete, canApprove, canCreate, loading } = usePermissions();
```

**Every denial branch must check `loading` first.** `usePermissions` exposes it precisely
so a page never renders a denial against a permission set that has not arrived yet. Skipping
this produces a flash of "Admin access required" on every visit — the same symptom as the
bug being fixed, which would make the fix look like it failed.

## 7. One catalog change is required

`prisma/rbac-catalog.ts:81` — the `activity` module declares:

```ts
actions: ["view", "create"],
```

There is no `approve`. But "supervisors see everyone's activity, staff see only their own"
is precisely the rule CLAUDE.md says to express as the module's `approve` grant:

> Rules like "supervisors see all records, juniors see only their own" are expressed as the
> module's **`approve`** grant.

So:

```ts
actions: ["view", "create", "approve"],
```

**This makes `npm run db:seed:rbac` part of the change, not optional cleanup.** Until it
runs, the permission row does not exist and sites 14 and 15 deny everyone — the exact
failure this plan removes. Editing `prisma/` also fires the schema-review hook.

### It is the only one — full audit, all three questions answered

Every other action this plan needs already exists. Checked against `prisma/rbac-catalog.ts`
on 29 Aug 2026, after Q1–Q3:

| Module | Declared actions | This plan needs | Present? |
|---|---|---|---|
| `activity` | `view create` | `approve` | ❌ **add it** |
| `cost_price` | `view` | `view` | ✓ |
| `stock` | `view create edit delete fetch` | `view`, `edit` | ✓ |
| `stock_audit` | `view create edit delete approve` | `approve` | ✓ |
| `second_hand` | `view create edit delete approve` | `edit`, `approve` | ✓ |
| `transfers` | `view create edit delete approve` | `approve` | ✓ |
| `deliveries` | `view create edit delete approve fetch` | `delete` | ✓ |
| `vendor_issues` | `view create edit delete approve` | `delete` | ✓ |
| `brands` | `view create edit delete` | `create` | ✓ |
| `settings` | `view create edit delete` | `create` | ✓ |
| `inbound` | `view create edit delete approve fetch` | *(nothing new)* | ✓ |

Three modules that earlier drafts expected to touch, and no longer do:

- **`inbound`** — Q3 deletes the approval bypass rather than mapping it, so no `approve`
  grant is introduced on that page. The `canApprove("inbound")` already there (line 86) is
  correct and untouched.
- **`price_correction`** — Q1 gates the page on `stock` instead. No module, no action.
- **`problems`** — the module is **gone**. `app-logic-and-problems-removal-plan.md` removed it
  from the catalog entirely, so there is nothing left to grant or to check.

**So `activity.approve` is the single catalog edit in this plan.** One line in
`prisma/rbac-catalog.ts`, then `npm run db:seed:rbac`.

## 8. The three questions — all answered 29 Aug 2026

Kept in full rather than collapsed to their answers, because each one records a decision that
would otherwise be re-litigated by the next reader.

**Q1 — `price-correction` — ANSWERED 29 Aug 2026: gate it on the `stock` module.**

Site 6 becomes `canView("stock")` for the page and `canEdit("stock")` for the inline save.
**No catalog change, no new module, no new action, no reseed.**

The reasoning, recorded because two richer options were considered and rejected:

*The API had already decided this.* Both routes the page calls guard themselves on `stock`:

| Route | Guard |
|---|---|
| `api/stock/price-check/route.ts:25` | `requireFeature("stock", "view")` |
| `api/stock/price-check/[productId]/route.ts:14` | `requireFeature("stock", "edit")` |

The page is a bulk editor for `sellingPrice` — the same field a user with `stock.edit` can
already change one product at a time from the product screen. A separate permission would not
protect anything; it would be a second door to a room already open. Gating on `stock` makes
the frontend agree with the API it calls, which is the whole point of this plan.

**Rejected — a `price_correction` action on `stock`.** Owner's first instinct was
`price_correction_read` / `price_correction_edit` as *actions*.

> **A claim made against this during planning was wrong, and is corrected here so it is not
> repeated.** It was asserted that a new action becomes a column on all 27 modules, leaving 26
> with dead toggles. **It does not.** Permission rows are generated per declared action —
> `allPermissionSeeds()` at `prisma/rbac-catalog.ts:711` flatMaps `m.actions`, so only modules
> that declare an action get a row for it. The editor renders each module's *existing* rows
> and uses `ACTION_ORDER` (`team/permissions/page.tsx:267`) **only to sort** them, not to lay
> out a fixed grid. An action declared on `stock` alone creates exactly one row,
> `stock.price_correction`, and touches nothing else. Actions are per-module permissions, as
> the owner said.

The genuine reason to reject it is smaller: **an action *is* one grant.** `stock.price_correction`
is a single yes/no. The ask was for `view`, `create` and `edit` — three grants — which an
action cannot express. Only a module has actions beneath it.

For the record, adding an action costs 5 files: `ActionKey` and `ACTION_LABELS`
(`prisma/rbac-catalog.ts:10,13`), `PermAction` in `src/lib/rbac.ts:20` **and**
`src/stores/permissions.ts:17` (duplicated rather than imported — CLAUDE.md rule 3 forbids
`src/` importing the catalog), and `ACTION_ORDER` in
`src/app/(dashboard)/team/permissions/page.tsx:37`. That last one is cosmetic only: an action
missing from it gets `indexOf` = `-1` and sorts to the front rather than breaking.

**Rejected — a child module under `stock`.** `parentKey` exists and works (two children under
`settings`, four under `staff_lms`), and would nest Price Correction inside Stock in both the
sidebar and the matrix, with its three actions. Correct mechanism, and it would deliver
exactly what was asked for.

**Both are rejected for the same reason, which is about the API and not about the mechanism.**
The two routes the page calls already guard on `stock.view` and `stock.edit`. Any separate
grant means the page checks one permission and then calls an endpoint that demands another —
two answers to one question, which is how a frontend gate and its API drift apart. That drift
is the entire subject of this plan. Introducing a fresh instance of it while fixing 21 others
would be the wrong trade at any price.

> **§2.1 raised the stakes on getting this answered.** This is one of the two deny-list
> sites, so it is **open to every signed-in user right now**, not hidden. The API still
> refuses the save without `stock.edit`, so nothing can actually be changed — but the screen
> should not be reachable, and after this change it is not.

`docs/doubt-clarification.md` line 13 asks *"Price Correction why do u have that module"*. If
the screen is deleted later, site 6 goes with it and nothing here is wasted — it is two
`usePermissions` calls, not a catalog entry.

> **Owner's steer, 29 Aug 2026:** *"i think u need to bypass because the admin need the
> access for it and the application must be functional."*
>
> Recorded, and the intent is satisfied — but **not** by a bypass, and the distinction
> matters enough to write down. ADMIN already holds **every permission**, granted in
> `seed-rbac.ts` step 4. So `canEdit("stock")` is already true for ADMIN the moment the page
> asks. Any permission check makes the page work for the admin; no special case is needed.
>
> A literal bypass — `if (roleKey === "ADMIN") return true` — is banned by CLAUDE.md rule 2
> ("no admin short-circuit"), and would reintroduce the exact class of bug this plan exists
> to remove: a hardcoded role name that breaks silently the next time the identity shape
> changes. It would also permanently lock the page to ADMIN, so no role you create later
> could ever be given it — the opposite of "the application must be functional".
>
> Q1 therefore still needs an answer, but it is a narrower one: **which** permission, not
> whether to check one. `canEdit("stock")` is the default unless the page is being deleted.

**Q2 — `/more/app-logic` and `/more/problems` (then rows 3 and 4).**
`docs/implementation/pending/app-logic-and-problems-removal-plan.md` deletes both
`/more/app-logic` and `/more/problems`, and removes the `problems` module from the catalog
entirely. Fixing them here is work that gets thrown away. Fix anyway so they are usable in the
meantime, or skip both and let the removal plan handle them? This decides whether the job is
**23 sites or 21**.

> **Asymmetric, because of §2.1.** `/more/problems` is an allow-list site — hidden from
> everyone, so skipping it costs nothing beyond the feature staying unusable until the removal
> plan runs. `/more/app-logic` is a **deny-list** site: it is visible to every signed-in user
> today, and it is an in-file dump of every screen, endpoint, permission rule and Zoho flow in
> the application. Skipping that one leaves internal documentation exposed for however long
> the removal plan takes.

**ANSWERED 29 Aug 2026 — skip both. Both sites are dropped from this plan.**

Scope becomes **21 sites in 18 files**.

**And since executed.** That plan ran on branch `chore/remove-app-logic-and-problems`: both
pages, `/api/problems`, the `AppProblem` model and the `problems` module are deleted. The
prerequisite is satisfied, the two rows are struck from §5 and §6, and the scope figure above
is now simply the total rather than a subset.

> **Historical — the prerequisite has since been met. Kept for the reasoning.**
>
> **This makes `app-logic-and-problems-removal-plan.md` a prerequisite, not a parallel
> track.** Because `/more/app-logic` renders for everyone today, skipping it here means the
> exposure lasts exactly as long as that plan stays unstarted. Run the removal plan **first**.
>
> **That plan is ready to execute** — its three questions were settled 29 Aug 2026 and its
> full inventory was re-verified against the tree the same day. It is 3 directories deleted,
> 4 files edited and one reseed, with no prerequisite of its own, so the dependency is a
> short one and runs strictly one way.
>
> If it does slip, reopen this decision for `app-logic` alone — one `usePermissions` call
> closes it in the meantime — rather than leaving the page exposed indefinitely.
> `/more/problems` carries no such urgency: it is hidden from everyone, so delay costs
> nothing but an unusable feature.

**Q3 — the inbound approval bypass — ANSWERED 29 Aug 2026: drop it.**

`inbound/[id]:176` becomes:

```ts
const isApproved = !!shipment?.approvedAt;   // was: || isAdmin
```

**No permission replaces the `|| isAdmin` half.** It is deleted, not mapped.

*What the line gated.* A shipment sits at `IN_TRANSIT` until someone holding `inbound.approve`
clicks **Approve Inward** (line 591), which writes `approvedAt` / `approvedBy` and makes the
card show *"Approved by [name] on [date]"* (line 566). `isApproved` then unlocks the
**receiving** controls — "Receive into [location]", "Mark All Delivered", "Partial" (lines
650, 674, 688, 711, 744) — and those are what increment stock.

`|| isAdmin` let an admin see the receive controls on a shipment **nobody approved**. Stock
entered inventory with `approvedAt` and `approvedBy` still null, so the record showed no
authoriser. Today the bypass is dead (`isAdmin` is always false), so the gate is currently
working correctly for everyone — which is why removing it changes nothing that users see.

*Why dropped rather than restored as `canApprove("inbound")`.*

1. It saved **one click**. An admin holds `inbound.approve`, so the Approve button is already
   in front of them; the bypass only skipped that tap.
2. That tap **is** the audit record. It is what writes who authorised the receipt.
3. **The API implements no such bypass.** `api/inbound/[id]/status/route.ts:20` requires
   `inbound.edit` and nothing more — the server has no concept of "admin is pre-approved".
   Restoring it in the client would recreate a frontend-only rule with no server counterpart,
   which is precisely the drift this plan exists to remove.

*Consequence for the mapping.* Site 12 stops being dual-purpose. It now needs only
`canView("cost_price")` for the line rate, amount and total. `canApprove("inbound")` is **not**
used on this page — `canDeliver` and `canApprove` at lines 85–86 already come from
`usePermissions` and are correct as they stand.

**No catalog change for `inbound`.** It already declares
`["view","create","edit","delete","approve","fetch"]`.

## 9. Found in passing — not in this plan

`(dashboard)/services/counter/page.tsx:161`:

```ts
const isMechanic = currentUser?.role === "MECHANIC";
```

Different shape: `currentUser` comes from an API fetch rather than the session, and the
catalog's key is `SERVICE_MECHANIC`, not `MECHANIC` — so this likely never matches either.
It drives self-assignment convenience (auto-assigning a job to yourself), not access, so it
needs its own decision about intended behaviour rather than a mechanical permission swap.
Excluded deliberately; raise it separately.

## 10. Rollout

0. ~~Run `app-logic-and-problems-removal-plan.md` first~~ — **done**, on branch
   `chore/remove-app-logic-and-problems`. Both pages are deleted and nothing below depends on
   it any more.
1. Branch `fix/frontend-role-checks` off `main`.
2. Q1–Q3 are all answered. Scope is **21 sites in 18 files**. Nothing blocks.
3. Add `approve` to the `activity` module in `prisma/rbac-catalog.ts`. This is the **only**
   catalog change in the plan — see the audit in §7.
4. Stop the dev server, then `npm run db:seed:rbac`. (`prisma generate` fails with `EPERM`
   while the server holds the query engine.)
5. Convert the sites, one file at a time, splitting the four dual-purpose flags.
6. `npm run build`.

## 11. Verification

- `npm run build` passes. These files are all under `src/`, so the build type-checks them —
  unlike a `prisma/` change, which it does not.
- `grep -rn 'session?.user as { role' src/` returns **nothing**. This is the grep that
  matters — it finds the field access however the result is later spelled. The comparison
  greps below are secondary, and on their own they under-report: they are what missed five
  sites on the first pass.
- `grep -rn 'role === "ADMIN"\|role === "CEO"' src/app/` returns **nothing** (14 lines today).
- `grep -rn '\["ADMIN"' src/app/` returns **nothing** (2 lines today).
- Signed in as ADMIN, all 18 screens render their full UI. Today the 16 allow-list screens
  render a denial or hide the element.
- **The deny-list screen needs the opposite test** (§2.1). `/price-correction` renders for
  everyone today, so "ADMIN can see it" proves nothing there. Sign in as a **non-admin** and
  confirm it is now refused. Skipping this is how the one behaviour-removing part of this
  change ships unverified.
- No flash of denial on load — reload each screen and watch. A flash means a `loading` check
  was missed.
- **The inbound approval gate still holds (Q3).** Open a shipment at `IN_TRANSIT` that nobody
  has approved, signed in as **ADMIN**. The receive controls — "Receive into", "Mark All
  Delivered", "Partial" — must **not** appear; only "Approve Inward" should. Click it, and
  they appear. This is a no-op against today's behaviour by design: the bypass is already
  dead, and this check confirms the rewrite did not wake it up.
- The real proof, and the reason for the whole design: create a role in the UI holding only
  `cost_price.view`, assign it to a test user, and confirm they see prices on `stock/[id]`
  but still cannot delete on `deliveries`. That is one permission granted at runtime with no
  redeploy — which no role-name comparison could ever have expressed.

## 12. Not covered here

Two other problems surfaced in the same session and each needs its own plan and branch:

- **`/api/zoho/trigger-pull` `items` step times out (504).** It runs 2–3 sequential Prisma
  round trips per item against a Singapore database from a Mumbai region, under a
  `maxDuration = 30`. The `bills` step in the same file does the same job in three round
  trips total. The fix is to batch `items` the way `bills` already is.
- **Sample data still in the live database.** `prisma/seed.ts` no longer creates products,
  brands, bins, transactions or LMS content, but a seed only ever writes — the rows written
  by earlier runs are still in Supabase and still render in the UI. Removing them is a
  separate, destructive decision.
