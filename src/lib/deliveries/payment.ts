import type { Prisma } from "@prisma/client";

/**
 * What the delivery screens show for "paid and balance" (plan 1609-deliveries, R23, R28, A31, A32).
 *
 * Order of truth:
 * 1. a `CustomerInvoice` row for the same invoice number (the receivables module) — it moves when
 *    payments are recorded, so it wins when it exists;
 * 2. Zoho's own `status` and `balance`, snapshot on the delivery at import;
 * 3. nothing — every delivery imported before 16 Sep 2026 — and the screen says "not available".
 */

export interface DeliveryPayment {
  source: "receivables" | "zoho";
  /** Zoho's word ("paid", "partially_paid", "overdue"…) or the receivables status. */
  status: string | null;
  total: number;
  paid: number;
  balance: number;
  hasPending: boolean;
}

function num(v: Prisma.Decimal | number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "object" ? Number(v.toString()) : Number(v);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function deliveryPayment(
  delivery: { invoiceAmount: number; zohoPaymentStatus: string | null; zohoBalance: Prisma.Decimal | number | string | null },
  receivable: { amount: number; paidAmount: number; status: string } | null
): DeliveryPayment | null {
  if (receivable) {
    const balance = round2(receivable.amount - receivable.paidAmount);
    return {
      source: "receivables",
      status: receivable.status,
      total: round2(receivable.amount),
      paid: round2(receivable.paidAmount),
      balance,
      hasPending: balance > 0,
    };
  }
  const zb = num(delivery.zohoBalance);
  if (zb === null && !delivery.zohoPaymentStatus) return null;
  const balance = round2(zb ?? 0);
  const total = round2(delivery.invoiceAmount);
  return {
    source: "zoho",
    status: delivery.zohoPaymentStatus,
    total,
    paid: round2(Math.max(0, total - balance)),
    balance,
    hasPending: balance > 0,
  };
}
