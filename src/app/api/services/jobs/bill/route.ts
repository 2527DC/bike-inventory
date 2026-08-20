import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "approve");
  if (authError) return authError;

  const { jobId, zohoInvoiceId } = await req.json();

  if (!jobId || !zohoInvoiceId) {
    return NextResponse.json({ error: "Missing jobId or zohoInvoiceId" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const sanitize = (s: string) => s.replace(/<[^>]*>/g, "").trim();
  const cleanInvoiceId = sanitize(zohoInvoiceId);

  // Check if this invoice is already used on another job
  const existing = await prisma.serviceJob.findFirst({
    where: { zohoInvoiceId: cleanInvoiceId, id: { not: jobId } },
    select: { tokenNumber: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Invoice ${cleanInvoiceId} is already used on job ${existing.tokenNumber}` },
      { status: 400 }
    );
  }

  const updated = await prisma.serviceJob.update({
    where: { id: jobId },
    data: { zohoInvoiceId: cleanInvoiceId },
    include: {
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { name: true, emoji: true } },
    },
  });

  return NextResponse.json({ job: updated });
}
