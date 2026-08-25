import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — list jobs proposed for delivery (paid in Zoho, awaiting STAFF confirmation)
export async function GET() {
  const { error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const pending = await prisma.serviceJob.findMany({
    where: {
      status: "READY",
      deliveryProposedAt: { not: null },
      deliveryReviewedAt: null,
    },
    select: {
      id: true,
      tokenNumber: true,
      bikeType: true,
      amount: true,
      deliveryMatchedInvoice: true,
      deliveryProposedAt: true,
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { name: true, emoji: true } },
    },
    orderBy: { deliveryProposedAt: "asc" },
  });

  return NextResponse.json({ pending });
}

// POST — STAFF confirm (approve) or dismiss the proposed deliveries
export async function POST(req: Request) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));
  const approve: string[] = Array.isArray(body?.approve) ? body.approve : [];
  const dismiss: string[] = Array.isArray(body?.dismiss) ? body.dismiss : [];

  const now = new Date();

  // Approve → mark DELIVERED + paid, record audit log per job
  if (approve.length > 0) {
    const jobs = await prisma.serviceJob.findMany({
      where: { id: { in: approve }, status: "READY" },
      select: { id: true, deliveryMatchedInvoice: true },
    });

    for (const job of jobs) {
      await prisma.serviceJob.update({
        where: { id: job.id },
        data: {
          status: "DELIVERED",
          deliveredAt: now,
          paymentStatus: "PAID",
          zohoInvoiceId: job.deliveryMatchedInvoice ?? undefined,
          deliveryReviewedAt: now,
        },
      });
    }

    if (jobs.length > 0) {
      await prisma.serviceAuditLog.createMany({
        data: jobs.map((job) => ({
          jobId: job.id,
          action: "STATUS_CHANGE",
          fromStatus: "READY",
          toStatus: "DELIVERED",
          details: `Daily check-off (Zoho ${job.deliveryMatchedInvoice || "—"})`,
          userId: user.id,
          userName: user.name,
          userRole: user.roleName,
        })),
      });
    }
  }

  // Dismiss → mark reviewed, stays READY (won't be re-proposed)
  if (dismiss.length > 0) {
    await prisma.serviceJob.updateMany({
      where: { id: { in: dismiss } },
      data: { deliveryReviewedAt: now },
    });
  }

  return NextResponse.json({ approved: approve.length, dismissed: dismiss.length });
}
