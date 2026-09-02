import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";
import { STATUS_FLOW } from "@/lib/services/constants";
import { notify } from "@/lib/notify";
import { usersWithPermission } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:bulk-status");

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
    // mechanicId, bike and customer are read here only to word the READY notification below;
    // the transition logic uses id, status and tokenNumber as before.
    select: {
      id: true,
      status: true,
      tokenNumber: true,
      mechanicId: true,
      bikeType: true,
      bikeColor: true,
      customer: { select: { name: true } },
    },
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

  // service.job_ready — once PER JOB that moved into READY, never once per batch (§F.2).
  // §F.0: the updateMany and the audit rows above have committed; after() runs once the
  // response has gone out. Recipients are resolved once for the batch, the mechanic per job.
  if (newStatus === "READY") {
    const actorId = user.id;
    const readyJobs = jobs
      .filter((j) => valid.includes(j.id) && j.status !== "READY")
      .map((j) => ({
        id: j.id,
        tokenNumber: j.tokenNumber,
        customerName: j.customer.name,
        bike: [j.bikeColor, j.bikeType].filter(Boolean).join(" "),
        mechanicId: j.mechanicId,
      }));

    if (readyJobs.length > 0) {
      after(async () => {
        try {
          const mechanicIds = [...new Set(readyJobs.map((j) => j.mechanicId).filter((m): m is string => !!m))];
          const [approvers, activeMechanics] = await Promise.all([
            usersWithPermission("service_jobs", "approve"),
            mechanicIds.length > 0
              ? prisma.user.findMany({ where: { id: { in: mechanicIds }, isActive: true }, select: { id: true } })
              : Promise.resolve([] as { id: string }[]),
          ]);
          const activeMechanicIds = new Set(activeMechanics.map((u) => u.id));

          let sent = 0;
          for (const j of readyJobs) {
            const mechanic = j.mechanicId && activeMechanicIds.has(j.mechanicId) ? [j.mechanicId] : [];
            const recipients = [...new Set([...approvers, ...mechanic])].filter((uid) => uid !== actorId);
            if (recipients.length === 0) continue;
            await notify("service.job_ready", {
              recipients,
              title: `Job ${j.tokenNumber} is ready`,
              body: `${j.customerName} — ${j.bike}`,
              refId: j.id,
              // No per-job page exists; the counter queue lists READY jobs at the top.
              link: "/services/counter/queue",
              data: { jobId: j.id, tokenNumber: j.tokenNumber },
            });
            sent++;
          }
          log.info("job_ready notifications sent", { jobs: readyJobs.length, sent });
        } catch (err) {
          log.error("job_ready bulk notification failed", {
            jobIds: readyJobs.map((j) => j.id),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
  }

  return NextResponse.json({
    updated: valid.length,
    skipped: invalid.length,
    invalidTokens: invalid,
  });
}
