export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { inboundIssueSchema } from "@/lib/validations";
import { nextSequence } from "@/lib/sequence";
import { issSeedSql } from "@/lib/vendor-issues/sequence";
import { logActivity } from "@/lib/activity-log";
import { createLogger } from "@/lib/logger";

const log = createLogger("inbound:issues");

/**
 * Report Issue on a receiving line.
 *
 * ─── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────────────────
 *
 * The button on `/inbound/[id]` posted straight to `POST /api/vendor-issues` and had never
 * written a row, for three compounding reasons:
 *
 *   1. The button is shown to whoever holds `inbound.edit` — the person at the goods desk —
 *      but the endpoint it called demands `vendor_issues.create`, which no seeded role holds
 *      alongside inbound.edit. Every click was a 403.
 *   2. It sent `vendorId: shipment.vendorBill?.vendorId`, so a shipment entered by hand
 *      (no Zoho bill, and that is most of them) sent `undefined` and was answered with
 *      "Vendor is required for vendor issues", a 400.
 *   3. So nothing was ever written, and a shortage noticed at the door never reached the
 *      brand.
 *
 * The guard here is `inbound.edit` ON PURPOSE. Reporting what arrived is part of receiving;
 * chasing the brand afterwards is what `vendor_issues` grants. The row this creates is an
 * ordinary VendorIssue and every screen downstream of it is still gated on vendor_issues.
 *
 * The vendor is resolved SERVER-SIDE from the shipment, so cause (2) cannot come back: the
 * client no longer has a say in it.
 */

/** A rejection carrying the status it should answer with, thrown from inside the transaction. */
class InboundIssueError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InboundIssueError";
    this.status = status;
  }
}

type IssueInput = z.infer<typeof inboundIssueSchema>;

/**
 * The middle clause of the description — what the brand is being told went wrong.
 *
 * SHORTAGE and DAMAGE carry a count (the schema requires `issueQty` for exactly those two),
 * so they read back a number the brand can check against its own dispatch note. The rest are
 * a plain label.
 */
function issueDescription(
  issueType: IssueInput["issueType"],
  issueQty: number | undefined,
  billedQty: number
): string {
  switch (issueType) {
    case "SHORTAGE":
      return `Short by ${issueQty} of ${billedQty}`;
    case "DAMAGE":
      return `${issueQty} damaged`;
    case "WRONG_ITEM":
      return "Wrong item";
    case "QUALITY":
      return "Quality";
    case "BILLING_ERROR":
      return "Billing error";
    case "DELIVERY_DELAY":
      return "Delivery delay";
    default:
      return "Other";
  }
}

/** A vendor code in the shape the Zoho import mints one: 6 alphanumerics + 4 digits of now. */
function vendorCodeFor(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 6)
      .toUpperCase() + String(Date.now()).slice(-4)
  );
}

