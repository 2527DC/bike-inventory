# Code review, 2 Sep 2026 — findings and what was fixed

The night before go-live. Three parallel audits: API authorisation across 242 route files,
a bug hunt over the notification system written the same evening, and a full schema sweep of
98 models. Every finding below was verified by hand against the code before being written down.

**Companion:** the fixes are in the commit that carries this file. Anything marked *deferred*
has no fix in that commit and is listed in §5 with what it costs to leave.

---

## 0. Verdict

The architecture is sound. 366 of 376 API handlers carry an in-handler guard, permissions are
data rather than code with **zero** role-name comparisons in the API layer, there are **zero
dead tables** in 98 models, and `console.*` does not appear anywhere in `src/`. That is an
unusually disciplined result for a codebase this size with no linting to enforce any of it.

Seven things were wrong badly enough to fix before production; only two came from the work done
that evening, and one was spotted by the owner rather than by any audit. They are all fixed. The two large debts that remain — money
stored as floating point, and 52 unindexed foreign keys — are both pre-existing, both known
since the 21 Aug audit, and both too large to do safely the night before go-live.

---

## 1. Fixed — authorisation and correctness

### 1.1 A bank match could push a bill past fully paid · `bank-statements/[id]/review/route.ts`

**The worst finding, because it silently produces wrong money.** The `confirm_payment` branch
created a `VendorPayment` and then incremented `VendorBill.paidAmount` with:

- **no balance check.** The sibling path at `api/payments/route.ts:65` has always refused an
  allocation larger than the bill's remaining balance. This one did not, so confirming a bank
  match against the wrong bill drove `paidAmount` above `amount`. The app already documents what
  that state means, at `api/customers/[id]/route.ts:52`: *"neither can be trusted."*
- **no transaction.** Three separate `prisma.` statements. A failure between the payment insert
  and the bill update left a payment row that no bill balance reflects.

**Fixed:** the whole branch is now one `prisma.$transaction`, with the same
`remaining + 0.01` guard the payments route uses, and an error naming the bill and its remaining
balance. The status comparison became `newPaid >= bill.amount - 0.01` so a bill settled exactly
reaches `PAID` instead of sticking on `PARTIALLY_PAID`. A `log.info` records the confirmation.

The epsilon is deliberate and is a symptom: see §5.1.

### 1.2 Customer review links never worked · `src/middleware.ts`

`CLAUDE.md` lists `/review/[token]`, `/api/services/reviews` and `/api/services/earn-sync` under
*"Routes that must stay public."* **None of the three was in the middleware matcher.** Only the
unrelated sibling `api/earn-sync` was excluded.

So every customer who tapped the review link sent from `JobCard` was redirected to `/login`.
Worse, `src/app/review/[token]/page.tsx:30` uses the banned `fetch().then(res => res.json())`, so
the login page came back as HTML with status 200 and the screen reported "Something went wrong" —
the exact failure mode `src/lib/api-client.ts` exists to prevent, hiding the real cause.

**Fixed:** `review`, `api/services/reviews` and `api/services/earn-sync` added to the matcher's
negative lookahead, each listed in full rather than as an `api/services` prefix — a prefix would
make every future workshop route public, which is the reasoning the file already gives for the
analytics paths.

*Still owed (§5.4): the page should use `apiTry`, and `services/earn-sync` takes its shared key
from a query string, which lands in every proxy log.*

### 1.3 Four guards asked for the wrong action

| Route | Was | Now | Why it mattered |
|---|---|---|---|
| `sync/clear/route.ts` (both handlers) | `zoho.fetch` | `zoho.approve` | It flips every `PENDING_REVIEW` / `PARTIAL` pull to `APPROVED` — the same decision `zoho/pull-review/approve` makes and gates on `approve`. On `fetch` alone, whoever presses Fetch could mark every pending bill batch reviewed without anyone reading it, and it can never be re-reviewed. |
| `stock-reset/route.ts` | `stock_audit.create` | `stock_audit.approve` | Zeroes `currentStock` and `reservedStock` on **every active product**. `create` is what a junior counter needs to start a count. The `confirm: "RESET_STOCK"` string is a typo guard, not a permission check. |
| `products/stale/route.ts` | `stock.create` | `stock.delete` | Bulk-sets products `INACTIVE`, removing them from every picker. A soft delete is still a delete. |
| `vendors/stale/route.ts` | `vendors.create` | `vendors.delete` | Same, for vendors. |

