# Zoho pull times out (504) — batching plan

Status: pending — the `items` and `contacts` steps do one database round trip per record; `bills` and `invoices` in the same file already batch
Suggested branch: `fix/zoho-pull-batching` (one route file plus a config line).
Prepared 29 Aug 2026.

---

## 1. The symptom

Clicking **Fetch** on `/stock` against a wide date window fails with:

> The server failed while handling this request (504). It returned a page instead of data —
> usually a timeout or a crash.

That message is ours — `src/lib/api-client.ts:121`. It fires because the response body was
HTML, not JSON, and it prints the real status: **504**. Vercel serves an HTML error page when
a function exceeds its limit, and `apiFetch` correctly refused to parse it as JSON.

This is the guard working. Before `apiFetch`, the same failure surfaced as
`Unexpected token '<'` with no status at all.

`/deliveries` (bills) and the inbound import work fine. That difference is the whole diagnosis.

## 2. Cause — one database round trip per record

`src/app/api/zoho/trigger-pull/route.ts` handles four pull steps. **Two batch their database
work and two do not**, and the two that do not are the two that fail.

### The broken shape — `items` (lines 103–147) and `contacts` (lines 218–244)

```ts
for (const item of items) {
  await prisma.product.findFirst({ where: { sku } });          // round trip
  await prisma.product.findFirst({ where: { zohoItemId } });   // round trip (if first missed)
  await prisma.zohoPullPreview.create({ ... });                // round trip (if new)
}
```

`contacts` is the same, one `prisma.vendor.findFirst` plus one `create` per contact.

### The correct shape — `bills` (282–347) and `invoices` (390–431)

```ts
const existing = await prisma.vendorBill.findMany({ ... });   // 1 round trip, all of them
await prisma.zohoPullPreview.deleteMany({ ... });             // 1
await prisma.$transaction([ ...creates ]);                    // 1
```

Three round trips whether the import is 5 records or 500.

So this is not a design problem to solve — **the answer already exists twice in the same
file.** `items` and `contacts` were never converted when `bills` and `invoices` were.

## 3. Why the round trips are fatal here specifically

```
vercel.json     "regions": ["bom1"]                        Mumbai
DATABASE_URL    aws-0-ap-southeast-1.pooler.supabase.com   Singapore
route.ts:2      export const maxDuration = 30
```

Every query crosses Mumbai → Singapore, roughly **40 ms**, before the query itself runs.
Sequentially, so the latency does not overlap.

| Items from Zoho | Round trips | Time | Under 30s? |
|---|---|---|---|
| 100 | ~200 | ~8 s | yes |
| 400 | ~800 | ~32 s | **no** |
| 1,500 | ~3,000 | ~120 s | no |

Indexes are not the issue: `Product.sku` and `Product.zohoItemId` are both `@unique`, so each
lookup is a fast index hit. The cost is the *number of trips*, not the speed of each.

## 4. Fix — convert both steps to the bills shape

For `items`:

1. Filter to `stock_on_hand > 0` in memory (already done).
2. Collect the non-empty `sku` and `item_id` values.
3. **One** query:
   ```ts
   const existing = await prisma.product.findMany({
     where: { OR: [{ sku: { in: skus } }, { zohoItemId: { in: ids } }] },
     select: { sku: true, zohoItemId: true },
   });
   ```
4. Build two `Set`s; decide "is this new" in memory.
5. **One** `createMany` for the previews.

`contacts` gets the same treatment against `prisma.vendor`.

**Result: ~2N+M round trips become 2 per step.**

### Four details that will bite if missed

- **Filter empty strings before the `in` clause.** Many Zoho items have `sku: ""`. Passing
  `""` into `{ sku: { in: [...] } }` matches any product with an empty SKU and would silently
  mark new items as existing.
- **Dedupe within the batch.** Zoho can return the same `item_id` twice across pages.
  `createMany` with `skipDuplicates` will not help — `ZohoPullPreview` has no unique
  constraint on `zohoId`. Dedupe in memory with a `Set` before writing.
