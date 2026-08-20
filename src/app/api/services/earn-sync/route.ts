import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Shared API key for cross-app sync
const SYNC_KEY = process.env.EARN_SYNC_KEY || "";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!SYNC_KEY || key !== SYNC_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateStr = req.nextUrl.searchParams.get("date");
  const date = dateStr ? new Date(dateStr) : new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  // Get all active mechanics/staff
  const users = await prisma.user.findMany({
    where: { isActive: true },
    // The merged User has no `phone` column, and `role` is a relation now.
    select: { id: true, name: true, role: { select: { key: true, name: true } } },
  });

  const userIds = users.map((u) => u.id);

  // 1. Jobs delivered today (by mechanic)
  const deliveredJobs = await prisma.serviceJob.findMany({
    where: {
      status: "DELIVERED",
      deliveredAt: { gte: dayStart, lte: dayEnd },
      mechanicId: { in: userIds },
    },
    select: {
      id: true,
      mechanicId: true,
      jobType: true,
      receivedAt: true,
      deliveredAt: true,
    },
  });

  // Build per-user delivery counts + fast turnaround bonus
  const deliveryCounts = new Map<string, number>();
  const fastTurnarounds = new Map<string, number>();
  for (const job of deliveredJobs) {
    if (!job.mechanicId) continue;
    deliveryCounts.set(job.mechanicId, (deliveryCounts.get(job.mechanicId) || 0) + 1);

    // Fast turnaround bonus: QFX under 2 hours
    if (job.jobType === "QFX" && job.deliveredAt && job.receivedAt) {
      const hours = (job.deliveredAt.getTime() - job.receivedAt.getTime()) / (1000 * 60 * 60);
      if (hours <= 2) {
        fastTurnarounds.set(job.mechanicId, (fastTurnarounds.get(job.mechanicId) || 0) + 1);
      }
    }
  }

  // 2. Google reviews received today (by mechanic)
  const reviews = await prisma.review.findMany({
    where: {
      googleReview: true,
      createdAt: { gte: dayStart, lte: dayEnd },
      mechanicId: { in: userIds },
    },
    select: { mechanicId: true },
  });

  const reviewCounts = new Map<string, number>();
  for (const r of reviews) {
    reviewCounts.set(r.mechanicId, (reviewCounts.get(r.mechanicId) || 0) + 1);
  }

  // 3. Assembly logs today
  const assemblies = await prisma.assemblyLog.findMany({
    where: {
      createdAt: { gte: dayStart, lte: dayEnd },
      mechanicId: { in: userIds },
    },
    select: { mechanicId: true },
  });

  const assemblyCounts = new Map<string, number>();
  for (const a of assemblies) {
    assemblyCounts.set(a.mechanicId, (assemblyCounts.get(a.mechanicId) || 0) + 1);
  }

  // Build response per user
  const events = users.map((u) => ({
    externalUserId: u.id,
    name: u.name,
    role: u.role?.key ?? null,
    roleName: u.role?.name ?? null,
    jobsDelivered: deliveryCounts.get(u.id) || 0,
    fastTurnarounds: fastTurnarounds.get(u.id) || 0,
    googleReviews: reviewCounts.get(u.id) || 0,
    assembliesCompleted: assemblyCounts.get(u.id) || 0,
  }));

  return NextResponse.json({
    source: "bch-service",
    date: dayStart.toISOString().slice(0, 10),
    events: events.filter(
      (e) => e.jobsDelivered > 0 || e.googleReviews > 0 || e.assembliesCompleted > 0
    ),
  });
}
