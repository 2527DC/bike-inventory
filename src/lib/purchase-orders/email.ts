import type { EmailMessage } from "@/lib/notify/types";
import type { CompanyIdentity } from "./company";

export interface PoEmailInput {
  poNumber: string;
  orderDate: Date;
  expectedDate: Date | null;
  itemCount: number;
  grandTotal: number;
  vendorName: string;
  /** The buyer's own note, typed on the send sheet. Optional. */
  note?: string | null;
}

/**
 * The rupee sign is fine HERE.
 *
 * The PDF cannot draw it — jsPDF's built-in fonts are WinAnsi-encoded — but an email body is
 * UTF-8 and every mail client renders ₹. So the message uses the real symbol and the
 * attachment says "Rs.", which looks inconsistent side by side and is nonetheless the correct
 * answer in both places.
 */
function inr(amount: number): string {
  return `₹${new Intl.NumberFormat("en-IN", {
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

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The covering message a vendor reads before opening the attachment.
 *
 * Deliberately short. The purchase order IS the PDF; this exists so the email is not a bare
 * attachment from an unfamiliar address, and so the essentials — which order, how much, by
 * when — survive on a phone that will not open the PDF.
 *
 * `replyTo` is the notification `fromEmail`. `Store` has no email column, so there is nothing
 * more specific to fall back to; without this a reply goes to the SMTP account, which may be a
 * mailbox nobody reads.
 */
export function buildPoEmail(
  po: PoEmailInput,
  company: CompanyIdentity
): Pick<EmailMessage, "subject" | "text" | "html" | "replyTo"> {
  const subject = `Purchase Order ${po.poNumber} from ${company.name}`;

  const lines = [
    `Dear ${po.vendorName},`,
    "",
    `Please find our purchase order ${po.poNumber} attached as a PDF.`,
    "",
    `Order number: ${po.poNumber}`,
    `Date: ${shortDate(po.orderDate)}`,
    `Items: ${po.itemCount}`,
    `Total: ${inr(po.grandTotal)}`,
    ...(po.expectedDate ? [`Expected by: ${shortDate(po.expectedDate)}`] : []),
    ...(po.note ? ["", po.note] : []),
    "",
    "Please reply to confirm.",
    "",
    company.name,
    ...(company.phone ? [company.phone] : []),
    ...(company.gstin ? [`GSTIN ${company.gstin}`] : []),
  ];

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:14px">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`;

  // 600px single column, inline styles only. Mail clients strip <style> blocks and know
  // nothing of flexbox or grid; a table is what actually renders the same in Gmail, Outlook
  // and a phone.
  const html = `<div style="max-width:600px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <p style="font-size:15px;margin:0 0 16px">Dear ${escapeHtml(po.vendorName)},</p>
  <p style="font-size:15px;margin:0 0 20px">Please find our purchase order <strong>${escapeHtml(po.poNumber)}</strong> attached as a PDF.</p>
  <table style="border-collapse:collapse;margin:0 0 20px">
    ${row("Order number", po.poNumber)}
    ${row("Date", shortDate(po.orderDate))}
    ${row("Items", String(po.itemCount))}
    ${row("Total", inr(po.grandTotal))}
    ${po.expectedDate ? row("Expected by", shortDate(po.expectedDate)) : ""}
  </table>
  ${po.note ? `<p style="font-size:15px;margin:0 0 20px;padding:12px;background:#f8fafc;border-left:3px solid #cbd5e1;white-space:pre-wrap">${escapeHtml(po.note)}</p>` : ""}
  <p style="font-size:15px;margin:0 0 24px">Please reply to confirm.</p>
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;color:#64748b;font-size:13px">
    <div style="font-weight:600;color:#0f172a">${escapeHtml(company.name)}</div>
    ${company.phone ? `<div>${escapeHtml(company.phone)}</div>` : ""}
    ${company.gstin ? `<div>GSTIN ${escapeHtml(company.gstin)}</div>` : ""}
  </div>
</div>`;

  return {
    subject,
    text: lines.join("\n"),
    html,
    ...(company.email ? { replyTo: company.email } : {}),
  };
}
