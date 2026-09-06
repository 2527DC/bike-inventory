// ⚠ SERVER ONLY. Do not import this from a client component.
//
// There is no `import "server-only"` guard because that package is not installed here (tsc
// resolves the specifier under moduleResolution: "bundler" and the BUILD then fails on it —
// checked, not assumed). So the rule is enforced by this comment and by the fact that only a
// route handler imports it.
//
// What breaks if that slips: jspdf's node build statically requires `fs`, `path`, `canvg`,
// `html2canvas` and `dompurify`. In a browser bundle the node builtins fail outright, and the
// 350 KB CJS build ships to every visitor on the way there.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { createLogger } from "@/lib/logger";
import type { CompanyIdentity } from "./company";

const log = createLogger("purchase-orders:pdf");

export interface PoPdfLine {
  sku: string;
  name: string;
  hsnCode: string | null;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  /** The STORED amount. Never recomputed here — see the note in renderPurchaseOrderPdf. */
  amount: number;
}

export interface PoPdfInput {
  poNumber: string;
  orderDate: Date;
  expectedDate: Date | null;
  notes: string | null;
  deliveryAddress: string | null;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  approvedByName: string | null;
  approvedAt: Date | null;
  vendor: {
    name: string;
    code: string;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    gstin: string | null;
    phone: string | null;
    contactName: string | null;
  };
  items: PoPdfLine[];
}

/**
 * "Rs. 1,23,456.00".
 *
 * NOT the ₹ sign, and not `style: "currency"`. jsPDF's fourteen built-in fonts are WinAnsi
 * (cp1252) encoded and U+20B9 has no slot in that table, so a ₹ renders as a wrong glyph or
 * nothing at all. Embedding a Unicode TTF would fix it and add roughly 300 KB to every PDF;
 * the only font asset in this repo is a woff2, which jsPDF cannot embed anyway.
 *
 * The existing client-side exporter has this bug today — `purchase-orders/page.tsx`,
 * `bills/page.tsx` and `vendor-ledger/page.tsx` all feed literal ₹ into `exportToPDF`.
 *
 * Two decimals, unlike the app's `formatINR` which uses maximumFractionDigits: 0. A purchase
 * order is a financial document a vendor reconciles against; rounding to whole rupees on the
 * page while the database holds paise is how a ₹0.50 disagreement becomes an argument.
 */