### 1.4 Two unguarded reads in the workshop module

- **`GET /api/services/prices`** had **no guard at all** — the only handler in `api/services/*`
  without one. Its own POST and DELETE were correctly gated on `service_prices.create`/`.delete`.
  Any signed-in user — a stock clerk, a mechanic — could read the full labour and parts price
  list. **Fixed:** `serviceGuard("service_prices", "view")`.
- **`GET /api/services/upload`** had no guard while the POST above it required
  `service_jobs.edit` — guard-the-write, forget-the-read. Any signed-in user could enumerate job
  ids and pull a job's photo index. The images themselves were safe
  (`api/services/upload/photo` checks `service_jobs.view`); the existence and count were not.
  **Fixed:** `serviceGuard("service_jobs", "view")`.

### 1.5 A signed-in user could open `/login` and sign in as someone else · `src/app/login/`

**Reported by the owner, not by the audits.** `/login` is excluded from the middleware matcher
so that someone with no session can reach it — correct, and it must stay. But that also means
`withAuth` never runs there, and the page was a **client component that never asked whether
anyone was already signed in**. So an authenticated user could open `/login`, see the form, and
sign in again as a different person.

On a shared counter phone that is not cosmetic. The session swaps under the previous user
without them ever signing out, and the `push_devices` row registered to them stays behind
(§5.5) — so notifications for the previous user keep arriving on a device now in someone else's
hands.

**Fixed** by splitting the file:

- `src/app/login/page.tsx` is now a **server component**. It calls `getCurrentUser()` and
  redirects if a session exists. Checking here rather than in middleware keeps the matcher
  exclusion honest — the page stays reachable without a session, and only the redirect is
  conditional.
- `src/app/login/login-form.tsx` holds the unchanged client form.

Three details that are load-bearing:

- **`getCurrentUser()`, not `getServerSession()`.** It re-reads the row, so a **deactivated**
  account holding a still-valid cookie is treated as signed out and stays on the login page.
  Redirecting it to `/` instead would bounce it into a dashboard it cannot use.
- **The `callbackUrl` is validated before being used as a redirect target.** It arrives as a
  query parameter from middleware, so an absolute URL there would be an open redirect — a
  `/login?callbackUrl=https://…` link would send a signed-in click off-site. Only same-origin
  paths are honoured; anything else falls back to `/`.
- **`router.replace`, not `router.push`,** after a successful sign-in, so the login page does not
  sit in the history stack and Back cannot return to it. The form also gained a `catch` around
  `signIn` — a network failure previously left the button spinning forever.

### 1.6 The access code had no length floor · `src/lib/validations.ts`

`accessCode: z.string().min(1)` accepted a **one-character** credential. This is the only
credential the app has — no username, no second factor — and `/api/auth/*` is excluded from
middleware, so the login endpoint is reachable from the open internet.

**Fixed:** `min(8)`. **This is a floor, not a solution** — see §5.2, which is the most serious
item left open.

---

## 2. Fixed — bugs in the notification system

Written the same evening by five parallel agents and never run in a browser. The §F.0 transaction
rule held at all seven call sites, `notify()` genuinely never throws into its caller, the
secret-masking is correct, and the permission model is right. These are what was wrong.

### 2.1 `fanOut` silently dropped recipients · `src/lib/notify/index.ts`

Only the **first** target's probe was inspected; the results of every later batch were discarded.
Because `handle()` records nothing on the `NotConfiguredError` branch, and both senders re-read
`NotificationConfig` on **every** call, an admin flipping a master switch off mid-fan-out made
every remaining recipient vanish — no `SENT`, no `FAILED`, no `SKIPPED` row, and the returned
counts under-reported.

**Fixed:** an `unconfigured` flag is set by any send that reports the channel is gone; the batch
loop checks it, writes one channel-level `SKIPPED` row naming how many were not attempted, and
stops.

### 2.2 The outbox was written once, at the very end · `src/lib/notify/index.ts`

All rows accumulated in memory and were flushed in a single `createMany` after the entire
fan-out. With email on and ~40 staff — a fresh SMTP handshake per recipient at 5 concurrent —
that runs for tens of seconds inside `after()`. An invocation killed partway lost **every** row,
including the `SENT` ones: mail had gone out and the table said nothing happened. That is exactly
the question the table exists to answer.

**Fixed:** `flushOutbox()` writes and clears after each concurrency batch. The final call catches
the channel-level rows.

