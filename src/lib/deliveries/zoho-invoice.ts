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

/**
 * Everything a Delivery row takes from a Zoho invoice DETAIL response.
 *
 * Lifted out of `api/deliveries/import-zoho/route.ts`, where it was inline, so the two import
 * paths — the bulk fetch review (`zoho/pull-review/approve`) and the single-invoice import —
 * cannot drift. They HAD drifted: only import-zoho read the address, area, pincode and
 * salesperson, so an invoice brought in through the review flow arrived with no delivery
 * address at all and the dispatch clerk had nothing to route by.
 *
 * Returns only the fields derived from the detail. The caller supplies the rest (storeId,
 * status) and may override the four the preview already knows better.
 */
export interface DeliveryFieldsFromInvoice {
  zohoInvoiceId: string | null;
  invoiceNo: string;
  invoiceDate: Date;
  invoiceAmount: number;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerArea: string | null;
  customerPincode: string | null;
  salesPerson: string;
  lineItems: Array<{ name: string; sku: string; quantity: number; rate: number; itemTotal: number }>;
}

export function deliveryFieldsFromInvoiceDetail(inv: {
  invoice_id?: string;
  invoice_number?: string;
  customer_name?: string;
  date?: string;
  total?: number;
  salesperson_name?: string;
  line_items?: Array<{ name: string; sku?: string; quantity: number; rate: number; item_total: number }>;
  contact_persons?: Array<{ phone?: string; mobile?: string }>;
  billing_address?: { phone?: string };
  shipping_address?: { address?: string; street2?: string; city?: string; state?: string; zip?: string; phone?: string };
}): DeliveryFieldsFromInvoice {
  const lineItems = (inv.line_items || []).map((li) => ({
    name: li.name,
    sku: li.sku || "",
    quantity: li.quantity,
    rate: li.rate,
    itemTotal: li.item_total,
  }));

  // Zoho puts the phone in whichever of three places the record happened to be created from.
  const phone =
    inv.contact_persons?.[0]?.phone ||
    inv.billing_address?.phone ||
    inv.shipping_address?.phone ||
    "";

  const customerAddress = [
    inv.shipping_address?.address,
    inv.shipping_address?.street2,
    inv.shipping_address?.city,
    inv.shipping_address?.state,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    zohoInvoiceId: inv.invoice_id ?? null,
    invoiceNo: inv.invoice_number ?? "",
    // Zoho always sends a date, so the fallback is unreachable in practice — it exists
    // because the field is optional on the type. A dateless invoice files under today,
    // which is visibly wrong rather than silently absent.
    invoiceDate: new Date(inv.date ?? Date.now()),
    invoiceAmount: Number(inv.total || 0),
    customerName: inv.customer_name ?? "Unknown",
    customerPhone: phone || null,
    customerAddress: customerAddress || null,
    customerArea: inv.shipping_address?.city || null,
    customerPincode: inv.shipping_address?.zip || null,
    salesPerson: inv.salesperson_name || "",
    lineItems,
  };
}
