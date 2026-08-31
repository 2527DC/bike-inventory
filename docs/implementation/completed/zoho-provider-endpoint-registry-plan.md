# One provider layer, one endpoint registry

Status: completed — 31 Aug 2026, Parts A, B, C and D. Commits `67be82d` (registry),
`7c16903` (one client per request), `631db1d` (escape hatches closed, `apiCall` protected),
`0cff195` (36 sites through the factory). Both acceptance greps in §7 now return nothing.
**Part E was NOT built** — the batch-size guidance on the approve screen is still only §10 on
paper. **§7's manual checks are unrun**: no connect/disconnect in Settings, and no real bill,
invoice or item import since the change.
Branch: **`refactor/zoho-endpoint-registry`** — cut from `feat/categories-module`, not `main`,
so it carries the auth, S3, accounts and categories work that has not merged yet.
Prepared 30 Aug 2026. Every count below was measured against the tree, not estimated.

---

## 1. The question this answers

> "Is there a single provider file that acts as the client, with a proper listing of the
> endpoints being used, instead of calling them directly all over the place?"

**Half of it already exists.** `src/lib/integrations/` is a real, well-built client layer.
What does not exist is the *registry* — nowhere in the codebase can you read off which Zoho
endpoints this application touches, or who touches them.

---

## 2. What is already right — do not rebuild this

`src/lib/integrations/` was consolidated once already (`zoho.ts` 510 + `zakya.ts` 369 +
`zoho-inventory.ts` 331 lines → 717). It is good code and this plan keeps all of it.

| File | Role |
|---|---|
| `base.ts` | `IntegrationClient` — OAuth, refresh, 401-retry-once, 429 backoff, `apiCall`, shared reads |
| `books.ts` | `ZOHO_BOOKS` → `https://www.zohoapis.in/books/v3` |
| `inventory.ts` | `ZOHO_INVENTORY` → `https://www.zohoapis.in/inventory/v1` |
| `zakya.ts` | `ZAKYA_POS` → `https://api.zakya.in/inventory/v1` |
| `index.ts` | `getClient` / `getReadyClient` / `getBooks` / `getInventory` / `getZakya` |

All three providers are Zoho-family and share one auth host,
`https://accounts.zoho.in/oauth/v2/token`. **There is no non-Zoho provider.** No browser code
calls a Zoho host directly — every client `fetch` goes to an internal `/api/...` route. That
boundary is intact and this plan does not touch it.

---

## 3. The three gaps, measured

### 3.1 The factory is effectively dead code

`index.ts` documents "prefer `getReadyClient` over `getClient` + `init()`". Reality:

```
new BooksClient() / new ZakyaClient() / new InventoryClient()   36 sites, 18 files
.init() calls                                                   33
getBooks() / getInventory() / getZakya() / getReadyClient()      1 file (src/lib/services/zoho.ts)
```

Every API route hand-rolls the two-line dance the helper exists to remove:

```ts
const zoho = new BooksClient();
const ready = await zoho.init();
if (!ready) return errorResponse("Zoho not connected", 400);
```

Each of those is also an independent `IntegrationConfig` read.

### 3.2 Two of those inits are INSIDE a per-record loop

`api/zoho/pull-review/approve/route.ts:160` and `:432` construct a `BooksClient` and call
`init()` **once per preview record** in the bill and invoice branches. `init()` is a database
read of `IntegrationConfig` and, when the cached access token is within five minutes of
expiry, an HTTP round trip to `accounts.zoho.in` as well. On a 50-bill approve that is 50
config reads. This is a live contributor to the `FUNCTION_INVOCATION_TIMEOUT` on that route
(`maxDuration = 60`).

The item branch already does this correctly — it hoists the client to `zohoForItems` at
`:224`. The bill and invoice branches simply were not given the same treatment.

### 3.3 Four calls bypass the client entirely

Raw `apiCall` from outside `src/lib/integrations/`, so the endpoint appears in no client and
in no listing:

