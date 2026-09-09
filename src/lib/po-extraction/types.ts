/**
 * The shape a quotation extraction takes on the wire — plan 0909-po-ai-upload, P3.
 *
 * Types only, so the review screen can import them without dragging Prisma into the client
 * bundle. `store.ts` builds these on the server; `quotation-import.tsx` renders them.
 */

export type ExtractionMatchStatus = "AUTO" | "FUZZY" | "MANUAL" | "UNMATCHED";

export interface ExtractionProductView {
  id: string;
  name: string;
  sku: string;
  /** Absent for a caller without cost_price.view — the same gate /api/products/search applies. */
  costPrice?: number;
  gstRate: number;
  currentStock: number;
  reorderLevel: number;
  reservedStock: number;
}

export interface ExtractionItemView {
  id: string;
  rawName: string;
  rawSku: string | null;
  rawCategory: string | null;
  rawSize: string | null;
  qty: number | null;
  price: number | null;
  mrp: number | null;
  productId: string | null;
  matchStatus: string;
  matchConfidence: number | null;
  selected: boolean;
  orderQty: number | null;
  sortOrder: number;
  product: ExtractionProductView | null;
}

export interface ExtractionView {
  id: string;
  vendorId: string;
  vendorName: string;
  fileName: string;
  fileType: string;
  fileUrl: string | null;
  source: string;
  aiModel: string | null;
  totalItems: number;
  matchedItems: number;
  createdAt: string;
  items: ExtractionItemView[];
}