function rs(amount: number): string {
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function shortDate(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/**
 * Render a purchase order as a PDF.
 *
 * Server only — see the note at the top of this file.
 *
 * `doc.output("arraybuffer")`, never `doc.save()`. On the node build `save` calls
 * `require("fs")` and writes to the server's filesystem, which is not what a route wants.
 *
 * ─── THE AMOUNTS ARE READ, NOT RECOMPUTED ────────────────────────────────────────────────
 *
 * `item.amount`, `subtotal`, `gstTotal` and `grandTotal` all come from the stored row. A
 * document sent to a vendor must say what the purchase order says; recomputing here would let
 * a rounding difference, or a later change to how totals are derived, produce a PDF that
 * disagrees with the record it claims to represent — and the vendor would be holding the
 * version nobody can reproduce.
 */
export async function renderPurchaseOrderPdf(
  po: PoPdfInput,
  company: CompanyIdentity
): Promise<Buffer> {
  const started = Date.now();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const M = 14; // margin, mm
  const pageW = doc.internal.pageSize.getWidth();
  const rightX = pageW - M;
  let y = M;

  // ─── company block, left ────────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(company.name, M, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  let cy = y + 6;
  // Each line only when it exists. Until somebody fills the store form in, this is a name and
  // nothing else — which reads as an incomplete document, because it is one.
  for (const line of [company.address, company.phone, company.gstin ? `GSTIN ${company.gstin}` : null]) {
    if (!line) continue;
    for (const wrapped of doc.splitTextToSize(line, 90) as string[]) {
      doc.text(wrapped, M, cy);
      cy += 4.2;
    }
  }

  // ─── document block, right ──────────────────────────────────────────────────────────────
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("PURCHASE ORDER", rightX, y, { align: "right" });

  doc.setFontSize(11);
  doc.text(po.poNumber, rightX, y + 7, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`Date: ${shortDate(po.orderDate)}`, rightX, y + 12.5, { align: "right" });
  if (po.expectedDate) {
    doc.text(`Expected by: ${shortDate(po.expectedDate)}`, rightX, y + 17, { align: "right" });
  }

  y = Math.max(cy, y + 22) + 4;

  // ─── vendor block ───────────────────────────────────────────────────────────────────────
  doc.setDrawColor(220);
  doc.line(M, y, rightX, y);
  y += 6;

  doc.setTextColor(120);
  doc.setFontSize(8);
  doc.text("TO", M, y);

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`${po.vendor.name} (${po.vendor.code})`, M, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  let vy = y + 10;
  const vendorAddress = [po.vendor.address, po.vendor.city, po.vendor.state, po.vendor.pincode]
    .filter(Boolean)
    .join(", ");
  for (const line of [
    vendorAddress || null,
    po.vendor.gstin ? `GSTIN ${po.vendor.gstin}` : null,
    po.vendor.contactName ? `Attn: ${po.vendor.contactName}` : null,
    po.vendor.phone,
  ]) {
    if (!line) continue;
    for (const wrapped of doc.splitTextToSize(line, 110) as string[]) {
      doc.text(wrapped, M, vy);
      vy += 4.2;
    }
  }

  y = vy + 4;

  // ─── items ──────────────────────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [["#", "SKU", "Description", "HSN", "Qty", "Rate", "GST %", "Amount"]],
    body: po.items.map((it, i) => [
      String(i + 1),
      it.sku,
      it.name,
      it.hsnCode ?? "—",
      String(it.quantity),
      rs(it.unitPrice),
      `${it.gstRate}%`,
      rs(it.amount),
    ]),
    styles: { fontSize: 8, cellPadding: 1.8, textColor: 40, lineColor: 225, lineWidth: 0.1 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      1: { cellWidth: 24 },
      3: { cellWidth: 16 },
      4: { cellWidth: 12, halign: "right" },
      5: { cellWidth: 24, halign: "right" },
      6: { cellWidth: 14, halign: "right" },
      7: { cellWidth: 26, halign: "right" },
    },
  });

  // autoTable stashes where it finished on the doc. The cast is because its type augmentation
  // is not picked up under this project's moduleResolution.
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;

  // ─── totals, right-aligned ──────────────────────────────────────────────────────────────
  const labelX = rightX - 40;
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text("Subtotal", labelX, y, { align: "right" });
  doc.setTextColor(0);
  doc.text(rs(po.subtotal), rightX, y, { align: "right" });

  doc.setTextColor(90);
  doc.text("GST", labelX, y + 5, { align: "right" });
  doc.setTextColor(0);
  doc.text(rs(po.gstTotal), rightX, y + 5, { align: "right" });

  doc.setDrawColor(200);
  doc.line(labelX - 20, y + 8, rightX, y + 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Grand Total", labelX, y + 14, { align: "right" });
  doc.text(rs(po.grandTotal), rightX, y + 14, { align: "right" });
  doc.setFont("helvetica", "normal");

  y += 24;

  // ─── delivery address, notes, approval ──────────────────────────────────────────────────
  doc.setFontSize(9);
  for (const [label, value] of [
    ["Deliver to", po.deliveryAddress],
    ["Notes", po.notes],
  ] as const) {
    if (!value) continue;
    doc.setTextColor(120);
    doc.text(label, M, y);
    doc.setTextColor(40);
    const wrapped = doc.splitTextToSize(value, pageW - 2 * M) as string[];
    doc.text(wrapped, M, y + 4.5);
    y += 4.5 + wrapped.length * 4.2 + 4;
  }

  if (po.approvedByName) {
    doc.setTextColor(90);
    doc.setFontSize(9);
    doc.text(`Approved by ${po.approvedByName} on ${shortDate(po.approvedAt)}`, M, y);
    y += 6;
  }

  // ─── page footer, every page ────────────────────────────────────────────────────────────
  // Written last, because the page count is only known once the table has flowed.
  const pages = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(po.poNumber, M, pageH - 8);
    doc.text(`Page ${p} of ${pages}`, rightX, pageH - 8, { align: "right" });
  }

  const buffer = Buffer.from(doc.output("arraybuffer"));
  log.debug("purchase order pdf rendered", {
    poNumber: po.poNumber,
    lines: po.items.length,
    pages,
    bytes: buffer.byteLength,
    ms: Date.now() - started,
  });
  return buffer;
}
