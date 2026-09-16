import type { Prisma } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("deliveries:floor-warehouse");

/**
 * Which FLOOR warehouse sold this invoice? (plan 1609-deliveries, R30–R31, T1)
 *
 * ─── WHAT CHANGED, 16 Sep 2026 ────────────────────────────────────────────────────────────
 *
 * The prefix used to live on the Store (`storeIdForInvoice` / `resolveStoreIdOrPrimary`, both
 * removed), and an unmatched invoice fell back to the primary store — so every import landed
 * on one store by guesswork. The owner moved the prefix to the FLOOR warehouse, because a
 * store holds no stock, and ruled that an unmatched invoice is a "Dummy" with NO fallback
 * (A41b). Returning null is therefore the answer, not a gap for the caller to paper over.
 *
 * ─── HOW IT RESOLVES ──────────────────────────────────────────────────────────────────────
 *
 * A plain string prefix, LONGEST match first ("BCH/SVC/" beats "BCH/"), case-insensitive and
 * trimmed — the prefixes are typed into /stores by a person. Only active FLOOR warehouses with
 * a prefix take part.
 */

export interface FloorWithPrefix {
  id: string;
  storeId: string;
  invoicePrefix: string | null;
}

export function floorWarehouseForInvoice(
  invoiceNo: string | null | undefined,
  floors: FloorWithPrefix[]
): { warehouseId: string; storeId: string } | null {
  const needle = (invoiceNo ?? "").trim().toUpperCase();
  if (!needle) return null;

  const hit = floors
    .filter((w) => w.invoicePrefix && w.invoicePrefix.trim().length > 0)
    .map((w) => ({ w, prefix: w.invoicePrefix!.trim().toUpperCase() }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((c) => needle.startsWith(c.prefix));

  if (!hit) {
    log.debug("no floor prefix matched — Dummy", { invoiceNo: invoiceNo ?? null, floors: floors.length });
    return null;
  }
  return { warehouseId: hit.w.id, storeId: hit.w.storeId };
}

/** The candidates for `floorWarehouseForInvoice`: active FLOOR warehouses carrying a prefix. Uncached on purpose. */
export async function listFloorWarehousesWithPrefix(
  client: { warehouse: Prisma.TransactionClient["warehouse"] }
): Promise<FloorWithPrefix[]> {
  return client.warehouse.findMany({
    where: { kind: "FLOOR", isActive: true, invoicePrefix: { not: null } },
    select: { id: true, storeId: true, invoicePrefix: true },
  });
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
  /**
   * Zoho's own payment word ("paid", "partially_paid", "overdue", "sent"…) and the balance
   * still owed, as they stood at import (plan 1609-deliveries, A31, T7). A snapshot — never
   * refreshed (A32); a `CustomerInvoice` row overrides both on the detail screen.
   */
  zohoPaymentStatus: string | null;
  zohoBalance: number | null;
}

/** A Zoho number that may arrive as a number, a numeric string, or not at all. */
function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function deliveryFieldsFromInvoiceDetail(inv: {
  invoice_id?: string;
  invoice_number?: string;
  customer_name?: string;
  date?: string;
  total?: number;
  balance?: number;
  status?: string;
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
    zohoPaymentStatus: typeof inv.status === "string" && inv.status.trim() ? inv.status.trim() : null,
    zohoBalance: finiteOrNull(inv.balance),
  };
}
