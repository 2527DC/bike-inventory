export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// Daily snapshot of vendor/client issues for the WhatsApp progress report.
// "Today" is measured in IST (the business runs in India).
export async function GET() {
  try {
    await requireFeature("vendor_issues", "view");

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const istMidnightUtcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
    const startOfToday = new Date(istMidnightUtcMs - IST_OFFSET_MS);

    const select = {
      issueNo: true,
      issueType: true,
      status: true,
      priority: true,
      description: true,
      clientName: true,
      vendor: { select: { name: true } },
      createdBy: { select: { name: true } },
    } as const;

    const [createdToday, resolvedToday, openTotal, inProgressTotal] = await Promise.all([
      prisma.vendorIssue.findMany({
        where: { createdAt: { gte: startOfToday } },
        orderBy: { createdAt: "desc" },
        select,
      }),
      prisma.vendorIssue.findMany({
        where: { resolvedAt: { gte: startOfToday }, status: { in: ["RESOLVED", "CLOSED"] } },
        orderBy: { resolvedAt: "desc" },
        select,
      }),
      prisma.vendorIssue.count({ where: { status: "OPEN" } }),
      prisma.vendorIssue.count({ where: { status: "IN_PROGRESS" } }),
    ]);

    return successResponse({
      date: startOfToday.toISOString(),
      createdTodayCount: createdToday.length,
      resolvedTodayCount: resolvedToday.length,
      openTotal,
      inProgressTotal,
      createdToday,
      resolvedToday,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to build daily report", 500);
  }
}
