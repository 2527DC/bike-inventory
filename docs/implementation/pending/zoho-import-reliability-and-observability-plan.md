# Zoho import — stop the 504, and make every failure visible

Status: pending — **five open questions in §8 block the observability half (Part C).** Parts A, B and D are fully specified and can start immediately.
Suggested branch: `fix/zoho-import-reliability` off `main`.
Prepared 30 Aug 2026 from a live production incident: `POST /api/zoho/pull-review/approve` returned 504 after 60.0s, and the UI reported it as `Unexpected token 'A', "An error o"... is not valid JSON`.

---

## 1. What actually happened

One timeout, three separate defects, and only the first is about speed.

| # | Defect | Symptom the owner saw |
|---|---|---|
| 1 | `pull-review/approve` does ~5 database round trips **per record** | 504 at 150 records |
| 2 | Six screens call `res.json()` on a response that may not be JSON | `Unexpected token 'A'` instead of "the server timed out" |
| 3 | `/deliveries` swallows two failure paths and shows its result count for ~200 ms | *"it doesn't show how many it fetched and doesn't ask to import"* |

**The `'A'` is the first character of Vercel's timeout page** — *"An error occurred with this application"*. The screen parsed that text as JSON. That is the banned pattern CLAUDE.md names, and `apiFetch` exists to prevent exactly it.

### Measured, not estimated

```
products      21 → 171          150 imported before the timeout
previews      150 APPROVED, 761 PENDING
duration      60.0s             hit maxDuration exactly
outgoing      none              every second was OUR database, not Zoho
region        bom1 (Mumbai)  →  DB ap-southeast-1 (Singapore)  ≈ 40 ms/trip
```

150 records × ~10 sequential trips × 40 ms ≈ 60 s. The arithmetic closes.

### Why `fetch` works and `import` does not

They are different routes, and only one was fixed.

| | `trigger-pull` (Fetch) | `pull-review/approve` (Import) |
|---|---|---|
| `createMany` | yes — `buildItemPreviews()` | **0** |
| Round trips | fixed, ~4 total | **~5 per record** |
| Fixed in | `fix/zoho-pull-batching`, merged | never touched |

`trigger-pull` only parks JSON in a staging table. `approve` does real relational work per row — resolve brand, resolve category, dedupe SKU, create product. It was always the heavier of the two, and it is the one that never got batched.

---

## 2. Part A — S3 uploads fail with 501 (unrelated, smallest, do it first)

```xml
<Code>NotImplemented</Code>
<Header>Transfer-Encoding</Header>
```

**Nothing is wrong with the bucket, keys, region or IAM.** The request was rejected on its *shape*, before authorisation mattered.

S3 requires `Content-Length` on a `PUT` and refuses `Transfer-Encoding: chunked`. `aws4fetch` re-wraps the body in a `Request` to compute the SigV4 payload hash, and the known byte-length does not survive that rebuild — so undici falls back to chunked.

`src/lib/storage/s3.ts`, both `put()` (line 78) and the bucket-policy `PUT` (line 134):

```ts
const bytes =
  body instanceof Blob ? new Uint8Array(await body.arrayBuffer())
  : body instanceof ArrayBuffer ? new Uint8Array(body)
  : new Uint8Array(body);

const res = await this.client.fetch(this.objectUrl(key), {
  method: "PUT",
  headers: {
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    "Content-Length": String(bytes.byteLength),
  },
  body: bytes,
});
```

**Verification is free:** `src/lib/storage/self-test.ts` already writes, reads back and deletes a test object. It fails in about a second, so this is proved or disproved immediately. No guessing.

---

## 3. Part B — batch `pull-review/approve`

Same transformation already applied to `trigger-pull`; the shape is known.

### What each record costs today

```ts
approve:90   for (const preview of previews) {      // 303 times
approve:115    product.findFirst({ sku })           // is it already here
approve:122    brand.findFirst({ name, insensitive })
approve:124    brand.create                         // if new
approve:137    product.create
approve:470    zohoPullPreview.update               // mark APPROVED
```

48 `await prisma.` calls in the file, most inside that loop. `createMany`: zero.

### The batched shape

1. Collect every `sku`, `zohoItemId`, brand name and category name across the batch **first**.
2. Three bulk reads → three `Map`s. Chunk any `in` list at 1,000.
3. `createMany` the brands that are genuinely new, then re-read to get their ids.
4. `createMany` the products.
5. One `updateMany` to mark the batch `APPROVED`.

