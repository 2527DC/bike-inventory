import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function GET() {
  const { error: authError } = await serviceGuard("service_jobs", "view");
  if (authError) return authError;

  const mechanics = await prisma.user.findMany({
    where: { role: { key: "SERVICE_MECHANIC" }, isActive: true },
    select: {
      id: true,
      name: true,
      emoji: true,
      _count: {
        select: {
          assignedJobs: {
            where: { status: { not: "DELIVERED" } },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ mechanics });
}
