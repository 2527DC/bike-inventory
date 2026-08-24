export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listPaidInvoices, extractTokenNumbers } from "@/lib/services/zoho";

export async function GET(request: Request) {
  // Auth: Vercel Cron sends "Bearer <CRON_SECRET>" when CRON_SECRET is set.
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Load READY jobs that have not been proposed or reviewed yet.
  const readyJobs = await prisma.serviceJob.findMany({
    where: {
      status: "READY",
      deliveryProposedAt: null,
      deliveryReviewedAt: null,
    },
    select: { id: true, tokenNumber: true },
  });

  if (readyJobs.length === 0) {
    return NextResponse.json({ ok: true, proposed: 0 });
  }

  // Map tokenInt -> jobId.
  const tokenToJob = new Map<number, string>();
  for (const job of readyJobs) {
    const tok = parseInt(job.tokenNumber.replace(/\D/g, ""), 10);
    if (!Number.isNaN(tok)) {
      tokenToJob.set(tok, job.id);
    }
  }

  // "since" = calendar date 60 days before today, formatted YYYY-MM-DD.
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 60);
  const since = sinceDate.toISOString().slice(0, 10);

  const invoices = await listPaidInvoices(since);

  // Match paid, settled invoices to READY jobs (each job used at most once).
  const usedJobIds = new Set<string>();
  const matches: Array<{ jobId: string; invoice: string }> = [];
  for (const inv of invoices) {
    if (inv.status !== "paid" || inv.balance > 0) continue;
    // One invoice can cover several bikes (e.g. "GOVIND BCH0534/0535").
    for (const tok of extractTokenNumbers(inv.customer_name)) {
      const jobId = tokenToJob.get(tok);
      if (!jobId || usedJobIds.has(jobId)) continue;
      usedJobIds.add(jobId);
      matches.push({ jobId, invoice: inv.invoice_number });
    }
  }

  const now = new Date();
  for (const match of matches) {
    await prisma.serviceJob.update({
      where: { id: match.jobId },
      data: {
        deliveryProposedAt: now,
        deliveryMatchedInvoice: match.invoice,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    ready: readyJobs.length,
    invoices: invoices.length,
    proposed: matches.length,
  });
}
