# Sequence Race and Import Atomicity — fix plan

Status: **PLAN ONLY — not implemented.** Awaiting go-ahead.
Suggested branch: `fix/sequence-race` (its own branch — it touches five unrelated modules).
Prepared 28 Aug 2026.

---

## 1. The bug in one sentence

Five places allocate a **unique** document number by reading the current maximum and adding
one, so two requests running at the same time compute the same number and the second write
fails.

## 2. The five sites

Every one is the same shape: `findFirst(orderBy: desc)` → parse the tail → `+1` → `create`.

| # | File | Column | Prefix | Unique? | In a transaction? |
|---|---|---|---|---|---|
| 1 | `api/zoho/pull-review/approve/route.ts:353` | `shipmentNo` | `IB-YYYYMM-` | ✅ | ❌ none in the file |
| 2 | `api/inbound/route.ts:159` | `shipmentNo` | `IB-YYYYMM-` | ✅ | ❌ none in the file |
| 3 | `api/transfer-orders/route.ts:134` | `orderNo` | `TRF-YYYYMM-` | ✅ | ⚠️ allocated at :134, transaction opens at :145 |
| 4 | `api/stock-counts/route.ts:132` | `countNo` | `SC-YYYYMM-` | ✅ | ❌ none in the file |
| 5 | `api/vendor-issues/route.ts:110` | `issueNo` | `ISS-YYYYMM-` | ✅ | ❌ none in the file |

Site 3 is the instructive one: somebody reached for a transaction, but allocated the number
**six lines before opening it**, so the transaction protects the writes and not the thing
that actually races.

## 3. How it fails, concretely

Two users press **Create shipment** within the same moment:

```
  request A                          request B
  ─────────────────────────────      ─────────────────────────────
  findFirst -> IB-202608-0041
                                     findFirst -> IB-202608-0041
  seq = 42                           seq = 42
  create IB-202608-0042  OK
                                     create IB-202608-0042
                                     ✗ Unique constraint failed
```

Because all four columns are `@unique`, the loser gets a hard error rather than a silent
duplicate. That is the better of the two failure modes — but see §5.

**Realistic triggers:** two people working the same screen; one impatient double-click on a
Create/Approve button; the Zoho bulk approve running while somebody creates a shipment by
hand.

## 4. The correct pattern is already in this codebase

`api/services/jobs/create/route.ts:56` mints `BCH-0001` job tokens correctly:

```ts
const job = await prisma.$transaction(async (tx) => {
  const [customer, counter] = await Promise.all([
    tx.customer.upsert({ ... }),
    tx.tokenCounter.upsert({
      where: { id: "default" },
      update: { current: { increment: 1 } },   // atomic, no read-then-write
      create: { id: "default", current: 1 },
    }),
  ]);
  const tokenNumber = `BCH-${String(counter.current).padStart(4, "0")}`;
  return tx.serviceJob.create({ data: { tokenNumber, ... } });
});
```

CLAUDE.md documents this hazard for `TokenCounter` explicitly. The lesson was learned once
and never carried to the other five.

## 5. Why this is worse than a failed request

Site 1 sits inside the Zoho bill import, which writes **seven tables with no transaction at
all** (`approve/route.ts`, 498 lines, zero `$transaction`). The shipment is created **last**,
so when the unique violation fires, the Vendor, Brand, Category, Products and VendorBill for
that bill are already committed.

The `catch` records the error and continues to the next preview. So the outcome is a
half-imported bill — vendors, brands and products belonging to a bill that has no shipment —
and nothing in the data marks it as incomplete.

**The race causes the partial write.** Fixing §7 without §8 leaves the second problem alive
for every other failure (a Zoho timeout, a validation error, a bad line item).

## 6. A latent second defect in the same code

`orderBy: { shipmentNo: "desc" }` is a **string** sort. It works only while the numeric tail
is a fixed width. At 10,000 documents in one month:

```
  "IB-202608-10000"  <  "IB-202608-9999"     (lexicographically: "1" < "9")
```

The max-scan would return `...-9999`, the next number would be `10000` again, and the
sequence would jam permanently. Not urgent at current volume, but the counter fix in §7
removes the failure mode entirely rather than deferring it.

## 7. The fix — one counter table

Same shape as `TokenCounter`, keyed per prefix because the prefixes reset monthly.

```prisma
model Counter {
  key     String @id   // "IB-202608", "SC-202608", "TRF-202608", "ISS-202608"
  current Int    @default(0)

  @@map("counter")
}
```

