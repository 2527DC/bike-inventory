import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_jobs", "view");
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const mechanicId = searchParams.get("mechanicId");
  const includeDelivered = searchParams.get("includeDelivered") === "true";
  const search = searchParams.get("search")?.trim();
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Build conditions as AND array
  const conditions: Record<string, unknown>[] = [];

  // Date range — filters ALL jobs by receivedAt
  if (from || to) {
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    conditions.push({ receivedAt: dateFilter });
    if (!includeDelivered) {
      conditions.push({ status: { not: "DELIVERED" } });
    }
  } else if (status) {
    conditions.push({ status });
  } else if (!includeDelivered) {
    conditions.push({ status: { not: "DELIVERED" } });
  }

  // Search by token number, customer name, or phone.
  // A short numeric query (e.g. "0697") is a TICKET search — phone matching
  // only kicks in once the query has 6+ digits, so a 3–5 digit ticket lookup
  // can't accidentally match a phone-number substring on a different job.
  if (search) {
    const digitsOnly = search.replace(/\D/g, "");
    const or: Record<string, unknown>[] = [
      { tokenNumber: { contains: search, mode: "insensitive" } },
      { customer: { name: { contains: search, mode: "insensitive" } } },
    ];
    if (digitsOnly.length >= 6) {
      or.push({ customer: { phone: { contains: digitsOnly } } });
    }
    conditions.push({ OR: or });
  }

  // Mechanic filter
  if (mechanicId) {
    conditions.push({ mechanicId });
    // Limit delivered jobs to last 7 days for mechanic view
    if (includeDelivered && !status && !from) {
      // Replace the status condition with mechanic-specific one
      const idx = conditions.findIndex((c) => "status" in c);
      if (idx >= 0) conditions.splice(idx, 1);
      conditions.push({
        OR: [
          { status: { not: "DELIVERED" } },
          { status: "DELIVERED", deliveredAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      });
    }
  }

  const where = conditions.length > 0 ? { AND: conditions } : {};

  const jobs = await prisma.serviceJob.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { id: true, name: true, emoji: true } },
      review: { select: { rating: true, googleReview: true } },
    },
    orderBy: [{ priority: "desc" }, { receivedAt: "asc" }],
  });

  return NextResponse.json({ jobs });
}
