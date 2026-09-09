import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextSequence } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";
import { poSeedSql, PO_SEQUENCE_KEY, PO_SEQUENCE_PAD } from "./sequence";
import { findOpenPoConflicts, conflictMessage, type PoConflict } from "./duplicates";
import { resolveVendors } from "./resolve-vendor";

const log = createLogger("purchase-orders:create");

/**
 * Namespace for this module's advisory locks.
 *
 * `pg_advisory_xact_lock` has a one-argument (bigint) and a two-argument (int4, int4) form.
 * The two-argument form is used deliberately: the one-argument form would put vendor locks in
 * the SAME global key space as every other advisory lock in this database — including the
 * session lock `prisma migrate` takes before applying migrations, and any lock a later phase
 * adds. A namespace costs nothing now and cannot be retrofitted later without changing lock
 * identity mid-flight, which is the one moment it must not change.
 *
 * 0x504F is ASCII "PO".
 */
const PO_LOCK_NAMESPACE = 0x504f;

export interface PoLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  gstRate?: number;
}

export interface CreatePoInput {
  vendorId: string;
  items: PoLineInput[];
  expectedDate?: string | Date | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  /** true → PENDING_APPROVAL, false → DRAFT. */
  submit?: boolean;
}

export interface CreatePoOptions {
  /**
   * What to do with a line whose unit price is 0.
   *
   * "reject" — refuse the whole request with a 400. Right for /purchase-orders/new, where a
   *            blank rate is a typo somebody can fix on the spot.
   * "skip"   — leave those lines off the PO and name them back to the caller. Written for the
   *            brand-stock sheet (deleted 9 Sep 2026), where a blank price cell was missing
   *            DATA, not a mistake: failing forty rows because three had no price made the
   *            screen unusable (owner, 6 Sep). NO caller passes it today: the quotation import
   *            that replaced brand-stock submits through the same POST as manual entry and
   *            passes "reject", because its review step lets a person fix or drop a priceless
   *            row before the PDF becomes an offer (owner, 9 Sep 2026, Q7). Kept, not removed,
   *            so the next bulk caller does not have to rediscover the distinction.
   */
  onPricelessLine?: "reject" | "skip";

  /**
   * Refuse the order when a product is not supplied by the chosen vendor.
   *
   * OFF by default, and that default is load-bearing for library callers: a matched
   * product's resolved vendor (`reorderVendorId`, else the brand-linked vendor) is often NOT
   * the vendor an order is raised against while the catalogue's vendor links are incomplete,
   * so a caller that did not choose the vendor deliberately must not be refused for it.
   * POST /api/purchase-orders turns it ON for both of its screens — manual entry and the
   * quotation import — because on both the vendor was chosen before any product was
   * (owner, 9 Sep 2026, Q2) and a mismatch means the wrong product was mapped. The review
   * screen shows a vendor-mismatch notice for exactly that reason.
   */
  verifyVendorSupplies?: boolean;
}

export interface SkippedLine {
  productId: string;
  sku: string;
  name: string;
  reason: string;
}

export class PoCreateError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "PoCreateError";
    this.status = status;
    this.data = data;
  }
}

export interface CreatePoResult {
  po: Awaited<ReturnType<typeof createPurchaseOrderRow>>;
  /** Lines left off because they had no price. Empty unless onPricelessLine is "skip". */
  skipped: SkippedLine[];
}

type Tx = Prisma.TransactionClient;

