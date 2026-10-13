// One Zoho customer credit note → this app (plan 1210 credit notes, Part 8.2).
//
// The sales-side mirror of src/lib/payables/sync-vendor-credit.ts, and deliberately much
// simpler: this app does not apply customer credit notes, so there is no `source`, no
// usedAmount and no bill to settle. Called by `api/zoho/pull-review/approve` for each approved
// `creditnote` preview.
//
// WHAT IT NEVER TOUCHES: `CustomerInvoice.paidAmount` and `Delivery.zohoBalance`. How a credit
// note shows on receivables is plan E's decision; this only records it and links it.
//
// Customer and store come from the invoice the note credits (Q11 = a): `Delivery` and
// `CustomerInvoice` are both unique by `invoiceNo`. Else the store from the Zoho location;
// else null. `Customer` has no Zoho id and is not given one here.
//
// No Zoho write (§6): one `GET /creditnotes/{id}` per note.
import { Prisma, type CustomerCreditNoteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { ZohoCreditNoteDetail } from "@/lib/integrations/books";
import { storeIdForLocation } from "@/lib/payables/store";
import {
  describeZohoCreditError,
  parseZohoTimestamp,
  zohoDate,
  toMoney,
  type SyncContext,
} from "@/lib/payables/sync-vendor-credit";

const log = createLogger("receivables:sync-credit-note");

export interface CreditNoteSyncResult {
  customerCreditNoteId: string | null;
  creditNoteNo: string;
  outcome: "created" | "updated" | "skipped";
  status: CustomerCreditNoteStatus | null;
  invoices: number;
  customerLinked: boolean;
  notices: string[];
}

function mapStatus(zohoStatus: string, creditNoteNo: string): CustomerCreditNoteStatus {
  switch ((zohoStatus || "").toLowerCase()) {
    case "open":
      return "OPEN";
    case "closed":
      return "CLOSED";
    case "void":
      return "VOID";
    default:
      log.warn("unknown credit note status — treated as open", { creditNoteNo, zohoStatus });
      return "OPEN";
  }
}

/** Pull one customer credit note and write it and its invoice links. Throws with a sentence. */
export async function syncCustomerCreditNote(
  zohoCreditNoteId: string,
  ctx: SyncContext,
): Promise<CreditNoteSyncResult> {
  try {
    return await syncOnce(zohoCreditNoteId, ctx);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String(e.meta?.target ?? "");
      // Two approves of one note at once: the loser re-runs and updates the winner's row.
      if (target.includes("zohoCreditNoteId") || target.includes("zohoInvoiceId")) {
        log.warn("credit note sync raced — running once more", { zohoCreditNoteId, target });
        try {
          return await syncOnce(zohoCreditNoteId, ctx);
        } catch (again) {
          return fail(zohoCreditNoteId, again);
        }
      }
    }
    return fail(zohoCreditNoteId, e);
  }
}

function fail(zohoCreditNoteId: string, e: unknown): never {
  const { message, missingScope } = describeZohoCreditError(e);
  if (missingScope) log.warn("credit note sync refused by Zoho — missing scope", { zohoCreditNoteId });
  else log.error("credit note sync failed", { zohoCreditNoteId, message });
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error(
      "This credit note's number is already used here by a different Zoho credit note — it may have been deleted and re-entered in Zoho. Check it by hand.",
    );
  }
  throw new Error(message);
}

