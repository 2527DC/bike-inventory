import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:zoho-invoice");

/**
 * Which store sold this invoice?
 *
 * ─── WHY THIS IS HERE AND NOT IN P4 ───────────────────────────────────────────────────────
 *
 * P1b (the stock ledger fix) needs a store to deduct from, and it runs BEFORE P4. Without
 * this resolver every sale would fall back to the primary store for the whole window between
 * the two phases — and a BCC sale would deduct BCH stock. The owner chose to move it here
 * (option B, 4 Sep) rather than accept that.
 *
 * ─── HOW IT RESOLVES ──────────────────────────────────────────────────────────────────────
 *
 * Each store carries an `invoicePrefix` ("BCH/", "BCC/"). The invoice number carries it too,
 * so the match is a plain string prefix — no database query, no AI, no heuristics.
 *
 * LONGEST match wins. With prefixes "BCH/" and "BCH/SVC/", the invoice "BCH/SVC/0012" must
 * resolve to the service store and not to whichever of the two the array happened to list
 * first. Sorting by length is what makes the result independent of store order.
 *
 * Comparison is case-insensitive and ignores surrounding whitespace: these values are typed
 * into a settings form by a person, and "bch/" is not a different store from "BCH/".
 *
 * Returns null when nothing matches. The CALLER decides what to do about that — every caller
 * in this codebase falls back to the primary store and logs a warning, because refusing to
 * record a sale is worse than recording it against the wrong store. Null is deliberately not
 * "the primary store" here, so that the fallback is visible at the call site rather than
 * hidden in a helper.
 */

export interface StoreWithPrefix {
  id: string;
  invoicePrefix: string | null;
}

export function storeIdForInvoice(
  invoiceNo: string | null | undefined,
  stores: StoreWithPrefix[]
): string | null {
  if (!invoiceNo) return null;

  const needle = invoiceNo.trim().toUpperCase();
  if (!needle) return null;

  const candidates = stores
    .filter((s) => s.invoicePrefix && s.invoicePrefix.trim().length > 0)
    .map((s) => ({ id: s.id, prefix: s.invoicePrefix!.trim().toUpperCase() }))
    // Longest first, so the most specific prefix wins regardless of input order.
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const hit = candidates.find((c) => needle.startsWith(c.prefix));
  return hit ? hit.id : null;
}

/**
 * Resolve the store for an invoice, falling back to the primary store.
 *
 * The primary store is the active one with the lowest `sortOrder` — the same ordering every
 * picker in the app uses, so "primary" means the same thing here as it does on screen.
 *
 * Warns on every fallback, with the invoice number, because a fallback means a sale was
 * attributed by guesswork: either a store is missing its `invoicePrefix` on /stores, or the
 * invoice came from somewhere nobody has configured yet. Both are worth seeing in the log.
 */
export function resolveStoreIdOrPrimary(
  invoiceNo: string | null | undefined,
  stores: Array<StoreWithPrefix & { isActive: boolean; sortOrder: number }>
): string | null {
  const matched = storeIdForInvoice(invoiceNo, stores);
  if (matched) return matched;

  const primary = stores
    .filter((s) => s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];

  if (!primary) {
    log.error("no active store to attribute this invoice to", { invoiceNo: invoiceNo ?? null });
    return null;
  }

  log.warn("invoice did not match any store invoicePrefix — using the primary store", {
    invoiceNo: invoiceNo ?? null,
    storeId: primary.id,
    prefixesConfigured: stores.filter((s) => s.invoicePrefix).length,
  });
  return primary.id;
}