One helper, `src/lib/sequence.ts`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * Allocate the next number for `prefix`. MUST be called with a transaction client so the
 * allocation and the row that uses it commit together.
 *
 * The upsert takes a row lock, so concurrent callers serialize here instead of racing.
 * Brief contention under load is the correct behaviour, not a regression.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  prefix: string,
  pad = 4
): Promise<string> {
  const counter = await tx.counter.upsert({
    where: { key: prefix },
    update: { current: { increment: 1 } },
    create: { key: prefix, current: 1 },
  });
  return `${prefix}-${String(counter.current).padStart(pad, "0")}`;
}
```

### Gaps are expected, and that is fine

If a transaction rolls back after incrementing, that number is consumed and skipped. Document
numbers will therefore have occasional gaps. This is normal for sequence allocation and is
the correct trade: a gap is harmless, a duplicate is not. Worth saying out loud because
somebody will eventually report a missing `IB-202608-0043` as a bug.

## 8. Backfill — the step that will break things if skipped

⚠️ **The counters must be seeded from the existing maximum per prefix before the new code
serves traffic.** Otherwise the first request creates a counter at `1`, generates
`IB-202608-0001`, and collides with a row you already have.

`scripts/backfill-counters.js`, run once:

1. For each of `InboundShipment.shipmentNo`, `TransferOrder.orderNo`, `StockCount.countNo`,
   `VendorIssue.issueNo`:
   - read every value
   - split into `prefix` and numeric tail (**parse the tail numerically — do not sort as a
     string**, per §6)
   - group by prefix, take the max
2. `upsert` a `Counter` row per prefix with `current = max`
3. Print every prefix and value it wrote, so the result can be eyeballed before deploying

Ordering: **db push → backfill → deploy**. The backfill is idempotent and safe to re-run.

## 9. Per-site changes

| Site | Change |
|---|---|
| `inbound/route.ts` | wrap the create in `$transaction`; `nextSequence(tx, prefix)` |
| `stock-counts/route.ts` | wrap in `$transaction`; `nextSequence(tx, ...)` |
| `vendor-issues/route.ts` | wrap in `$transaction`; `nextSequence(tx, ...)` |
| `transfer-orders/route.ts` | **move the allocation inside the existing transaction** at :145 |
| `zoho/pull-review/approve/route.ts` | see §10 — needs the atomicity work as well |

## 10. Import atomicity — the related fix

Wrap **each preview's writes** in `prisma.$transaction`, keeping the per-preview loop outside
so one bad bill does not abort the whole batch.

⚠️ **Constraint that must not be missed.** The loop currently calls Zoho over HTTP *inside*
the work it would now wrap — `zoho.getBill()` at `approve:161` and `zoho.getInvoice()` at
`:431`. Holding a Postgres transaction open across a network call to a third party invites
transaction timeouts and connection-pool exhaustion whenever Zoho is slow.

**Restructure to two phases per preview:**

```
  phase 1  (no transaction)   fetch everything needed from Zoho
  phase 2  ($transaction)     write Vendor, Brand, Category, Products,
                              VendorBill, InboundShipment, PreBooking updates
```

Result: a bill either imports completely or not at all, and the transaction stays short.

## 11. Rollout

1. Branch `fix/sequence-race`.
2. Add the `Counter` model and `src/lib/sequence.ts`. *(Editing `prisma/schema.prisma`
   triggers the schema-review hook — expect a review.)*
3. Stop the dev server, then `npm run db:push` (`prisma generate` throws `EPERM` while the
   server holds the query engine).
4. Run `scripts/backfill-counters.js` and **read its output** before continuing.
5. Convert the five sites.
6. Restructure the Zoho import into fetch-then-write phases.
7. `npm run build`.

## 12. Verification

- `grep -rn "orderBy: { shipmentNo\|orderBy: { orderNo\|orderBy: { countNo\|orderBy: { issueNo" src/`
  returns nothing — no max-scan allocation remains.
- Each `Counter` row equals the maximum currently in its table.
- Create a shipment, a transfer, a stock count and a vendor issue by hand; each gets the
  next number with no gap from the backfilled value.
- **Concurrency check:** fire two creates simultaneously against the same prefix
  (two browser tabs, or `curl … & curl … &`) and confirm two distinct numbers rather than
  one error.
- Force a mid-import failure — point at a bill with a line item that cannot resolve — and
  confirm **no** Vendor, Brand or VendorBill rows survive for that bill.

## 13. Open decisions

1. **Scope.** Fix all five sites, or only the two `shipmentNo` ones that sit in the
   highest-traffic path? Recommendation: all five — the helper is written once and the
   remaining three are a two-line change each.
2. **Do §7 and §10 ship together?** They are separable, but fixing the race alone leaves
   partial writes on every *other* failure. Recommendation: together, one branch.
3. **Should `Counter` be seeded for future months?** No — a missing key creates itself at
   `1`, which is correct for a month with no documents yet. Listed only so it is a decision
   rather than an oversight.
