import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  // Authorised by service_jobs.delete alone, which ADMIN, SERVICE_MANAGER and
  // SERVICE_SUPERVISOR hold. The "Only MANAGER can delete" check that used to follow was
  // dead — it compared the role KEY "MANAGER" against roleName, which carries Role.name
  // ("Service Manager") — so nobody could delete a job at all.
  //
  // Supervisors gaining this is the grant's own statement, and it is revocable from
  // /team/permissions. A name list in code is not.
  const { user, error: authError } = await serviceGuard("service_jobs", "delete");
  if (authError) return authError;

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