**~5N round trips → ~8 total.** 303 records goes from ~60 s to under 2 s.

### Four things that must survive the rewrite

- **Empty SKUs must not reach an `in` clause.** Many Zoho items have `sku: ""`; `{ sku: { in: ["", …] } }` matches every local product with a blank SKU and would mark new items as existing.
- **Brand matching is case-INSENSITIVE** (`mode: "insensitive"` today). Prisma does not support that reliably on `in`, so read the brand set once and compare on a lowercased key in memory — the same fix used for vendors in the `contacts` batching.
- **Dedupe within the batch.** Two previews can name the same new brand; `createMany` would insert it twice and `Brand.name` is `@unique`.
- **Partial success must stay partial.** See §4.

### The loop is NOT transactional, and that is load-bearing

Every write uses `prisma.` directly, not `tx.`. So the 504 left the import **half-applied** — and that is what saved it: 150 previews were marked `APPROVED` as they landed, the filter is `status: "PENDING"`, so clicking Import again resumes at 151 with no duplicates.

**Do not wrap the whole batch in one transaction.** A single `$transaction` over 761 records would roll back everything on the last failure and make the operation all-or-nothing at a size that cannot complete. Batch in **chunks of ~100**, each chunk atomic, each chunk marking its own previews. Resumability is a feature here, not an accident.

---

## 4. Part D — `/deliveries` fetch: it DOES have review, and three bugs hide it

The owner reported that `/deliveries` does not show a count and does not ask before importing. **It has both.** `zoho-import-flow.tsx` runs init → invoices → finalize → load preview → checkbox list → `handleImportSelected`, exactly like `/stock`.

Three defects make it look otherwise:

| Line | Defect |
|---|---|
| `:232` | `if (previewRes.success)` with **no else**. On failure nothing is set — no error, no step change. The UI sits on "fetching" **forever**. |
| `:218` | `.catch(() => {})` on the finalize call. A bare swallow, banned by CLAUDE.md. |
| `:213` | `Found N invoice(s)` goes to `setFetchProgress`, which the `finally` clears. **The count flashes for ~200 ms and vanishes.** |

Plus: when `invoices.length === 0` it jumps straight back to `idle` with a message, so the review list never appears — which reads as "it imported without asking".

### The real reason old fetches seem to vanish

`GET /api/zoho/pull-review?pullId=` filters by **one** `pullId` (`route.ts:29`). Every fetch mints a new one. So the **761 pending previews across 11 earlier pulls are invisible to every screen in the app** — they can never be reviewed, imported or rejected through the UI.

That is a data-retention problem as much as a UX one: the staging table grows ~180 rows/day and nothing prunes it. See §8 Q5.

### Fixes

- Give `/deliveries` the same persistent count `/stock` has — a rendered element, not transient progress text.
- Every `if (res.success)` gets an `else` that sets an error and returns the step to `idle`.
- Delete the bare `.catch(() => {})`; log and surface.
- Both screens: show the pull's own count *and* how many previews remain pending overall, so stranded rows are discoverable.

---

## 5. Part C — errors must be visible, and Zoho traffic must be logged

Two halves. The first is mechanical; the second needs decisions (§8).

### C1 — replace raw `fetch` (mechanical, no questions)

Six files call `pull-review/approve` with raw `fetch` + `.json()`:

```
(dashboard)/stock/page.tsx                          8 raw .json() calls
(dashboard)/bills/page.tsx                          7
(dashboard)/inbound/page.tsx                        7
(dashboard)/receivables/page.tsx                    7
(dashboard)/deliveries/_components/zoho-import-flow  4
(dashboard)/settings/integrations/pull-review        4
```

All become `apiFetch` / `apiTry`. `apiFetch` checks content-type **before** parsing and already produces the message the owner should have seen:

> *The server failed while handling this request (504). It returned a page instead of data — usually a timeout or a crash.*

Note `stock/page.tsx` already imports `apiFetch` and uses it for `trigger-pull` (lines 256, 266, 274) but **not** for the import at line 320. That inconsistency is why Fetch reported errors properly and Import did not.

### C2 — Zoho request/response logging (needs §8)

