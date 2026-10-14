import { Prisma, type PrismaClient } from "@prisma/client";
import { customerInvoiceSchema } from "@/lib/validations";
import { findOrCreateCustomerByPhone } from "@/lib/customers/find-or-create-by-phone";
import { toPlus91 } from "@/lib/phone";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:zoho-receivable");

/** What a Zoho invoice preview carries that a receivable needs (written by zoho/trigger-pull). */
export interface ZohoInvoiceForReceivable {
  invoiceNumber: string;
  customerName: string;
  phone: string;
  /** YYYY-MM-DD, as Zoho lists it. */
  date: string;
  total: number;
  balance: number;
}

export type ReceivableImportOutcome =
  | { ok: true; invoiceCreated: boolean; customerCreated: boolean; customerId: string }
  | { ok: false; reason: string };

/** Credit given on an imported invoice — the figure the /receivables import has always used. */
const CREDIT_DAYS = 30;

/**
 * One Zoho invoice into the receivables ledger: its customer by phone, then a CustomerInvoice —
 * once.
 *
 * Moved from the browser into the server by plan 1410-per-module-fetch-permissions (Q1), so the
 * screen's Fetch tick alone can import. The page used to make these writes itself through
 * `POST /api/customers` and `POST /api/customer-invoices` — three requests per invoice, both
 * gated on `customers.create`.
 *
 * Kept from the page: due 30 days after the invoice date, the Zoho balance in the notes, the
 * invoice validated by `customerInvoiceSchema`. Two things are deliberately better:
 * - The customer goes through `findOrCreateCustomerByPhone` (plan 1609), which matches a phone
 *   stored either as `+91-XXXXXXXXXX` (the deliveries flow) or bare 10 digits (this import,
 *   until now). The page's route looked up the bare form only, so a customer first met at
 *   delivery was created a second time here. A NEW customer is written `+91-`, as that helper
 *   writes every new row.
 * - "Already imported" is the invoice number EXACTLY (`invoiceNo` is unique). The page asked the
 *   list's free-text search, which also matched longer numbers merely containing this one.
 */
export async function importZohoReceivable(
  db: PrismaClient,
  inv: ZohoInvoiceForReceivable
): Promise<ReceivableImportOutcome> {
  if (!toPlus91(inv.phone)) return { ok: false, reason: "no customer phone on the invoice" };

  const due = new Date(inv.date);
  if (Number.isNaN(due.getTime())) return { ok: false, reason: `invoice date "${inv.date}" is not a date` };
  due.setUTCDate(due.getUTCDate() + CREDIT_DAYS);

  // The helper uses a savepoint, so it must run inside a transaction; the customer and the
  // invoice commit together or not at all.
  return db.$transaction(async (tx) => {
    const customer = await findOrCreateCustomerByPhone(tx, { name: inv.customerName, phone: inv.phone });
    const customerCreated = !customer.alreadyExisted;

    const already = await tx.customerInvoice.findUnique({
      where: { invoiceNo: inv.invoiceNumber },
      select: { id: true },
    });
    if (already) {
      log.debug("receivable already imported", { invoiceNo: inv.invoiceNumber, customerInvoiceId: already.id });
      return { ok: true as const, invoiceCreated: false, customerCreated, customerId: customer.id };
    }

    const parsed = customerInvoiceSchema.safeParse({
      customerId: customer.id,
      invoiceNo: inv.invoiceNumber,
      invoiceDate: inv.date,
      dueDate: due.toISOString().slice(0, 10),
      amount: inv.total,
      notes: `Imported from Zoho. Balance: ₹${inv.balance}`,
    });
    if (!parsed.success) {
      return { ok: false as const, reason: parsed.error.issues[0]?.message ?? "invoice details are not usable" };
    }
    const data = parsed.data;

    try {
      await tx.$executeRaw`SAVEPOINT receivable_create`;
      await tx.customerInvoice.create({
        data: {
          customerId: data.customerId,
          invoiceNo: data.invoiceNo,
          invoiceDate: new Date(data.invoiceDate),
          dueDate: new Date(data.dueDate),
          amount: data.amount,
          notes: data.notes,
        },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT receivable_create`;
    } catch (e) {
      // The same invoice imported by someone else at the same moment: the unique number refuses
      // the second insert, and that is an "already imported", not a failure.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT receivable_create`;
        log.warn("receivable created by a concurrent import", { invoiceNo: inv.invoiceNumber });
        return { ok: true as const, invoiceCreated: false, customerCreated, customerId: customer.id };
      }
      log.error("receivable create failed", {
        invoiceNo: inv.invoiceNumber,
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
    return { ok: true as const, invoiceCreated: true, customerCreated, customerId: customer.id };
  });
}
