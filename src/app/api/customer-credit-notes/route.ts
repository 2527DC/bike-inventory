export const dynamic = "force-dynamic";

// GET /api/customer-credit-notes — customer credit notes pulled from Zoho Books (plan 1210 credit
// notes, Part 8.3). Read-only: notes are typed in Zoho and arrive through the pull (D3). Built for
// plan E's receivables screens, which decide how a note shows against what a customer owes.
//
//   ?customerId=<id>        notes linked to this customer (through the invoice they credit)
//   ?invoiceNo=<no>         notes that credit this invoice
//   ?storeId=<id>|none      one store, or the notes whose store is not known
//   ?status=OPEN|CLOSED|VOID|all   default: all
//   ?page=1&limit=50
import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { errorResponse, paginatedResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("receivables:credit-notes");

const QuerySchema = z.object({
  customerId: z.string().trim().min(1).max(64).optional(),
  invoiceNo: z.string().trim().min(1).max(64).optional(),
  storeId: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["OPEN", "CLOSED", "VOID", "all"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    await requireFeature("customers", "view");

    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join(".") || "query"}: ${issue.message}` : "Invalid query";
      log.warn("query refused", { message });
      return errorResponse(message, 400);
    }
    const { customerId, invoiceNo, storeId, status, page = 1, limit = 50 } = parsed.data;

    const where: Prisma.CustomerCreditNoteWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(invoiceNo ? { applications: { some: { invoiceNo } } } : {}),
      ...(storeId ? { storeId: storeId === "none" ? null : storeId } : {}),
      ...(status && status !== "all" ? { status } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.customerCreditNote.count({ where }),
      prisma.customerCreditNote.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          zohoCreditNoteId: true,
          creditNoteNo: true,
          referenceNo: true,
          date: true,
          customerName: true,
          customerId: true,
          customer: { select: { id: true, name: true, phone: true } },
          storeId: true,
          store: { select: { id: true, name: true, code: true } },
          total: true,
          balance: true,
          status: true,
          lastSyncedAt: true,
          applications: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              invoiceNo: true,
              amount: true,
              deliveryId: true,
              customerInvoiceId: true,
            },
          },
        },
      }),
    ]);

    // Decimal → number at the edge, so a screen never does arithmetic on a string.
    const data = rows.map((r) => ({
      ...r,
      total: Number(r.total),
      balance: Number(r.balance),
      applied: r.applications.reduce((s, a) => s + Number(a.amount), 0),
      applications: r.applications.map((a) => ({ ...a, amount: Number(a.amount) })),
    }));

    log.debug("customer credit notes read", {
      rows: data.length, total, page, limit, filtered: Object.keys(where).length, ms: Date.now() - started,
    });
    return paginatedResponse(data, total, page, limit);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("customer credit notes read failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not load customer credit notes. Try again.", 500);
  }
}