Today `trigger-pull` logs via `createLogger("zoho:trigger-pull")` (added with the batching fix). `pull-review/approve` has **no logging at all** — 48 database calls and not one log line. `SyncLog` and `ZohoPullLog` models exist; only `/settings/integrations` reads them.

What the owner asked for: *"log all zoho and related action request and response in the backend, and the frontend thing that happened when the import button is clicked."*

Direction, pending §8:

- **Outbound Zoho calls** — one `log.debug` per request (method, endpoint, page, item count) and per response (status, count, ms). `IntegrationClient` in `src/lib/integrations/base.ts` is the single choke point; instrument it there, not at 20 call sites.
- **Import runs** — a durable record per click: who, which pullId, how many requested, how many succeeded, how many failed, why, and elapsed. `SyncLog` is close but shaped for syncs.
- **Frontend** — the browser already has `createLogger` with `NEXT_PUBLIC_LOG_LEVEL`. Whether those lines should also reach the server is Q3.

---

## 5b. Part E — integration credentials must survive a disconnect

**The credentials are already saved. The API refuses to return them, and refuses to use them.**

`disconnect/route.ts:40` clears **only** the tokens — correct, and it stays:

```ts
const cleared = { isConnected: false, accessToken: null, refreshToken: null, accessTokenExpiresAt: null };
```

`clientId`, `clientSecret`, `organizationId` and `organizationName` are untouched and remain in
`integration_config`. **Nothing is lost on disconnect.** Two gaps make it look otherwise:

| Where | Defect |
|---|---|
| `status/route.ts:30` | `if (!config \|\| !config.isConnected) return successResponse({ connected: false })` — returns nothing else. And even when connected it never returns `clientId` at all. The screen has nothing to prefill, so the fields render empty. |
| `connect/route.ts:29` | `if (!clientId \|\| !clientSecret \|\| !grantToken)` — requires all three in the body. It cannot fall back to the stored pair, so reconnecting demands re-typing values that already exist. |
| — | **There is no save-without-connecting endpoint.** Credentials can only be written as a side effect of a successful token exchange. |

### The shape it should have

**1. `GET status` returns the saved details regardless of connection state.**

```ts
{
  connected: boolean,
  clientId: string | null,          // safe to show
  organizationId: string | null,
  organizationName: string | null,
  hasClientSecret: boolean,         // NEVER the secret itself
  lastSyncAt, tokenValid,
}
```

> **`clientSecret` must never reach the browser.** CLAUDE.md: *"Never log a secret. No tokens,
> access codes, passwords, refresh tokens, cookies."* The same rule governs responses. The UI
> needs to know a secret EXISTS so it can render the field as "saved — leave blank to keep";
> it never needs the value. `hasClientSecret` is that signal.

**2. New `PUT /api/integrations/[provider]`** — save client and organisation details without
connecting. Guarded by `requireFeature("zoho", "edit")`, like the other mutations.

An omitted or blank `clientSecret` means **keep the stored one**, so an admin can correct an
organisation name without re-typing the secret. Sending a value replaces it.

**3. `POST connect` falls back to the stored pair.** `grantToken` stays required — it is
single-use and cannot be stored. `clientId` / `clientSecret` become optional in the body:

```ts
const stored = await prisma.integrationConfig.findUnique({ where: { provider } });
const id     = clientId     || stored?.clientId;
const secret = clientSecret || stored?.clientSecret;
if (!id || !secret) return errorResponse("Save the client id and secret first", 400);
if (!grantToken)    return errorResponse("A grant token is required", 400);
```

**4. The screen (`settings/integrations`) gets three states, not two.**

| State | Shows |
|---|---|
| Nothing saved | all fields empty, **Save** |
| Saved, disconnected | fields **prefilled**, secret masked as "saved", **grant token + Connect**, plus **Save** for edits |
| Connected | fields prefilled and read-only, org name, last sync, **Disconnect** |

The owner's requirement, in their words: *"if I disconnect I only enter the grant access token
and connect; if I need to change the client or org details I save them first and then give the
grant token."* That is exactly the middle state.

### Why a new grant token is still required after every disconnect

Disconnect revokes the refresh token with Zoho before clearing it locally
(`disconnect/route.ts:25`), and Zoho does not re-issue one for a spent grant. **A fresh grant
token after each disconnect is Zoho's design, not a gap here.** Saving the client id and secret
removes the re-typing; it cannot remove the grant step.

---

## 6. Execution order

