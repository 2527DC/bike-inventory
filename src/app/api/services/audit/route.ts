import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function GET(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "view");
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const where: Record<string, unknown> = {};
  if (jobId) where.jobId = jobId;

  const logs = await prisma.serviceAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ logs });
}