| Site | Call |
|---|---|
| `api/stock/price-check/[productId]/route.ts:78` | `PUT /items/{id}` — **the only write with no client method** |
| `lib/services/zoho.ts:51` | `GET /invoices?phone=…` |
| `lib/services/zoho.ts:67` | `GET /invoices?invoice_number=…` |
| `lib/services/zoho.ts:94` | `GET /invoices?search_text=…` |

### 3.4 There is no endpoint listing anywhere

Confirmed by grep across `docs/`. The table in §4 is the first one that has ever existed.

---

## 4. The endpoint registry — 16 endpoints + 2 OAuth grants

This is the artefact being asked for. It becomes `src/lib/integrations/endpoints.ts`.

**Shared (`base.ts`) — available to all three providers**

| Method | Endpoint | Client method |
|---|---|---|
| GET | `/bills?page&per_page&date_start&date_end&search_text` | `listBills` / `listAllBills` |
| GET | `/bills/{bill_id}` | `getBill` |
| GET | `/invoices?…` | `listInvoices` / `listAllInvoices` |
| GET | `/invoices/{invoice_id}` | `getInvoice` |
| GET | `/customerpayments?…` | `listCustomerPayments` / `listAllCustomerPayments` |
| GET | `/items?page&per_page&status&last_modified_time` | `listItems` / `listAllItems` |

**Zoho Books only (`books.ts`)**

| Method | Endpoint | Client method |
|---|---|---|
| POST | `/items` (JSONString-wrapped) | `createItem` |
| GET | `/items/{item_id}` | `getItem` |
| POST | `/contacts` | `createContact` |
| GET | `/contacts?search_text&contact_type` | `searchContacts` |
| GET | `/contacts?contact_type=vendor&last_modified_time` | `listContacts` / `listAllContacts` |
| POST | `/invoices` | `createInvoice` |
| POST | `/bills` | `createBill` |
| GET | `/../organizations` | `getOrganizations` |

