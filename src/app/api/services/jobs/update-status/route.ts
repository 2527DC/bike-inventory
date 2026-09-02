import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";
import { STATUS_FLOW } from "@/lib/services/constants";
import { notify } from "@/lib/notify";
import { usersWithPermission } from "@/lib/rbac";
import { createLogger } from "@/lib/logger";

const log = createLogger("services:update-status");

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const { jobId, newStatus, partsNeeded, workDone, zohoInvoiceId, amount, holdReason, billUpdateOnly } = await req.json();

  if (!jobId || (!newStatus && !billUpdateOnly)) {
    return NextResponse.json({ error: "Missing jobId or newStatus" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const sanitize = (s: string) => s.replace(/<[^>]*>/g, "").trim();

  // Bill-only update: change amount / parts WITHOUT a status transition.
  // Used by "Add Parts / Update Bill" on a READY (or in-progress) job — adding
  // spares should update the bill, not push a ready bike back onto Hold.
  if (billUpdateOnly) {
    const billData: Record<string, unknown> = {};
    if (typeof amount === "number" && amount >= 0) billData.amount = amount;
    if (partsNeeded) billData.partsNeeded = sanitize(partsNeeded);
    const updated = await prisma.serviceJob.update({
      where: { id: jobId },
      data: billData,
      include: {
        customer: { select: { name: true, phone: true } },
        mechanic: { select: { name: true, emoji: true } },
      },
    });
    await prisma.serviceAuditLog.create({
      data: {
        jobId,
        action: "BILL_UPDATE",
        fromStatus: job.status,
        toStatus: job.status,
        details: partsNeeded ? `Bill updated: ${partsNeeded}` : "Bill updated",
        userId: user.id,
        userName: user.name,
        userRole: user.roleName,
      },
    });
    return NextResponse.json({ job: updated });
  }

  // Validate transition
  const allowed = STATUS_FLOW[job.status] || [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Cannot move from ${job.status} to ${newStatus}` },
      { status: 400 }
    );
  }

  // Paid services require breakdown before marking Ready
  const PAID_SERVICE_TYPES = ["RSVC", "SND", "ECYC"];
  if (newStatus === "READY" && PAID_SERVICE_TYPES.includes(job.jobType)) {
    const hasBreakdown = partsNeeded || job.partsNeeded;
    if (!hasBreakdown) {
      return NextResponse.json(
        { error: "Add parts/service breakdown before marking Ready" },
        { status: 400 }
      );
    }
  }

  // Review is mandatory before delivery
  if (newStatus === "DELIVERED") {
    const review = await prisma.review.findUnique({ where: { jobId } });
    if (!review) {
      return NextResponse.json(
        { error: "Review required before delivery", needsReview: true },
        { status: 400 }
      );
    }
  }

  // Build update data with timestamp
  const updateData: Record<string, unknown> = { status: newStatus };

  // Update amount if provided
  if (typeof amount === "number" && amount >= 0) {
    updateData.amount = amount;
  }

  // Always save partsNeeded if provided (for re-editing parts)
  if (partsNeeded) updateData.partsNeeded = sanitize(partsNeeded);

  if (newStatus === "PARTS_NEEDED") {
    updateData.partsAt = new Date();
    if (holdReason) updateData.holdReason = sanitize(holdReason);
  } else if (newStatus === "READY") {
    updateData.readyAt = new Date();
    if (workDone) updateData.workDone = sanitize(workDone);
  } else if (newStatus === "DELIVERED") {
    updateData.deliveredAt = new Date();
    if (zohoInvoiceId) {
      // Check if this invoice is already used on another job
      const existing = await prisma.serviceJob.findFirst({
        where: { zohoInvoiceId, id: { not: jobId } },
        select: { tokenNumber: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: `Invoice ${zohoInvoiceId} is already used on job ${existing.tokenNumber}` },
          { status: 400 }
        );
      }
      updateData.zohoInvoiceId = zohoInvoiceId;
    }
  }

  const updated = await prisma.serviceJob.update({
    where: { id: jobId },
    data: updateData,
    include: {
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { name: true, emoji: true } },
    },
  });

  // Audit log
  await prisma.serviceAuditLog.create({
    data: {
      jobId,
      action: "STATUS_CHANGE",
      fromStatus: job.status,
      toStatus: newStatus,
      details: partsNeeded ? `Parts: ${partsNeeded}` : null,
      userId: user.id,
      userName: user.name,
      userRole: user.roleName,
    },
  });

  // service.job_ready — only on the transition INTO READY. STATUS_FLOW has no READY → READY
  // edge, but the check is explicit so a future flow change cannot start double-paging.
  // §F.0: both writes above have committed; after() runs once the response has gone out, so the
  // mechanic's tap is not held up by SMTP/FCM and nothing fires if either write threw.
  if (newStatus === "READY" && job.status !== "READY") {
    const actorId = user.id;
    const ready = {
      id: job.id,
      tokenNumber: job.tokenNumber,
      customerName: updated.customer.name,
      bike: [job.bikeColor, job.bikeType].filter(Boolean).join(" "),
      mechanicId: job.mechanicId,
    };
    after(async () => {
      try {
        // Whoever can approve workshop jobs (§F.5), plus the assigned mechanic if still active,
        // minus the person who pressed the button — they are looking at the job.
        const [approvers, mechanic] = await Promise.all([
          usersWithPermission("service_jobs", "approve"),
          ready.mechanicId
            ? prisma.user.findFirst({ where: { id: ready.mechanicId, isActive: true }, select: { id: true } })
            : null,
        ]);
        const recipients = [...new Set([...approvers, ...(mechanic ? [mechanic.id] : [])])].filter(
          (uid) => uid !== actorId
        );
        if (recipients.length === 0) {
          log.debug("job ready but nobody to tell", { jobId: ready.id });
          return;
        }
        await notify("service.job_ready", {
          recipients,
          title: `Job ${ready.tokenNumber} is ready`,
          body: `${ready.customerName} — ${ready.bike}`,
          refId: ready.id,
          // No per-job page exists; the counter queue lists READY jobs at the top.
          link: "/services/counter/queue",
          data: { jobId: ready.id, tokenNumber: ready.tokenNumber },
        });
      } catch (err) {
        log.error("job_ready notification failed", {
          jobId: ready.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return NextResponse.json({ job: updated });
}
