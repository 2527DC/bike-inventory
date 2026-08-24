import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;
  if (!user || (user.roleName !== "SUPERVISOR" && user.roleName !== "MANAGER" && user.roleName !== "STAFF")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { jobId, mechanicId } = await req.json();

  if (!jobId || !mechanicId) {
    return NextResponse.json({ error: "Missing jobId or mechanicId" }, { status: 400 });
  }

  const updated = await prisma.serviceJob.update({
    where: { id: jobId },
    data: { mechanicId },
    include: {
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { name: true, emoji: true } },
    },
  });

  return NextResponse.json({ job: updated });
}