### 2.3 The service worker threw on a `null` push payload · `public/sw.js`

`event.data.json()` on the body `null` **parses successfully** to `null`, so the `try/catch`
never fired; `payload.notification` then threw a `TypeError` that escaped the listener. Nothing
was shown and nothing was logged — reachable from the DevTools Push box, which is the very manual
test path the handler's comment says it supports.

**Fixed:** `event.data.json() ?? {}`, plus a non-object guard.

### 2.4 `zoho.pull_finished` could reach nobody · `zoho/trigger-pull/route.ts`

It excluded the actor and returned early when the remaining list was empty — writing no outbox
row either. `zoho.fetch` is a narrow grant, quite possibly ADMIN alone, so the one event that
defaults **email on** because it reports something already broken could fire for nobody, ever,
with no trace that it tried.

**Fixed:** the outcome event falls back to the unfiltered holder list when excluding the actor
would leave it empty. `zoho.pull_started` keeps the exclusion — that one is pure courtesy.

### 2.5 Seven sending routes did not declare the Node runtime

Only `api/notifications/test` had `export const runtime = "nodejs"`. The plan requires it on every
route that sends: the SMTP transport is a raw TCP socket on 587 and the FCM JWT is signed with
node `crypto`, neither of which exists on the edge runtime, and the failure there does not say
what it is. Nothing was broken — Node is the App Router default — but the declaration is what
stops a later change from breaking sends silently.

**Fixed** on all seven: `inventory/outwards`, `deliveries/batch`, `deliveries/[id]`,
`services/jobs/update-status`, `services/jobs/bulk-status`, `inbound/[id]/status`,
`zoho/trigger-pull`.

---

## 3. Verified correct — do not "fix" these

Recorded so the next reviewer does not spend the time twice.

- **§F.0 holds at all seven call sites.** Data is collected inside the transaction; every
  `notify()` sits after `await prisma.$transaction(...)` returned, wrapped in `after()`. A
  rollback cannot send, because the `await` rejects before the `after()` line is reached.
  `inbound/[id]/status` correctly places its `after()` *before* the Zoho block's early `return`.
- **`notify()` never throws into its caller.** Every read, the fan-out and the dead-token delete
  are inside one `try`; the outbox write is guarded separately.
- **Dead-token deletion is safe.** Only 404/`UNREGISTERED` and 400/`INVALID_ARGUMENT` mentioning
  the token delete a row. `SENDER_ID_MISMATCH` (403) correctly does not.
- **The masked-secret write path is right.** An absent or empty secret leaves the stored value
  alone; a real credential change resets `*Connected` to false.
- **No horizontal escalation anywhere in the API.** Three places get it actively right:
  `lib/analytics/device-auth.ts:94` takes `storeId` from the device key and never the payload;
  `notifications/devices` scopes ownership inside the `WHERE` so another user's id returns the
  same 404 as a nonexistent one; `activity/route.ts:20` honours `?userId=` only for a caller
  holding `team.view`.
- **`usersWithPermission()` cannot return someone `userCan()` would refuse** — same active
  user / active role / active module filters as `getAccess`.
- **`NotificationOutbox.userId` is deliberately not a relation.** A delivery log must outlive the
  user it names. Correct. (One gap remains — §5.6.)
- **These three table-merge questions were tested and answered "leave them":**
  `SyncLog`/`ZohoPullLog`/`ZohoPullPreview`, `NotificationEventSetting`/`NotificationPreference`
  (a merged table cannot express "exactly one global row per event", because Postgres treats
  NULLs as distinct in a unique index), and the three singleton config tables.

---

## 4. What is good

Naming it, because it is what the next change must not break.

- **`src/lib/rbac.ts` is genuinely data-driven.** One query resolves the whole access set.
  `cache()` is request-scoped with a comment explaining that a cross-request cache would keep a
  revoked permission alive. `getAccess` fails closed on an inactive user, an inactive role **and**
  an inactive module.
- **`requireFeature` has no escape hatch** — verified across all 376 handlers. No third argument,
  no fallback roles, no admin short-circuit. ADMIN passes because the seed granted it every
  permission, not because code names it.
- **Per-field authorisation in `api/alerts/config/route.ts`** is the best guard in the repo: one
  body carries two fields belonging to two modules, so it authenticates first and checks each
  permission *as the field is accepted*.