- **Chunk the `in` list at ~1,000.** A single `IN` with several thousand values produces a
  very large query. Chunk the lookup, merge the results.
- **Preserve the "existing items are FROZEN" rule.** The current loop `continue`s on a match
  so Zoho never modifies an item already in the app. The set-based version must keep exactly
  that behaviour — it is a deliberate business rule, commented at line 111.

### maxDuration

Raise `route.ts:2` from 30 to 60 as headroom. **This is not the fix** — it moves the cliff
from ~400 items to ~800. It is worth having once the real fix is in, and worthless without it.

## 5. The second bottleneck, which batching does not solve

`listAllItems` in `src/lib/integrations/base.ts`:

```ts
for (;;) {
  const data = await this.listItems(page, statusFilter, lastModifiedTime);
  all.push(...(data.items || []));
  if (!data.page_context?.has_more_page) break;
  page++;
}
```

Serial, 200 records per page, **no page cap and no delay**. A 5,000-item catalog is 25
sequential calls to Zoho — at 300–800 ms each that is 8–20 seconds spent before a single
database query runs.

So for a large enough catalog the pull can still exceed 60s even with the database work
batched. Batching is necessary and may not be sufficient.

Options, in preference order:

1. **Leave it and measure.** With the database work batched, the Zoho fetch may fit
   comfortably. Do not solve a problem that has not appeared.
2. **Cap the pages** and report "more remain, narrow your date window" — honest, and the UI
   already has a date-window control.
3. **Make the step resumable** — store the page cursor on the pull record and let the client
   call again. Most work; only worth it if 1 and 2 prove insufficient.

Note that `listPaidInvoices` in the workshop client carried a 25-page safety cap for exactly
this reason before it was deleted as dead code. The concern is not hypothetical.

## 6. Immediate workaround, no deploy

Use a **7-day** window instead of 30 or 90. Fewer items, fewer round trips, finishes inside
30 seconds. Pull in several narrow windows rather than one wide one.

This also doubles as the diagnostic: if a 7-day pull succeeds and a 90-day pull does not, the
problem is volume and time, not the Zoho connection.

## 7. File-by-file

| File | Change |
|---|---|
| `src/app/api/zoho/trigger-pull/route.ts` | rewrite the `items` step (84–197) and the `contacts` step (200–246) to the batched shape; raise `maxDuration` to 60 |
| `src/lib/integrations/base.ts` | **only if §5 option 2 is chosen** — add a page cap to `listAllItems` |

No schema change. No new dependency. `ZohoPullPreview` already has the `pullId` index the
preview screen reads.

## 8. Verification

- `npm run build` passes.
- A **90-day** pull on `/stock` completes without a 504. This is the actual acceptance test;
  everything else is a proxy.
- The preview list after the pull contains the same items as an equivalent narrow-window pull
  run today — batching must not change *which* items are found, only how fast.
- An item already in the catalog still does not reappear for review, and its brand, category
  and pricing are unchanged. This proves the FREEZE rule survived the rewrite.
- A pull where Zoho returns duplicate `item_id`s across pages produces **one** preview row per
  item, not two.
- The Vercel log for `/api/zoho/trigger-pull` shows a duration well under 60s, and no
  `FUNCTION_INVOCATION_TIMEOUT`.
- `contacts` — run a vendor pull and confirm the same.

## 9. How to confirm the diagnosis before starting

Vercel dashboard → project → **Logs**, filter `/api/zoho/trigger-pull`. A timeout prints
`Task timed out after 30.00 seconds` / `FUNCTION_INVOCATION_TIMEOUT`. A crash prints a stack
trace instead. If it is a stack trace, this plan is aimed at the wrong problem and should be
re-opened before any code is written.

## 10. Open question

**Does `contacts` get fixed in the same pass?** It has the identical defect and the identical
fix, and it is in the same function. Doing it separately means reading and re-testing the same
route twice. Doing it together makes the diff larger and couples a vendor-pull change to a
stock-pull fix you actually need today.

Recommendation: **both**, in one branch, as two commits — the same review, separately
revertable. Confirm or say items-only.