// POST: raise a VendorIssue against one line of this shipment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let shipmentId: string | undefined;

  try {
    const user = await requireFeature("inbound", "edit");
    const { id } = await params;
    shipmentId = id;

    const data = inboundIssueSchema.parse(await req.json());

    // ISS-YYYYMM, restarting each month — the same key the Ops Issues screen allocates on.
    const now = new Date();
    const key = `ISS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    // ONE transaction: the vendor (when it has to be created), the number, the issue and its
    // activity entry all land together. Allocating outside it would burn a number whenever
    // the create failed, and `issueNo` is @unique so a burnt number is not free.
    const result = await prisma.$transaction(async (tx) => {
      const shipment = await tx.inboundShipment.findUnique({
        where: { id },
        select: {
          id: true,
          shipmentNo: true,
          billNo: true,
          vendorBillId: true,
          vendorBill: { select: { vendorId: true } },
          brand: { select: { id: true, name: true } },
        },
      });
      if (!shipment) throw new InboundIssueError("Shipment not found", 404);

      const lineItem = await tx.inboundLineItem.findUnique({
        where: { id: data.lineItemId },
        select: {
          id: true,
          shipmentId: true,
          productName: true,
          quantity: true,
        },
      });
      if (!lineItem) throw new InboundIssueError("Line item not found", 404);
      if (lineItem.shipmentId !== shipment.id) {
        throw new InboundIssueError(
          "That line item belongs to a different shipment",
          400
        );
      }

      // ── WHO THE ISSUE IS AGAINST ──
      //
      // Three steps, in this order, and the third is what makes the button work at all for a
      // hand-entered shipment. A shipment always names a Brand; a Vendor is the accounting
      // side of the same company, and the two tables are joined by name and nothing else.
      let vendorId = shipment.vendorBill?.vendorId ?? null;

      if (!vendorId) {
        const byName = await tx.vendor.findFirst({
          where: { name: { equals: shipment.brand.name, mode: "insensitive" } },
          select: { id: true },
        });
        vendorId = byName?.id ?? null;
      }

      if (!vendorId) {
        // Mirrors the find-or-create in api/zoho/pull-review/approve — an unknown brand must
        // not stop the goods desk recording what actually turned up.
        const created = await tx.vendor.create({
          data: {
            name: shipment.brand.name,
            code: vendorCodeFor(shipment.brand.name),
          },
          select: { id: true },
        });
        vendorId = created.id;
        log.info("vendor auto-created for inbound issue", {
          vendorId,
          brandId: shipment.brand.id,
          shipmentId: shipment.id,
        });
      }

      const issueNo = `${key}-${await nextSequence(tx, key, 4, issSeedSql(key))}`;

      const what = issueDescription(
        data.issueType,
        data.issueQty,
        lineItem.quantity
      );
      const notes = data.notes?.trim();
      const description =
        `[INBOUND] ${lineItem.productName} — ${what}` +
        (notes ? ` — ${notes}` : "") +
        ` | Bill: ${shipment.billNo} | Shipment: ${shipment.shipmentNo}`;

      // A shortage or damaged goods costs money and has a clock on it with the brand.
      // Everything else takes the model default (MEDIUM), so `priority` is left unset.
      const isUrgent =
        data.issueType === "SHORTAGE" || data.issueType === "DAMAGE";

      const issue = await tx.vendorIssue.create({
        data: {
          issueSource: "VENDOR",
          vendorId,
          issueNo,
          issueType: data.issueType,
          description,
          billId: shipment.vendorBillId ?? null,
          createdById: user.id,
          ...(isUrgent ? { priority: "HIGH" as const } : {}),
        },
        select: { id: true, issueNo: true },
      });

      const qty = data.issueQty ?? lineItem.quantity;

      // In-transaction, so this THROWS on failure by design: an issue raised against a brand
      // with no record of who raised it is worse than a failed click.
      await logActivity(tx, {
        module: "vendor_issues",
        action: "issue_reported",
        entityType: "VendorIssue",
        entityId: issue.id,
        entityRef: issue.issueNo,
        details: `${shipment.shipmentNo} · ${lineItem.productName} ×${qty} ${data.issueType}`,
        userId: user.id,
        userName: user.name,
      });

      return { id: issue.id, issueNo: issue.issueNo, vendorId };
    });

    log.info("inbound issue reported", {
      shipmentId: id,
      lineItemId: data.lineItemId,
      issueId: result.id,
      issueNo: result.issueNo,
      vendorId: result.vendorId,
      issueType: data.issueType,
    });

    return successResponse({ id: result.id, issueNo: result.issueNo }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("inbound issue refused", {
        shipmentId,
        status: error.status,
        message: error.message,
      });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof InboundIssueError) {
      log.warn("inbound issue rejected", {
        shipmentId,
        status: error.status,
        message: error.message,
      });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid issue details";
      log.warn("inbound issue failed validation", { shipmentId, message });
      return errorResponse(message, 400);
    }
    // failure() writes the message and the first stack frames to the server log before
    // answering, so a 500 here is diagnosable from the log alone.
    return failure(error, { scope: "inbound:issues", shipmentId });
  }
}
