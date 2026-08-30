import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  // service_jobs.APPROVE, not edit — and that is a deliberate change of module action.
  //
  // The dead role list said SUPERVISOR / MANAGER / STAFF, i.e. "not mechanics". But
  // service_jobs.edit includes SERVICE_MECHANIC, so guarding on edit alone would let a
  // mechanic assign work to other mechanics. CLAUDE.md says a rule of the shape
  // "supervisors do this, juniors do not" IS the module's approve grant — which is held by
  // ADMIN, SERVICE_MANAGER and SERVICE_SUPERVISOR, exactly the intent.
  //
  // The old check compared role KEYS against roleName (= Role.name, "Service Manager"), so
  // it matched nothing and this endpoint was returning 403 to everyone.
  //
  // If counter staff should assign jobs, grant SERVICE_STAFF service_jobs.approve — that is
  // one toggle on /team/permissions rather than a redeploy.
  const { error: authError } = await serviceGuard("service_jobs", "approve");
  if (authError) return authError;

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
