export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { customerUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:id");

/** Invoices returned with a customer. Past this, the screen says so and links to /receivables. */
const INVOICE_LIMIT = 100;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("customers", "view");
    const { id } = await params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: {
          select: {
            id: true, invoiceNo: true, amount: true, paidAmount: true,
            status: true, invoiceDate: true, dueDate: true,
          },
          // Oldest due first — the collection order. The consultant's rule is that nothing
          // sits unpursued past 30 days, so the row that needs chasing must be the first one
          // on screen, not the newest.
          orderBy: { dueDate: "asc" },
          // BOUNDED. This used to load every invoice a customer had ever had, which was
          // harmless while nothing called the route and would not have stayed harmless for
          // a dealer. `_count` below still reports the true total, so a capped list can say
          // so honestly instead of quietly under-reporting.
          take: INVOICE_LIMIT,
        },
        _count: { select: { invoices: true, payments: true } },
      },
    });

    if (!customer) return errorResponse("Customer not found", 404);

    // ── The outstanding total is AGGREGATED, not summed over the rows above ──────────────
    //
    // Two reasons, and both are correctness rather than performance:
    //
    //   1. `invoices` is capped now. Summing it would report the balance of the first 100
    //      invoices and call it the customer's balance.
    //   2. It must use the SAME RULE as the list screen — `status != PAID` — or the figure
    //      on the customer row and the figure on this screen disagree for any overpaid
    //      invoice (paidAmount > amount, status PAID), and then neither can be trusted.
    //
    // A negative result is real and is NOT clamped: it means the customer has paid more
    // than they owe, which is a credit the screen must show, not hide behind a zero.
    const owed = await prisma.customerInvoice.aggregate({
      where: { customerId: id, status: { not: "PAID" } },
      _sum: { amount: true, paidAmount: true },
    });
    const totalOutstanding = (owed._sum.amount ?? 0) - (owed._sum.paidAmount ?? 0);

    return successResponse({
      ...customer,
      totalOutstanding,
      /** True when `invoices` is a capped window over `_count.invoices`. */
      invoicesTruncated: customer._count.invoices > customer.invoices.length,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const msg = error instanceof Error ? error.message : "Failed to fetch customer";
    log.error("customer fetch failed", { message: msg });
    return errorResponse(msg, 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("customers", "edit");
    const { id } = await params;
    const body = await req.json();
    const data = customerUpdateSchema.parse(body);

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return errorResponse("Customer not found", 404);

    // Phone is `@unique` — it IS the customer's identity, shared by the counter and the
    // workshop. Editing one onto a number another customer already holds must be refused
    // by NAME, here. Letting Prisma raise P2002 instead would answer the employee's phone
    // with "Unique constraint failed on the fields: (`phone`)", which names a database
    // constraint rather than the person they have just collided with.
    if (data.phone !== undefined && data.phone !== existing.phone) {
      const clash = await prisma.customer.findUnique({
        where: { phone: data.phone },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== id) {
        log.warn("phone edit refused, already held", { customerId: id, clashId: clash.id });
        return errorResponse(`${clash.name} already uses that phone number`, 409);
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        // `whatsapp` was in customerUpdateSchema and rendered on the list, but never
        // applied here — so editing it appeared to save and silently did not. The empty
        // string clears it, matching how POST treats the same field.
        ...(data.whatsapp !== undefined && { whatsapp: data.whatsapp || null }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.type !== undefined && { type: data.type }),
      },
    });

    // Identifiers only — never the record. A name and a phone number in a log line is
    // customer data sitting somewhere it was never meant to be read.
    log.info("customer updated", { customerId: id, fields: Object.keys(data) });
    return successResponse(customer);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const msg = error instanceof Error ? error.message : "Failed to update customer";
    log.error("customer update failed", { message: msg });
    return errorResponse(msg, 400);
  }
}