- **`Product.currentStock` is the right way to keep a derived column** — recomputed from
  `SUM(StockLevel.quantity)` in the transaction, in one place, as an integer. `paidAmount` should
  be maintained the same way.
- **Idempotency is expressed as constraints, not application logic:** `@@unique([vendorId, billNo])`,
  `@@unique([productId, warehouseId])`, `PushDevice.token @unique`, and `CountEvent.id` supplied
  by the agent as the retry-collapsing key.
- **The August audit's three blocking items are all fixed:** the `StockLocation` enum is now real
  `Store`/`Warehouse` tables, the three Zoho config tables are one `IntegrationConfig`, and
  migration history exists.
- **Zero `console.*` in `src/`. No cron, no `setInterval`, no client polling loop.**

---

## 5. Deferred — with what it costs to leave

Nothing in this section is fixed in the accompanying commit.

### 5.1 Money is stored as floating point — 71 columns · **the largest correctness debt**

**Zero `Decimal` columns exist.** 81 `Float` columns: 71 money, 6 percentage/tax rate, 3
confidence scores (correctly `Float`), 1 duration.

The damage is visible in the code already:

```ts
// api/payments/route.ts:65 — the epsilon is the fingerprint of someone having hit this
if (alloc.amount > remaining + 0.01) {
// :107 — an accumulating float compared with >=
const newStatus = newPaidAmount >= bill.amount ? "PAID" : "PARTIALLY_PAID";
```

A bill paid in three instalments summing exactly to `amount` can land on `PARTIALLY_PAID` and
stay there. The same shape appears in `customer-payments/route.ts:80` and in the bank-statement
path fixed in §1.1. `DailySettlement` alone has 12 float money columns, and settlement is exactly
where this surfaces — as a phantom cash variance nobody can explain.

**Cost to fix:** ~2 days. One migration, plus roughly **1,450 source occurrences across ~150
files** — every `a + b` becomes `a.plus(b)`, every `>=` becomes `.greaterThanOrEqualTo()`, and
every JSON boundary needs `Number(...)`. `tsc` finds all of them because `Decimal` has no `+`
operator, so it is mechanical rather than detective work. **Do not change a column type without
doing the whole sweep.**

**If the full job is too much,** the highest-value subset is `PosSession` (14) +
`DailySettlement` (12) + `SettlementMatch` (3) + `BankTransaction` (2) = 31 of 71 columns, and it
covers every place a variance is computed.

### 5.2 The login endpoint has no rate limit · **the most serious item still open**

There is no attempt counter, no lockout and no delay anywhere in `src/` — verified by grep. The
access code is the only credential, `/api/auth/*` is excluded from middleware, and a success
returns a **30-day** bearer token plus the caller's whole permission map. §1.6 raised the minimum
length to 8, which shrinks the keyspace problem but does not remove it.

Also: `prisma/seed-rbac.ts:260` defaults the admin access code to **`ADMIN123`** unless
`ADMIN_ACCESS_CODE` is set. **Set that variable before seeding production, or a known string is a
full-admin login.**

**Fix:** a per-IP and per-code attempt counter in front of both `api/auth/mobile-login` and the
NextAuth `authorize()` callback. Half a day.

### 5.3 52 of 145 foreign keys have no index (36%)

Unchanged since 21 Aug. Prisma does not create them. The delete-rule spread is 59 `RESTRICT`,
51 `SET NULL`, 35 `CASCADE`, so **110 of 145 relationships trigger a child-table scan** when a
parent row is touched, and 52 of those scans are unindexed.

Worst first: `StockCountItem.stockCountId` and `.productId` (the table has **no** indexes at all),
the four `brand_ledger_entries` columns, `Review.customerId`, `VendorBill.purchaseOrderId`,
`Category.parentId`. About 26 more are `createdById` / `approvedById` / `authorId` audit columns —
deactivating one user scans all of them. Six belong to `Bin`, a feature switched off at
`src/lib/inventory-config.ts:10`.

**Cost:** ~1 hour, one additive migration. It never gets cheaper — after go-live each index is a
lock on a populated table.

### 5.4 Two smaller items from the review-link fix

- `src/app/review/[token]/page.tsx:30` uses the banned `fetch().then(res => res.json())`. With
  §1.2 fixed the page works, but any future failure will still surface as `Unexpected token '<'`.
  Move it to `apiTry`.
- `api/services/earn-sync` reads its shared key from a **query string**, which lands in every
  proxy and access log. It should be a header.

### 5.5 Sign-out does not remove the push device