**Zoho Inventory only** — `POST /items` (raw, not JSONString); `getBillDetails` batches
`getBill` five at a time (Zoho's concurrent-request limit).

**Zakya** — adds nothing of its own; it is `base.ts` plus a URL.

**OAuth (`base.ts`)** — `POST /oauth/v2/token` with `grant_type=refresh_token`
(`refreshAccessToken`) and `grant_type=authorization_code` (`exchangeGrantToken`).

Books wraps write payloads in `JSONString`; Zoho Inventory posts the object directly. That is
a real difference between the two Zoho products, not an inconsistency here — the registry
must record it rather than "fix" it.

---

## 5. Scope

### Part A — the registry (new file, no behaviour change)

`src/lib/integrations/endpoints.ts` holds one entry per endpoint: key, method, path template,
which providers support it, the client method that owns it, and a one-line purpose. `apiCall`
takes an optional endpoint key and logs it, so `log.debug` lines carry a stable name instead
of an interpolated URL. Nothing else changes; this part is additive and safe to ship alone.

### Part B — route the 36 sites through the factory

Replace the hand-rolled dance with `getBooks()` / `getInventory()` / `getZakya()`. Mechanical
and one file at a time. **The `if (!ready) return errorResponse(...)` message must be
preserved verbatim per route** — several are user-visible and differ deliberately.

### Part C — hoist the two in-loop inits

`approve/route.ts:160` and `:432`: construct once before the loop, exactly as the item branch
already does at `:224`. Directly reduces the 504 on that route.

### Part D — close the four escape hatches

- `PUT /items/{id}` becomes `BooksClient.updateItem()` — it is a write and belongs in the client.
- The three `lib/services/zoho.ts` invoice searches become `BooksClient.searchInvoices(params)`.
  The invoice-number *format guessing* stays in `services/zoho.ts`; it is workshop business
  logic, not transport.

After Part D, `apiCall` has no callers outside `src/lib/integrations/` and can be made
`protected`. That is the enforcement mechanism — the compiler, not a review convention.

### Part E — tell the person at the screen what a batch costs

Added 30 Aug 2026. The approve screen currently offers no guidance on batch size, so the
only way to discover the ceiling is to exceed it and get a 504 — after the function has
already half-written the batch. §10 works out where that ceiling actually is; this part puts
the number in front of the user.

- A line on the pull-review screen stating the per-request budget and the safe batch size,
  derived from the constants in §10 rather than hardcoded prose.
- When the selection exceeds the safe size, a warning next to the Approve button naming the
  limit and what will happen (the approved-so-far records stay imported; the rest stay
  `PENDING` and can be approved again — the route is already resumable, which §10.4 explains).
- The response already carries `remainingPending`; surface it after a partial approve
  instead of leaving the screen silent about what is left.

Copy and exact placement are open — the numbers are not.

---

## 6. Files

| File | Change |
|---|---|
| `src/lib/integrations/endpoints.ts` | **new** — the registry |
| `src/lib/integrations/base.ts` | optional endpoint key on `apiCall`; `apiCall` → `protected` after Part D |
| `src/lib/integrations/books.ts` | add `updateItem`, `searchInvoices` |
| `src/lib/integrations/index.ts` | unchanged — it was already right |
| `src/lib/services/zoho.ts` | three `apiCall`s → `searchInvoices` |
| `src/app/api/stock/price-check/[productId]/route.ts` | `apiCall("PUT", …)` → `updateItem` |
| 17 further API route files | `new XClient() + init()` → `getX()` |
| `src/app/api/zoho/pull-review/approve/route.ts` | hoist two inits out of the loop |
| `docs/integrations-endpoints.md` | generated from the registry |

---

## 7. Verification

- `npm run build` passes.
- `grep -rn "\.apiCall" src/ | grep -v src/lib/integrations/` returns nothing.
- `grep -rn "new BooksClient()\|new ZakyaClient()\|new InventoryClient()" src/` returns nothing.
- Settings → Integrations still connects, disconnects and shows status for all three.
- One bill import, one invoice import and one item import each still succeed.

---

## 8. Non-goals

- **No change to `IntegrationClient`'s auth, retry or pagination behaviour.** It works.
- **No new provider abstraction.** All three are Zoho-family sharing one OAuth host; an
  interface written for a hypothetical non-Zoho provider would be guesswork.
- **No change to the browser boundary.** Pages call `/api/...`; that stays.
- The import *data-quality* problems (brand "Imported", category "Uncategorized", `size` and
  location never written) are a **separate** plan. This one is transport only.
- The N+1 database writes in the approve loop are the *other* half of the 504 and are also
  out of scope here — Part C removes only the Zoho-client half.

---

## 10. Timeouts and capacity — how much can one approve actually import?

Added 30 Aug 2026, from a live approve that returned
`{ items: 1, remainingPending: 2 }` and a question about where the ceiling is. Counts below
are read off the code; latencies are marked as measured or estimated.

### 10.1 The three limits, and which one binds

| Limit | Value | Where it comes from |
|---|---|---|
| **This application's function budget** | **60 s** | `export const maxDuration = 60` — `api/zoho/pull-review/approve/route.ts:2`, `api/zoho/trigger-pull/route.ts:5`, and six other routes. `vercel.json` sets no `functions` block, so this export is the whole story |
| **The platform ceiling** | **300 s** on Hobby, **300 s** default / **800 s** maximum on Pro | Vercel fluid-compute duration limits, docs as of 24 Aug 2026 |
| **Zoho's ceiling** | **100 requests/minute per organization**; 5 concurrent calls on Free, 10 (soft) on paid; 1,000–10,000 requests/day by plan; **no documented request timeout** | Zoho Books API v3 documentation |

**The 60 s is self-imposed and is the one currently binding.** The platform would allow 300 s
today without a plan change. Raising it is not the fix — a route that needs five minutes is a
route doing per-record round trips — but it is worth knowing that the cliff users hit is our
constant, not Vercel's.

**Zoho's limit binds differently.** It is per *minute*, not per request, so it survives any
`maxDuration` change: an import that makes 11 Zoho calls per bill can process at most ~9
bills a minute before Zoho answers 429, no matter how long the function is allowed to run.

### 10.2 What one record costs, counted from the code

The measured constant is **~40 ms per database round trip** — Mumbai (`vercel.json`
`"regions": ["bom1"]`) to the database in `ap-southeast-1`, recorded in the comment on
`buildItemPreviews` in `trigger-pull/route.ts`. Zoho call latency is **not** measured
anywhere in this repo; 300–500 ms is assumed below and is the first thing Part A's logging
should replace with a real number.

**An `item` preview** — `approve/route.ts:111-154`:

| Step | Round trips |
|---|---|
| `product.findFirst` (SKU dedup) | 1 |
| `brand.findFirst` (+ `create` if new) | 1–2 |
| `resolveCategory` — `findFirst` (+ `create`); cached per category name per request | 0–2 |
| `product.create` | 1 |
| `zohoPullPreview.update` | 1 |
| **Zoho HTTP calls** | **0** |

≈ **5 round trips ≈ 200 ms per item.**

**A `bill` preview** — `approve/route.ts:155-430`, the expensive one:

| Step | Round trips | Zoho calls |
|---|---|---|
| `BooksClient` + `init()` for `getBill` (**per record** — Part C) | 1 | 0–1 (token refresh) |
| `getBill` | 0 | 1 |
| vendor lookup / create, shipment dedup, `vendorBill` lookup | 3–4 | 0 |
| second `BooksClient` + `init()` for `zohoForItems` (**per record** — Part C) | 1 | 0–1 |
| brand + default category resolve | 2–4 | 0 |
| **per line item, existing product** | 1–3 | 0 |
| **per line item, new product** | 5–8 | **1** (`getItem`) |
| `vendorBill.create`, inbound shipment + items, `zohoPullPreview.update` | 3–5 | 0 |

A 10-line bill whose products all exist: ≈ 40 round trips + 1 Zoho call ≈ **2 s**.
A 10-line bill where every product is new: ≈ 80 round trips + 11 Zoho calls ≈ **8 s**.

### 10.3 The safe batch size

Budget 55 s of the 60 s (leaving the fixed ~6 queries of auth, pull-log and preview loading,
plus response time):

| Entity | Per record | Fits in 60 s today | Would fit at 300 s | Blocked first by |
|---|---|---|---|---|
| `item` | ~0.2 s | **~250** | ~1,400 | the function budget |
| `contact` | ~0.15 s | ~350 | ~1,900 | the function budget |
| `bill`, products exist | ~2 s | **~25** | ~140 | the function budget |
| `bill`, all products new | ~8 s | **~6** | ~9 | **Zoho's 100/min**, not the timeout |

**Recommended batch sizes to put in the UI: 100 items, 20 bills.** Both sit at roughly half
the estimated ceiling, which is the right margin while the Zoho latency figure is still an
assumption rather than a measurement.

### 10.4 What a timeout actually costs today

Not data loss, which is worth stating plainly on the screen. The loop updates each
`zohoPullPreview` to `APPROVED` as it finishes that record, so a function killed at 60 s
leaves every completed record imported and every unreached one `PENDING`. Pressing Approve
again resumes: the route re-reads `status: "PENDING"` and the pull log's `PARTIAL` status is
explicitly accepted at `route.ts:31`.

Two real defects remain behind that, and neither is in this plan's scope:

1. **The client sees no result.** A 504 returns no body, so the screen cannot report what
   was imported before the kill — the user has to reload to find out.
2. **A record is not atomic.** A bill writes `Vendor`, `Product`, `VendorBill`,
   `InboundShipment` and its items in separate statements with no transaction, so a kill
   *mid-record* leaves that one record half-written. The `billNo` and `sku` dedup checks
   mean a retry mostly recovers, but "mostly" is doing real work in that sentence.
