export interface LineItem {
  name: string;
  sku: string;
  quantity: number;
  rate: number;
  itemTotal?: number;
}

export interface DeliveryData {
  id: string;
  invoiceNo: string;
  zohoInvoiceId: string | null;
  invoiceDate: string;
  invoiceAmount: number;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerArea: string | null;
  customerPincode: string | null;
  alternatePhone: string | null;
  status: string;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
  scheduledDate: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  expectedReadyDate: string | null;
  prebookNotes: string | null;
  flagReason: string | null;
  flaggedAt: string | null;
  lineItems: LineItem[] | null;
  notes: string | null;
  deliveryNotes: string | null;
  whatsAppScheduledSent: boolean;
  whatsAppDispatchedSent: boolean;
  whatsAppDeliveredSent: boolean;
  freeAccessories: string | null;
  reversePickup: boolean;
  googleReviewLink: string | null;
  invoiceType: string | null;
  isOutstation: boolean;
  courierName: string | null;
  courierTrackingNo: string | null;
  vehicleNo: string | null;
  courierCost: number | null;
  paymentStatus: {
    hasPending: boolean;
    balance: number;
    paidAmount: number;
    totalAmount: number;
  } | null;
  salesPerson: string | null;
  selfFillToken: string | null;
  selfFillCompletedAt: string | null;
  mapsLink: string | null;
  /** The matched FLOOR warehouse; null on a Dummy and on old closed rows (plan 1609 T2). */
  warehouse: { id: string; name: string; kind: string } | null;
  /** Server-derived: an open delivery with no warehouse. No action is allowed on it (A41c). */
  isDummy: boolean;
  /** Set when every line is held on the floor (T5); null = not held. */
  stockReservedAt: string | null;
}

/** One line the floor warehouse cannot hold or hand over (plan 1609 §1.3). */
export interface StockShortLine {
  name: string;
  sku: string;
  available: number;
  needed: number;
}

/** Statuses in which a delivery's stock is expected to be held on the floor (T5). */
export const HOLD_STATUSES = ["SCHEDULED", "PACKED", "OUT_FOR_DELIVERY", "SHIPPED", "IN_TRANSIT"];

/** "Not reserved" is derived, never stored (T5). A Dummy is never reported as not reserved. */
export function isStockNotReserved(d: Pick<DeliveryData, "status" | "stockReservedAt" | "isDummy">) {
  return HOLD_STATUSES.includes(d.status) && !d.stockReservedAt && !d.isDummy;
}

/** Walk-out is offered only before scheduling — the same rule detail-actions always used. */
export const WALKOUT_STATUSES = ["PENDING", "VERIFIED"];

export function formatINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// Inside Bangalore: simpler flow, no "Out" step
export const BANGALORE_STEPS = ["PENDING", "SCHEDULED", "DELIVERED"];
// Outside Bangalore (outstation): full flow with dispatch
export const OUTSTATION_STEPS = ["PENDING", "SCHEDULED", "OUT_FOR_DELIVERY", "DELIVERED"];
// Courier outstation: packed -> shipped -> transit -> delivered
export const COURIER_STEPS = ["VERIFIED", "PACKED", "SHIPPED", "IN_TRANSIT", "DELIVERED"];
