import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — fetch notification history for a job or recent notifications
export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_jobs", "view");
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const where: Record<string, unknown> = {};
  if (jobId) where.jobId = jobId;

  const notifications = await prisma.notificationLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ notifications });
}

// POST — log a WhatsApp notification that was sent
export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "create");
  if (authError) return authError;

  const { jobId, tokenNumber, customerPhone, customerName, messageType } = await req.json();

  if (!jobId || !tokenNumber || !messageType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const log = await prisma.notificationLog.create({
    data: {
      jobId,
      tokenNumber,
      customerPhone: customerPhone || "",
      customerName: customerName || "",
      messageType,
      sentById: user.id,
      sentByName: user.name,
    },
  });

  return NextResponse.json({ log });
}
