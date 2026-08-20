import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — search customer by phone for auto-fill
export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("customers", "view");
  if (authError) return authError;

  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone || phone.length < 4) {
    return NextResponse.json({ customer: null });
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: { contains: phone } },
    select: {
      id: true,
      name: true,
      phone: true,
      serviceJobs: {
        select: { bikeType: true },
        orderBy: { receivedAt: "desc" },
        take: 1,
      },
    },
  });

  return NextResponse.json({ customer });
}
