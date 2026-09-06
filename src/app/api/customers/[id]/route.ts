export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { customerUpdateSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { logActivity } from "@/lib/activity-log";

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
    const user = await requireFeature("customers", "edit");
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

    // Which fields actually moved. Compared against the stored row rather than read off the
    // request body, because the edit sheet submits every field it renders.
    const nextWhatsapp = data.whatsapp !== undefined ? data.whatsapp || null : existing.whatsapp;
    const nextEmail = data.email !== undefined ? data.email || null : existing.email;
    const changed: string[] = [];
    if (data.name !== undefined && data.name !== existing.name) changed.push("name");
    if (data.phone !== undefined && data.phone !== existing.phone) changed.push("phone");
    if (nextWhatsapp !== existing.whatsapp) changed.push("whatsapp");
    if (nextEmail !== existing.email) changed.push("email");
    if (data.address !== undefined && data.address !== existing.address) changed.push("address");
    if (data.type !== undefined && data.type !== existing.type) changed.push("type");

    const customer = await prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.phone !== undefined && { phone: data.phone }),
          // `whatsapp` was in customerUpdateSchema and rendered on the list, but never
          // applied here — so editing it appeared to save and silently did not. The empty
          // string clears it, matching how POST treats the same field.
          ...(data.whatsapp !== undefined && { whatsapp: nextWhatsapp }),
          ...(data.email !== undefined && { email: nextEmail }),
          ...(data.address !== undefined && { address: data.address }),
          ...(data.type !== undefined && { type: data.type }),
        },
      });

      // FIELD NAMES, NEVER VALUES (plan §5.3). The activity feed is readable by anyone holding
      // activity.view, a wider audience than customers.view, so the old and new phone number
      // must not go in `fromValue`/`toValue` — that would publish contact details to people
      // with no grant to read them.
      //
      // The customer's NAME is the exception and is deliberate: the feed already prints it on
      // every delivery row (`${invoiceNo} — ${customerName}`), so it discloses nothing new,
      // and without it the row reads "someone changed a customer's phone" and names no
      // customer, which nobody can act on. The post-update name, so a rename shows the row
      // under what the customer is called now.
      if (changed.length > 0) {
        await logActivity(tx, {
          module: "customers",
          action: "updated",
          entityType: "Customer",
          entityId: id,
          entityRef: row.name,
          details: `Changed ${changed.join(", ")}`,
          userId: user.id,
          userName: user.name,
        });
      }

      return row;
    });

    // Identifiers only — never the record. A name and a phone number in a log line is
    // customer data sitting somewhere it was never meant to be read.
    log.info("customer updated", { customerId: id, fields: changed });
    return successResponse(customer);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const msg = error instanceof Error ? error.message : "Failed to update customer";
    log.error("customer update failed", { message: msg });
    return errorResponse(msg, 400);
  }
}
