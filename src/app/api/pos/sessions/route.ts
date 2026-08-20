export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { ZakyaClient } from "@/lib/zakya";
import { ZohoClient } from "@/lib/zoho";

// GET — List POS sessions (from DB)
export async function GET(req: NextRequest) {
  try {
    await requireFeature("pos", "view");
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const where: Record<string, unknown> = {};
    if (dateFrom || dateTo) {
      where.sessionDate = {};
      if (dateFrom) (where.sessionDate as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.sessionDate as Record<string, unknown>).lte = new Date(dateTo + "T23:59:59Z");
    }

    const sessions = await prisma.posSession.findMany({
      where,
      orderBy: { sessionDate: "desc" },
      take: 50,
      include: { settlement: { select: { id: true, status: true } } },
    });

    return successResponse(sessions);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST — Fetch POS sessions from Zakya and save to DB
export async function POST(req: NextRequest) {
  try {
    await requireFeature("pos", "create");
    const body = await req.json();
    const { dateFrom, dateTo, force } = body as { dateFrom: string; dateTo: string; force?: boolean };

    if (!dateFrom || !dateTo) return errorResponse("dateFrom and dateTo required", 400);

    const zakya = new ZakyaClient();
    const ok = await zakya.init();
    if (!ok) return errorResponse("Zakya POS not connected. Configure in Settings → Zakya.", 400);

    // Force mode: delete existing sessions (and unlink from settlements) for this date range
    if (force) {
      const startOfRange = new Date(dateFrom);
      const endOfRange = new Date(dateTo + "T23:59:59Z");
      const existingSessions = await prisma.posSession.findMany({
        where: { sessionDate: { gte: startOfRange, lte: endOfRange } },
        select: { id: true, settlementId: true },
      });
      if (existingSessions.length > 0) {
        // Delete linked settlements first
        const settlementIds = [...new Set(existingSessions.filter(s => s.settlementId).map(s => s.settlementId!))];
        for (const sid of settlementIds) {
          await prisma.settlementMatch.deleteMany({ where: { settlementId: sid } });
          await prisma.posSession.updateMany({ where: { settlementId: sid }, data: { settlementId: null } });
          await prisma.dailySettlement.delete({ where: { id: sid } });
        }
        await prisma.posSession.deleteMany({
          where: { id: { in: existingSessions.map(s => s.id) } },
        });
      }
    }

    let created = 0;
    let skipped = 0;

    // Step 1: Fetch invoices from Zakya for totals
    const invoices = await zakya.listAllInvoices(dateFrom, dateTo);

    // Step 2: Fetch customer payments from Zoho Books for payment mode breakdown
    let payments: Array<{
      payment_id: string; date: string; amount: number;
      payment_mode: string; customer_name: string; account_name: string;
    }> = [];
    let paymentSource: string = "none";
    let paymentError: string | null = null;

    // Try Zoho Books first (separate OAuth, has customer payments)
    const zoho = new ZohoClient();
    const zohoOk = await zoho.init();
    if (zohoOk) {
      try {
        payments = await zoho.listAllCustomerPayments(dateFrom, dateTo);
        paymentSource = "zoho-books";
      } catch (err) {
        paymentError = `Zoho Books: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      paymentError = "Zoho Books not connected";
    }

    // Fallback: try Zakya customer payments if Books failed
    if (payments.length === 0 && !paymentError?.includes("not connected")) {
      try {
        const zakyaPayments = await zakya.listAllCustomerPayments(dateFrom, dateTo);
        if (zakyaPayments.length > 0) {
          payments = zakyaPayments;
          paymentSource = "zakya";
          paymentError = null;
        }
      } catch {
        // Zakya payments not authorized — already know this, skip
      }
    }

    // Step 3: Group invoices by date
    const sessionsByDate = new Map<string, {
      date: string; total: number; count: number;
      cashSales: number; cardSales: number; upiSales: number;
      financeSales: number; creditSales: number;
      paymentModes: Record<string, number>;
    }>();

    for (const inv of invoices) {
      const date = inv.date;
      if (!sessionsByDate.has(date)) {
        sessionsByDate.set(date, {
          date, total: 0, count: 0,
          cashSales: 0, cardSales: 0, upiSales: 0, financeSales: 0, creditSales: 0,
          paymentModes: {},
        });
      }
      const s = sessionsByDate.get(date)!;
      s.total += inv.total;
      s.count += 1;
      if (inv.balance > 0) s.creditSales += inv.balance;
    }

    // Step 4: Distribute payment amounts by mode into daily buckets
    for (const pm of payments) {
      const date = pm.date;
      if (!sessionsByDate.has(date)) continue;

      const s = sessionsByDate.get(date)!;
      const mode = (pm.payment_mode || "").toLowerCase();
      const amt = pm.amount || 0;

      // Track raw mode names for diagnostics
      s.paymentModes[pm.payment_mode || "unknown"] = (s.paymentModes[pm.payment_mode || "unknown"] || 0) + amt;

      // Classify into buckets
      if (mode === "cash") {
        s.cashSales += amt;
      } else if (mode.includes("upi") || mode.includes("phonepe") || mode.includes("gpay") || mode.includes("google")) {
        s.upiSales += amt;
      } else if (mode.includes("bajaj") || mode.includes("finance") || mode.includes("emi")) {
        s.financeSales += amt;
      } else if (mode === "creditcard" || mode.includes("card") || mode.includes("mespos") || mode.includes("icici") || mode.includes("hdfc") || mode.includes("bank")) {
        s.cardSales += amt;
      } else if (mode === "banktransfer" || mode === "bankremittance") {
        s.cardSales += amt;
      } else {
        s.cardSales += amt;
      }
    }

    // Step 5: Create POS sessions in DB
    const allPaymentModes = new Set<string>();
    for (const [date, s] of sessionsByDate) {
      const zakyaSessionId = `ZAKYA-${date}`;
      const existing = await prisma.posSession.findUnique({ where: { zakyaSessionId } });
      if (existing) { skipped++; continue; }

      Object.keys(s.paymentModes).forEach(m => allPaymentModes.add(m));

      await prisma.posSession.create({
        data: {
          zakyaSessionId,
          sessionDate: new Date(date),
          openedAt: new Date(date + "T09:00:00"),
          closedAt: new Date(date + "T21:00:00"),
          registerName: "Zakya POS",
          cashSales: s.cashSales,
          cardSales: s.cardSales,
          upiSales: s.upiSales,
          financeSales: s.financeSales,
          creditSales: s.creditSales,
          totalSales: s.total,
          cashInHand: s.cashSales,
          cashDeposited: 0,
          invoiceCount: s.count,
          rawData: {
            invoiceCount: s.count, total: s.total,
            paymentModes: s.paymentModes,
            source: paymentSource,
          },
        },
      });
      created++;
    }

    return successResponse({
      fetched: invoices.length,
      paymentsFound: payments.length,
      created, skipped,
      source: payments.length > 0 ? paymentSource : "invoices-only",
      paymentError,
      paymentModes: [...allPaymentModes],
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to fetch POS sessions", 500);
  }
}
