import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";
import { STATUS_FLOW } from "@/lib/services/constants";

export async function POST(req: NextRequest) {
  // service_jobs.APPROVE, not edit. Changing the status of MANY jobs at once is a
  // supervisory act; service_jobs.edit includes SERVICE_MECHANIC and SERVICE_STAFF, who can
  // move their own job through the flow but should not sweep the whole queue.
  //
  // approve is held by ADMIN, SERVICE_MANAGER and SERVICE_SUPERVISOR — exactly what the dead
  // role list intended. It was dead because it compared role KEYS against roleName, which
  // carries Role.name, so this endpoint returned 403 to everyone.
  const { user, error: authError } = await serviceGuard("service_jobs", "approve");
  if (authError) return authError;

  const { jobIds, newStatus } = await req.json();

  if (!Array.isArray(jobIds) || jobIds.length === 0 || !newStatus) {
    return NextResponse.json({ error: "Missing jobIds or newStatus" }, { status: 400 });
  }

  // Fetch all jobs
  const jobs = await prisma.serviceJob.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, status: true, tokenNumber: true },
  });

  // Validate each transition
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const job of jobs) {
    const allowed = STATUS_FLOW[job.status] || [];
    if (allowed.includes(newStatus)) {
      valid.push(job.id);
    } else {
      invalid.push(job.tokenNumber);
    }
  }

  if (valid.length === 0) {
    return NextResponse.json({ error: `No valid transitions. Invalid: ${invalid.join(", ")}` }, { status: 400 });
  }

  // Build timestamp data
  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === "PARTS_NEEDED") updateData.partsAt = new Date();
  else if (newStatus === "READY") updateData.readyAt = new Date();
  else if (newStatus === "DELIVERED") updateData.deliveredAt = new Date();

  // Bulk update
  await prisma.serviceJob.updateMany({
    where: { id: { in: valid } },
    data: updateData,
  });

  // Audit log each
  await prisma.serviceAuditLog.createMany({
    data: valid.map((jobId) => {
      const job = jobs.find((j) => j.id === jobId)!;
      return {
        jobId,
        action: "STATUS_CHANGE",
        fromStatus: job.status,
        toStatus: newStatus,
        details: `Bulk update by ${user.name}`,
        userId: user.id,
        userName: user.name,
        userRole: user.roleName,
      };
    }),
  });

  return NextResponse.json({
    updated: valid.length,
    skipped: invalid.length,
    invalidTokens: invalid,
  });
}
