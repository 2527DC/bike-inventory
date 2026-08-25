import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const { jobId, notes } = await req.json();

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const sanitize = (s: string) => s.replace(/<[^>]*>/g, "").trim();

  await prisma.serviceJob.update({
    where: { id: jobId },
    data: { notes: notes ? sanitize(notes) : null },
  });

  return NextResponse.json({ ok: true });
}
