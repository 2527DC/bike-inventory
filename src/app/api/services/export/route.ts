import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function GET(req: NextRequest) {
  // Authorised by service_reports.view alone. A second gate used to follow this line
  // comparing user.roleName against "MANAGER" / "SUPERVISOR" / "BILLING" — those are role
  // KEYS, but roleName carries Role.name ("Service Manager"), so no role ever matched and
  // this endpoint returned 403 to everyone including ADMIN.
  const { error: authError } = await serviceGuard("service_reports", "view");
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.receivedAt = {};
    if (from) (where.receivedAt as Record<string, unknown>).gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      (where.receivedAt as Record<string, unknown>).lte = toDate;
    }
  }
  if (status) where.status = status;

  const jobs = await prisma.serviceJob.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      mechanic: { select: { name: true } },
      review: { select: { rating: true, googleReview: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 5000,
  });

  // Build CSV
  const headers = [
    "Token", "Status", "Job Type", "Customer Name", "Customer Phone",
    "Bike Type", "Complaint", "Parts Needed", "Amount",
    "Mechanic", "Received At", "Ready At", "Delivered At",
    "TAT (hrs)", "Rating", "Google Review", "Zoho Invoice",
  ];

  const rows = jobs.map((j) => {
    const tatHrs = j.deliveredAt && j.receivedAt
      ? ((new Date(j.deliveredAt).getTime() - new Date(j.receivedAt).getTime()) / 3600000).toFixed(1)
      : "";
    return [
      j.tokenNumber,
      j.status,
      j.jobType,
      j.customer.name,
      j.customer.phone,
      j.bikeType,
      j.complaint || "",
      j.partsNeeded || "",
      j.amount != null ? String(j.amount) : "",
      j.mechanic?.name || "Unassigned",
      toIST(j.receivedAt),
      j.readyAt ? toIST(j.readyAt) : "",
      j.deliveredAt ? toIST(j.deliveredAt) : "",
      tatHrs,
      j.review?.rating != null ? String(j.review.rating) : "",
      j.review?.googleReview ? "Yes" : "",
      j.zohoInvoiceId || "",
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bch-jobs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function toIST(date: Date): string {
  return new Date(date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}