/** The insert itself, split out only so its return type can name the shape callers get. */
function createPurchaseOrderRow(tx: Tx, args: Prisma.PurchaseOrderCreateArgs) {
  return tx.purchaseOrder.create({
    ...args,
    include: {
      vendor: { select: { id: true, name: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });
}

/**
 * Create a purchase order. THE only way one gets created.
 *
 * ─── WHY THERE IS ONE OF THESE ───────────────────────────────────────────────────────────
 *
 * There were two independent creators, and they disagreed about nearly everything:
 * `api/purchase-orders/route.ts` padded the number to five digits and ordered by `createdAt`;
 * the brand-stock `generate-po` route (deleted 9 Sep 2026 — its job is now the quotation
 * import on /purchase-orders/new, which creates through this function) padded to four and
 * ordered by `poNumber` as a STRING, which is not merely racy — once `PO-00010` exists it
 * sorts below `PO-0002`, so that route read the wrong "last" PO and emitted a number already
 * taken.
 *
 * That second route never worked at all. It passed `hsnCode` into a `PurchaseOrderItem` create
 * and that column does not exist, so every valid request threw
 * `PrismaClientValidationError: Unknown argument 'hsnCode'` and returned a 500. It survived
 * because the object came out of a `.map()` rather than a fresh literal, so TypeScript's
 * excess-property check never fired: clean tsc, clean build, guaranteed runtime failure.
 * Routing it through here fixes it by construction — this function never builds that field.
 *
 * ─── THE LOCK, AND THE REASON THAT ACTUALLY APPLIES ──────────────────────────────────────
 *
 * `pg_advisory_xact_lock` — the TRANSACTION-scoped variant. The session-scoped
 * `pg_advisory_lock` would be wrong here, and NOT primarily because of pgbouncer:
 *
 *   `src/lib/db.ts` creates a bare `new PrismaClient()`, so the query engine keeps its own
 *   connection pool. A session lock binds to whichever pooled connection served the statement
 *   and is returned to the pool still held; a later unlock is not guaranteed to land on the
 *   same connection, and any throw between lock and unlock leaks it until the process exits.
 *
 * That is true on `localhost:5432` — which is what `.env` points at today and what anyone
 * building this will test against. It is ALSO true, for a second and independent reason, on
 * the 6543 `pgbouncer=true` pooler used in production, where the connection is pinned only for
 * the duration of the transaction. The transaction-scoped lock is released by COMMIT/ROLLBACK
 * inside the engine, which holds on every topology this repo has used.
 *
 * So: do not "simplify" this to `pg_advisory_lock`. It would appear to work in dev and leak.
 *
 * `$executeRaw`, not `$queryRaw`: the function returns `void`, and nothing in this codebase
 * has ever deserialised a void return.
 *
 * The `::int4` on the namespace is not decoration. Prisma binds a JS number as BIGINT, so the
 * uncast call asks Postgres for `pg_advisory_xact_lock(bigint, integer)`, which does not exist:
 * 42883, on every single purchase order. `hashtext` already returns int4, so the second
 * argument needs nothing. This was found by running the statement, not by reading about it —
 * reasoning about the SQL literal misses what the parameter binder does to it.
 *
 * `hashtext` can collide across vendor ids (int4 key space). A collision serialises two
 * unrelated vendors against each other. That over-serialises; it cannot corrupt.
 *
 * ─── ONE KNOWN DEGRADATION, so it is not a surprise later ────────────────────────────────
 *
 * `prisma migrate deploy` runs from the Vercel build against live traffic. An
 * `ALTER TABLE "PurchaseOrder"` takes ACCESS EXCLUSIVE; a PO creation blocked behind it now
 * holds the vendor lock while it waits, so every other create for that vendor queues behind it
 * and they hit the 15 s timeout as P2028. Before this they would have failed independently.
 */
export async function createPurchaseOrder(
  input: CreatePoInput,
  user: { id: string; name: string },
  options: CreatePoOptions = {}
): Promise<CreatePoResult> {
  const onPricelessLine = options.onPricelessLine ?? "reject";

  if (input.items.length === 0) {
    throw new PoCreateError("At least one item is required", 400);
  }

  // Products are read BEFORE the transaction: this is what turns "no rate" into a sentence
  // naming an SKU rather than an id, and the lookup does not need to be inside the lock.
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    // brandId and reorderVendorId feed the vendor check below. Selected here rather than in a
    // second query because this lookup already runs for every create.
    select: { id: true, sku: true, name: true, brandId: true, reorderVendorId: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new PoCreateError(`${missing.length} product(s) on this order no longer exist`, 400);
  }

  // ─── does this vendor actually supply these products? ─────────────────────────────────
  // Outside the transaction and outside the lock, for the same reason as the lookup above: it
  // is a read, and serialising it would buy nothing.
  if (options.verifyVendorSupplies) {
    const resolutions = await resolveVendors(products);
    const mismatched = products.filter((p) => {
      const r = resolutions.get(p.id);
      return r?.resolved === true && r.vendor.id !== input.vendorId;
    });

    if (mismatched.length > 0) {
      const vendor = await prisma.vendor.findUnique({
        where: { id: input.vendorId },
        select: { name: true },
      });
      const names = mismatched.slice(0, 3).map((p) => p.name).join(", ");
      throw new PoCreateError(
        `${names}${mismatched.length > 3 ? ` and ${mismatched.length - 3} more` : ""} ` +
          `${mismatched.length === 1 ? "is" : "are"} not supplied by ${vendor?.name ?? "this vendor"}. ` +
          `Set the vendor on ${mismatched.length === 1 ? "it" : "them"} first.`,
        400,
        // Structured like the 409's conflicts, so the screen can offer to drop these lines
        // instead of only printing the sentence.
        {
          mismatches: mismatched.map((p) => {
            const r = resolutions.get(p.id);
            return {
              productId: p.id,
              sku: p.sku,
              name: p.name,
              expectedVendorId: r?.resolved ? r.vendor.id : null,
              expectedVendorName: r?.resolved ? r.vendor.name : null,
            };
          }),
        }
      );
    }
  }

  // ─── ₹0 lines ──────────────────────────────────────────────────────────────────────────
  // A zero rate must never reach a purchase order silently: P12 emails the PDF to the vendor,
  // so a ₹0 line is a written offer to be supplied free. What differs between callers is
  // whether a missing price is a typo (refuse) or missing data (skip) — see CreatePoOptions.
  const skipped: SkippedLine[] = [];
  const priced: PoLineInput[] = [];

  for (const item of input.items) {
    if (item.unitPrice > 0) {
      priced.push(item);
      continue;
    }
    const p = byId.get(item.productId)!;
    if (onPricelessLine === "reject") {
      throw new PoCreateError(`Line ${p.sku} has no rate — enter a unit price`, 400);
    }
    skipped.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      reason: "No price on the sheet and no cost price on the product",
    });
  }

  if (priced.length === 0) {
    throw new PoCreateError(
      skipped.length > 0
        ? `None of the ${skipped.length} selected item(s) has a price. Set a cost price on the products, or add prices to the sheet.`
        : "At least one item is required",
      400
    );
  }

  const lines = priced.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gstRate: item.gstRate ?? 18,
    amount: item.quantity * item.unitPrice,
  }));

  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const gstTotal = lines.reduce((sum, l) => sum + l.amount * (l.gstRate / 100), 0);

  const result = await prisma.$transaction(
    async (tx) => {
      // Everything below runs under this lock: the duplicate check, the number allocation and
      // the insert. Two creates for the same vendor are serialised, so the second sees the
      // first's rows rather than racing them.
      // ::int4 on the namespace is REQUIRED and was found by running it. Prisma binds a JS
            // number as bigint, so without the cast Postgres looks for
            // pg_advisory_xact_lock(bigint, integer), which does not exist — 42883, and every
            // purchase order creation would have been a 500. `hashtext` already returns int4, so
            // only the first argument needs it.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PO_LOCK_NAMESPACE}::int4, hashtext(${input.vendorId}))`;

      const conflicts = await findOpenPoConflicts(tx, input.vendorId, lines.map((l) => l.productId));
      if (conflicts.length > 0) {
        throw new PoCreateError(conflictMessage(conflicts), 409, { conflicts });
      }

      // `tx`, not `prisma`. Two of the five existing nextSequence callers pass the root client,
      // which works only because the counter's ON CONFLICT is atomic on its own — but it would
      // allocate on a different connection than the one holding the lock, escaping it.
      const seq = await nextSequence(tx, PO_SEQUENCE_KEY, PO_SEQUENCE_PAD, poSeedSql());
      const poNumber = `PO-${seq}`;

      const po = await createPurchaseOrderRow(tx, {
        data: {
          poNumber,
          vendorId: input.vendorId,
          status: input.submit === false ? "DRAFT" : "PENDING_APPROVAL",
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          deliveryAddress: input.deliveryAddress ?? null,
          notes: input.notes ?? null,
          createdById: user.id,
          subtotal,
          gstTotal,
          grandTotal: subtotal + gstTotal,
          items: { create: lines },
        },
      });

      await logActivity(tx, {
        module: "purchase_orders",
        action: "created",
        entityType: "PurchaseOrder",
        entityId: po.id,
        entityRef: po.poNumber,
        toValue: po.status,
        details: `${lines.length} line(s) for ${po.vendor.name}${
          skipped.length > 0 ? ` · ${skipped.length} skipped, no price` : ""
        }`,
        userId: user.id,
        userName: user.name,
      });

      return po;
    },
    // The defaults are 2 s maxWait / 5 s timeout. With a lock in play a second caller WAITS,
    // and on the default maxWait it would fail with P2028 instead of queueing behind the first
    // and then getting a clean 409.
    { maxWait: 5000, timeout: 15000 }
  );

  log.info("purchase order created", {
    poId: result.id,
    poNumber: result.poNumber,
    vendorId: input.vendorId,
    status: result.status,
    lines: lines.length,
    skipped: skipped.length,
  });

  return { po: result, skipped };
}

export type { PoConflict };