```
A  S3 Content-Length          15 min, self-test proves it        -> commit 1
C1 apiFetch in 6 files        errors become readable FIRST       -> commit 2
B  batch approve              the 504 itself                     -> commit 3
D  /deliveries + count fixes  the three swallowed failures       -> commit 4
E  credential persistence     status + PUT + connect fallback     -> commit 5
C2 Zoho logging               after §8 is answered               -> commit 6
```

**C1 before B, deliberately.** If the batching is wrong, the next failure must name itself. Fixing the error handling first means the harder change is debuggable.

---

## 7. Verification

**A** — `/settings/storage` self-test passes all steps: read settings, write, read back, delete.

**B** — import all 761 pending previews in one click, under 10 s. Then: no duplicate products, no duplicate brands, `Product.currentStock` unchanged for products that already existed, and re-clicking Import imports nothing.

**C1** — stop the dev server mid-import and confirm the UI shows a readable message, not a parse error. This is the only test that proves the fix.

**D** — fetch a window with zero new invoices and confirm the screen says so and returns to idle. Fetch one with results and confirm the count **stays on screen** until dismissed.

**Cross-cutting** — a fresh `/stock` fetch → review → import of 300+ items completes without a 504, and Vercel logs show duration well under 60 s.

---

## 8. Open questions — Part C2 is blocked on these

**Q1 — How much of each Zoho request/response should be logged?**
Full payloads are large (a 300-item page is ~200 KB) and contain customer names, phone numbers and pricing. CLAUDE.md says *"pass deliberate context objects, not whole bodies"* and *"log the identifiers needed to find the record again, never the whole payload."*
Options: (a) metadata only — endpoint, status, count, ms; (b) metadata plus the first N ids; (c) full bodies at `debug` only.
**Recommendation: (a), with (b) on failure.** A full body is rarely what you need and always what leaks.

**Q2 — Where do import logs live: Vercel console, or a database table with a screen?**
Console is free and already wired, but disappears and cannot be shown to a non-technical user. A table is durable and viewable but is another model, another screen, another retention question.
`SyncLog` already exists with `syncType / status / totalItems / synced / failed / errors / startedAt / completedAt / triggeredBy` — close to what an import run needs. Extend it, or add a purpose-built model?

**Q3 — Should browser logs reach the server?**
"The frontend thing that happened when Import was clicked" can mean (a) better console logging the owner reads in DevTools, or (b) the client POSTing a trace to the server so it is visible without the browser open. (b) is meaningfully more work and needs its own endpoint, rate limiting and a retention rule.

**Q4 — How should errors appear in the UI?**
Today: an inline red string. Options: keep inline; a toast; or a persistent "last import" panel showing counts and per-record failures. The third is most useful for a 761-record import where 3 rows fail — an inline string cannot express that.

**Q5 — What happens to the 761 stranded previews, and what is the retention rule?**
They belong to 11 old pulls and **no screen can reach them**. Three sub-questions:
- Should the review screen show *all* pending previews rather than one `pullId`?
- Should a new pull auto-reject superseded previews for the same entity type?
- Should anything `PENDING` older than N days be pruned? The table grows ~180 rows/day and is already the largest in the database at 911 rows.

---

## 9. Not in this plan

- **Category quality.** 496 of 600 item previews arrive with a blank `category_name`, so 151 products land in "Uncategorized"; the 104 that carry a value are mostly wheel sizes (`12`, `14`, `16`, `20`, `24 SS`, `29 MS`). That is a Zoho data question, not an import bug — the app is mirroring faithfully. `POST /api/products/auto-classify` reclassifies by product name today. Raise separately.
- **`listAllItems` page cap** (`integrations/base.ts`) — serial page fetches with no cap. Untouched by this plan; if a wide pull still times out after Part B, read that first.
- **Brands created from vendor names** (`approve:212`, `:339`) — real, and the reason `TUBE INVESTMENTS OF INDIA LTD` is a Brand. Its fix is the `BrandVendor` write path, which is its own piece of work.

## 10. Board of Agents

- `docs/agents/integration-architect.md` — Zoho call shape, what may be logged, retry semantics
- `docs/agents/backend-engineer.md` — the batched route, chunk size, transaction boundaries
- `docs/agents/frontend-engineer.md` — error surfaces, the count that must persist, loading states
- `docs/agents/database-architect.md` — only if Q2 adds a model or Q5 adds an index
