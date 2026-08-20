export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// GET: Service revenue — daily breakdown of SERVICE invoices
export async function GET(req: NextRequest) {
  try {
    await requireFeature("deliveries", "view");

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30", 10);

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const serviceDeliveries = await prisma.delivery.findMany({
      where: {
        invoiceType: "SERVICE",
        invoiceDate: { gte: since },
      },
      select: {
        id: true,
        invoiceNo: true,
        invoiceDate: true,
        invoiceAmount: true,
        customerName: true,
        customerPhone: true,
        lineItems: true,
        salesPerson: true,
      },
      orderBy: { invoiceDate: "desc" },
    });

    // Group by date
    const byDate: Record<string, { date: string; total: number; count: number; invoices: typeof serviceDeliveries }> = {};
    for (const d of serviceDeliveries) {
      const dateKey = d.invoiceDate.toISOString().split("T")[0];
      if (!byDate[dateKey]) {
        byDate[dateKey] = { date: dateKey, total: 0, count: 0, invoices: [] };
      }
      byDate[dateKey].total += d.invoiceAmount;
      byDate[dateKey].count++;
      byDate[dateKey].invoices.push(d);
    }

    const dailyBreakdown = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
    const grandTotal = serviceDeliveries.reduce((sum, d) => sum + d.invoiceAmount, 0);

    return successResponse({
      grandTotal,
      totalInvoices: serviceDeliveries.length,
      days,
      dailyBreakdown,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
