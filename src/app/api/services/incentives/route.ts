import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — mechanic incentive data
// Rule: ₹100 per 10 PAID jobs/day that have a Google review
export async function GET() {
  const { error: authError } = await serviceGuard("service_incentives", "view");
  if (authError) return authError;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const mechanics = await prisma.user.findMany({
    where: { role: { key: "SERVICE_MECHANIC" }, isActive: true },
    select: { id: true, name: true, emoji: true },
  });

  // Count paid delivered jobs WITH Google review per mechanic
  // "Paid" = amount > 0 (excludes free services)
  const paidWithReviewToday = await prisma.serviceJob.findMany({
    where: {
      status: "DELIVERED",
      deliveredAt: { gte: todayStart, lte: todayEnd },
      mechanicId: { not: null },
      amount: { gt: 0 },
      review: { googleReview: true },
    },
    select: { mechanicId: true },
  });

  const paidWithReviewMonth = await prisma.serviceJob.findMany({
    where: {
      status: "DELIVERED",
      deliveredAt: { gte: monthStart, lte: todayEnd },
      mechanicId: { not: null },
      amount: { gt: 0 },
      review: { googleReview: true },
    },
    select: { mechanicId: true },
  });

  // Count per mechanic
  const todayCounts: Record<string, number> = {};
  paidWithReviewToday.forEach((j) => {
    if (j.mechanicId) todayCounts[j.mechanicId] = (todayCounts[j.mechanicId] || 0) + 1;
  });

  const monthCounts: Record<string, number> = {};
  paidWithReviewMonth.forEach((j) => {
    if (j.mechanicId) monthCounts[j.mechanicId] = (monthCounts[j.mechanicId] || 0) + 1;
  });

  const incentives = mechanics.map((m) => {
    const todayCount = todayCounts[m.id] || 0;
    const monthCount = monthCounts[m.id] || 0;

    const todayIncentive = Math.floor(todayCount / 10) * 100;
    const monthIncentive = Math.floor(monthCount / 10) * 100;
    const todayProgress = todayCount % 10;

    return {
      ...m,
      todayDelivered: todayCount,
      todayIncentive,
      todayProgress,
      monthDelivered: monthCount,
      monthIncentive,
    };
  });

  return NextResponse.json({ incentives });
}