`signOut()` is called with nothing else in all three sign-out handlers. The `push_devices` row
keeps the previous user's id and the browser keeps the same FCM token. On a shared counter phone:
mechanic A enables push and signs out, B signs in and never presses "Enable push on this device" —
every notification for A now renders on the phone in B's hand, showing SKUs, stock figures and
customer names, and B receives nothing of their own.

Latent today because both master switches are off. **Fix before enabling push:** an unregister
call before `signOut()` in the three handlers.

### 5.6 Six schema items worth a decision, none urgent

| Item | What it is |
|---|---|
| `NotificationOutbox` is **write-only** | Nothing reads it. Two composite indexes were chosen for queries nothing makes. Its accepted growth figure (~8 MB/year) describes the **switched-off** state; switched on at 40 staff × 20 events/day it is **~170 MB/year**, and there is no clear-down path of any kind. A read screen plus a "clear older than N days" button behind `settings.edit` fixes both — and gives the table its first reader. |
| `SerialTransactionItem` | Read by a live UI panel on the serial detail screen, deleted by the product force-delete — **and never written**. The panel renders permanently empty. Anyone building a warranty claim on "which transaction moved this frame number" will find the table, find the read, and be wrong. |
| `BrandStatement`, `BrandVendor`, `LedgerGapEvidence`, `LedgerGapNote` | All four are read and branched on; none has a write path. `BrandVendor` is the brand→vendor mapping the whole ledger module rests on, and it cannot be created. A delete guard in `ledger/gaps/[id]` protects against evidence that can never exist. |
| `StoreUpdate`, `OpsActivityLog`, `AppSetting` | Full CRUD routes, no page anywhere fetches them. Three tables and three live endpoints for a module that never shipped. |
| 95 of 145 relations have no explicit `onDelete` | Prisma's implicit default usually matches intent, but the schema now mixes relations whose cascade was reasoned about in a paragraph with relations where it was never considered, and a reader cannot tell which is which. |
| Nine status columns are free-text `String` | The schema has 38 enums; these are the exceptions. `StockCount.status` is the one that matters — it is live, it has an approval flow, and nothing stops `"Pending"` being written. |

### 5.7 230 of 301 API catch blocks never log

The dominant shape returns the error to the client and puts nothing in the server log, discarding
the stack. Systemic, not per-file: the fix is to route them through `failure(error, {...})` from
`src/lib/api-utils`, which the newer routes already do. There are also 4 bare `catch {}` and 12
comment-only catches, of which the worst swallows a **failed Zoho push** in
`api/second-hand/route.ts`.

---

## 6. Recommended order from here

| # | Action | Effort | Risk if skipped |
|---|---|---|---|
| 1 | Set `ADMIN_ACCESS_CODE` before seeding production (§5.2) | 1 min | A published default string is a full-admin login |
| 2 | Rate-limit the login endpoint (§5.2) | half a day | The only credential, open to the internet, unlimited attempts |
| 3 | Reconciliation endpoint: bills where `paidAmount != SUM(payments)` | 30 min | No way to detect that §1.1 or the `>=` comparison already happened. Read-only, no migration |
| 4 | Index the 52 unindexed FKs (§5.3) | 1 hour, one migration | Gets more expensive after go-live, never cheaper |
| 5 | Unregister the push device on sign-out (§5.5) | 1 hour | Must be done before push is switched on |
| 6 | Outbox read screen + clear-down button (§5.6) | 2 hours | ~170 MB/year of data nothing can read |
| 7 | `Decimal(12,2)` for the 71 money columns (§5.1) | ~2 days | Wrong money, phantom settlement variances, bills that never reach PAID |

**Items 1 and 3 are worth doing tonight.** Neither is a migration, and between them they take
about half an hour.

---

## 7. How this review was run

Three parallel read-only audits, each given the project's own rules (`CLAUDE.md`, the
`db-designer` skill's audit method and business context) rather than generic best practice, so
that scale-inappropriate advice — sharding, caching layers, denormalising for performance — was
ruled out up front for a database of ~500 products and ~2,000 transactions a month.

Every finding presented as a blocker was then re-verified by hand against the source before being
acted on. Two findings from the agents were **not** carried into §1 or §2 because checking them
showed they were already correct or already documented as deliberate. Counts quoted in §5.1 and
§5.3 were taken from the live database, not estimated.

`npx tsc --noEmit` exits 0 after every change in this commit.
