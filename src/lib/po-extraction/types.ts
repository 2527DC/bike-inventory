/**
 * The shape a sheet extraction takes on the wire — plan 0909-po-sheet-ai-extraction-and-
 * catalogue-free-lines, §3.2–3.5. Rewritten 9 Sep 2026 from the quotation-import shape:
 * there is no product match any more (D2) — a row is what the sheet said, and only its item
 * name and quantity travel to the PO line.
 *
 * Types only, so the screen can import them without dragging Prisma into the client bundle.
 * `store.ts` builds these on the server; `sheet-review.tsx` and `columns-step.tsx` render them.
 */

/** What a sheet column is for. The AI proposes one per column; the person confirms. */
export type ColumnRole =
  | "itemName"
  | "quantity"
  | "itemCode"
  | "price"
  | "mrp"
  | "size"
  | "uom"
  | "hsn"
  | "category"
  | "brand"
  | "other"
  | "ignore";

export const COLUMN_ROLES: ColumnRole[] = [
  "itemName", "quantity", "itemCode", "price", "mrp", "size", "uom", "hsn", "category", "brand", "other", "ignore",
];

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  itemName: "Item name",
  quantity: "Quantity",
  itemCode: "Item code",
  price: "Price",
  mrp: "MRP",
  size: "Size",
  uom: "Unit",
  hsn: "HSN",
  category: "Category",
  brand: "Brand",
  other: "Other (show)",
  ignore: "Ignore",
};

export interface ColumnProposal {
  /** 0-based column index in the sheet. */
  index: number;
  /** The header cell's text, "" when blank. */
  header: string;
  role: ColumnRole;
}

export interface LegendEntry {
  /** Six hex digits, upper case, no '#'. */
  rgb: string;
  label: string;
}

/** One sheet's column proposal (from the AI) or confirmation (from the person). */
export interface SheetColumns {
  sheet: string;
  /** 0-based row index of the header row. */
  headerRow: number;
  columns: ColumnProposal[];
  /** Read from the sheet when it has a legend block; the AI names it, code verifies the fills. */
  legend?: LegendEntry[];
  /** The first rows of the sheet, for the person to see while confirming. Never more than 25. */
  preview?: string[][];
  /** Count of rows below the header, so the person knows the sheet's size before extracting. */
  dataRowEstimate?: number;
}

/** What the person sends back — the same shape minus preview, every column with a role. */
export interface SheetColumnsConfirm {
  sheet: string;
  headerRow: number;
  columns: Array<{ index: number; role: ColumnRole }>;
}

export interface ExtractionItemView {
  id: string;
  sheetName: string | null;
  /** 0-based row index in its sheet, for "row 42 of Pargaon WH". */
  rowIndex: number | null;
  /** The item name — the only text that reaches the PO line (D2). */
  name: string;
  /** The sheet's quantity column when it has one — prefills the line's Qty (D2). */
  quantity: number | null;
  /** The item-name cell's fill, six hex digits, or null. */
  rowColor: string | null;
  /** The legend label for rowColor, when the sheet has a legend that names it. */
  legendLabel: string | null;
  /** Every non-ignored column in the sheet's order — what the review SHOWS. */
  columns: Array<{ header: string; value: string }>;
  selected: boolean;
  sortOrder: number;
}

export type ExtractionStage = "columns" | "review";

export interface ExtractionView {
  id: string;
  vendorId: string;
  vendorName: string;
  fileName: string;
  fileType: string;
  fileUrl: string | null;
  /** "sheet" — deterministic read after the column step; "ai" — the rescue path or a PDF/image. */
  source: string;
  aiModel: string | null;
  stage: ExtractionStage;
  /** Present from the column step on; the confirmed roles once the person has pressed Extract. */
  sheets: SheetColumns[];
  legend: LegendEntry[];
  totalItems: number;
  createdAt: string;
  /** Empty while stage === "columns". */
  items: ExtractionItemView[];
}

/** The line the review hands to the vendor section — Qty, price and GST are typed there (R8). */
export interface SheetLine {
  /** The extraction item id; the React key and the dedupe key. */
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
}
