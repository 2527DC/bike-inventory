import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "delete");
  if (authError) return authError;
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  // Only MANAGER can delete
  if (user.roleName !== "MANAGER") {
    return NextResponse.json({ error: "Only admin can delete jobs" }, { status: 403 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Delete related records first, then the job
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { jobId } }),
    prisma.serviceJob.delete({ where: { id: jobId } }),
  ]);

  // Audit log (job is deleted but we log the event)
  await prisma.serviceAuditLog.create({
    data: {
      jobId,
      action: "JOB_DELETE",
      fromStatus: job.status,
      details: `Deleted ${job.tokenNumber} (${job.jobType})`,
      userId: user.id,
      userName: user.name,
      userRole: user.roleName,
    },
  });

  return NextResponse.json({ ok: true, tokenNumber: job.tokenNumber });
}