async function syncOnce(zohoCreditNoteId: string, { books, locations }: SyncContext): Promise<CreditNoteSyncResult> {
  log.debug("-> creditnotes.get", { zohoCreditNoteId });
  const res = await books.getCreditNote(zohoCreditNoteId);
  const detail: ZohoCreditNoteDetail | undefined = res.creditnote;
  if (!detail) throw new Error(`Zoho returned no credit note for id ${zohoCreditNoteId}`);

  const creditNoteNo = detail.creditnote_number || zohoCreditNoteId;
  const notices: string[] = [];

  if ((detail.status || "").toLowerCase() === "draft") {
    log.info("credit note is a draft in Zoho — not imported", { zohoCreditNoteId });
    notices.push(`Credit note ${creditNoteNo} is a draft in Zoho — not imported. Open it in Zoho, then fetch again.`);
    return {
      customerCreditNoteId: null, creditNoteNo, outcome: "skipped", status: null,
      invoices: 0, customerLinked: false, notices,
    };
  }

  const status = mapStatus(detail.status, creditNoteNo);
  // A void note credits nothing, whatever Zoho still lists.
  const invoices = status === "VOID" ? [] : (detail.invoices ?? []).filter((i) => i.invoice_id);
  const invoiceNos = Array.from(new Set(invoices.map((i) => i.invoice_number).filter(Boolean)));

  // The invoices this note credits, as this app knows them. Both tables are unique by invoiceNo.
  const [deliveries, customerInvoices] = invoiceNos.length
    ? await Promise.all([
        prisma.delivery.findMany({
          where: { invoiceNo: { in: invoiceNos } },
          select: { id: true, invoiceNo: true, customerId: true, storeId: true },
        }),
        prisma.customerInvoice.findMany({
          where: { invoiceNo: { in: invoiceNos } },
          select: { id: true, invoiceNo: true, customerId: true },
        }),
      ])
    : [[], []];
  const deliveryByNo = new Map(deliveries.map((d) => [d.invoiceNo, d]));
  const invoiceByNo = new Map(customerInvoices.map((c) => [c.invoiceNo, c]));

  // Customer (Q11 = a): from the credited invoice. Two invoices of two different customers on one
  // note is not something Zoho allows; if it ever appears, the first wins and it is logged.
  const customerIds = new Set<string>();
  for (const no of invoiceNos) {
    const c = invoiceByNo.get(no)?.customerId ?? deliveryByNo.get(no)?.customerId;
    if (c) customerIds.add(c);
  }
  if (customerIds.size > 1) {
    log.warn("credit note credits invoices of more than one customer", { zohoCreditNoteId, customers: customerIds.size });
  }
  const derivedCustomer = customerIds.size > 0 ? [...customerIds][0] : null;

  // Store (§2.2): the store of the delivery it credits → the Zoho location → null.
  const deliveryStores = new Set(
    invoiceNos.map((no) => deliveryByNo.get(no)?.storeId).filter((s): s is string => !!s),
  );
  const derivedStore =
    (deliveryStores.size === 1 ? [...deliveryStores][0] : null) ??
    (await storeIdForLocation(detail.location_id, locations));

  for (const no of invoiceNos) {
    if (!deliveryByNo.has(no) && !invoiceByNo.has(no)) {
      notices.push(`Credit note ${creditNoteNo} credits invoice ${no}, which is not in the app — fetch it on /receivables`);
    }
  }

  const now = new Date();
  const outcome = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.customerCreditNote.findUnique({
        where: { zohoCreditNoteId },
        select: { id: true, customerId: true, storeId: true },
      });
      // Derived values win; a value already on the row stays when nothing could be derived.
      const customerId = derivedCustomer ?? existing?.customerId ?? null;
      const storeId = derivedStore ?? existing?.storeId ?? null;

      const fields = {
        creditNoteNo,
        referenceNo: detail.reference_number?.trim() || null,
        date: zohoDate(detail.date, `Credit note ${creditNoteNo}`),
        zohoCustomerId: detail.customer_id || "",
        customerName: detail.customer_name || "",
        customerId,
        storeId,
        total: toMoney(detail.total),
        balance: toMoney(detail.balance),
        status,
        zohoLocationId: detail.location_id || null,
        zohoLastModifiedAt: parseZohoTimestamp(detail.last_modified_time),
        lastSyncedAt: now,
      };
      const note = existing
        ? await tx.customerCreditNote.update({ where: { id: existing.id }, data: fields, select: { id: true } })
        : await tx.customerCreditNote.create({ data: { ...fields, zohoCreditNoteId }, select: { id: true } });

      // Applications: replaced from Zoho's invoices[]. Zoho gives no per-application id, so the
      // key is (note, Zoho invoice id).
      const keep = invoices.map((i) => i.invoice_id);
      await tx.customerCreditNoteApplication.deleteMany({
        where: { creditNoteId: note.id, zohoInvoiceId: { notIn: keep } },
      });
      for (const inv of invoices) {
        const data = {
          invoiceNo: inv.invoice_number || inv.invoice_id,
          amount: toMoney(inv.amount_applied ?? inv.amount),
          deliveryId: deliveryByNo.get(inv.invoice_number)?.id ?? null,
          customerInvoiceId: invoiceByNo.get(inv.invoice_number)?.id ?? null,
        };
        await tx.customerCreditNoteApplication.upsert({
          where: { creditNoteId_zohoInvoiceId: { creditNoteId: note.id, zohoInvoiceId: inv.invoice_id } },
          create: { ...data, creditNoteId: note.id, zohoInvoiceId: inv.invoice_id },
          update: data,
        });
      }

      return { id: note.id, created: !existing, customerId, storeId };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (status === "VOID") notices.push(`Credit note ${creditNoteNo} is void in Zoho`);
  if (!outcome.customerId && status !== "VOID") {
    notices.push(`Customer not known for ${creditNoteNo} — kept under Zoho's name "${detail.customer_name || "?"}"`);
  }

  log.info("customer credit note synced", {
    customerCreditNoteId: outcome.id,
    zohoCreditNoteId,
    status,
    created: outcome.created,
    invoices: invoices.length,
    customerLinked: !!outcome.customerId,
    storeLinked: !!outcome.storeId,
  });

  return {
    customerCreditNoteId: outcome.id,
    creditNoteNo,
    outcome: outcome.created ? "created" : "updated",
    status,
    invoices: invoices.length,
    customerLinked: !!outcome.customerId,
    notices,
  };
}
