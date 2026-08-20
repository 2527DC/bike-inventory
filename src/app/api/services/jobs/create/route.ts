import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";
import { JOB_TYPE } from "@/lib/services/constants";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "create");
  if (authError) return authError;

  const body = await req.json();
  const { customerName, customerPhone, bikeType, bikeColor, complaint, jobType, mechanicId, priority, isEcycle, amount, partsNeeded, promisedDate } = body;

  if (!customerName || !customerPhone || !bikeType || !jobType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!mechanicId) {
    return NextResponse.json({ error: "Mechanic must be assigned" }, { status: 400 });
  }

  const cleanPhone = customerPhone.replace(/\D/g, "").slice(0, 10);
  if (cleanPhone.length !== 10) {
    return NextResponse.json({ error: "Phone must be 10 digits" }, { status: 400 });
  }
  // Reject obviously invalid numbers (except walk-in placeholder)
  if (cleanPhone !== "0000000000" && /^(.)\1{9}$/.test(cleanPhone)) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const validJobTypes = Object.keys(JOB_TYPE);
  if (!validJobTypes.includes(jobType)) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  // Paid services require itemized breakdown
  const PAID_SERVICE_TYPES = ["RSVC", "SND", "ECYC"];
  if (PAID_SERVICE_TYPES.includes(jobType) && !partsNeeded) {
    return NextResponse.json({ error: "Paid services require parts/service breakdown" }, { status: 400 });
  }

  const sanitize = (s: string) => s.replace(/<[^>]*>/g, "").trim();
  const cleanName = sanitize(customerName);
  const cleanBike = sanitize(bikeType);
  const cleanComplaint = complaint ? sanitize(complaint) : null;
  const jobTypeConfig = JOB_TYPE[jobType as keyof typeof JOB_TYPE];
  const jobAmount = amount ?? jobTypeConfig?.amount ?? null;

  // Single transaction — 3 DB calls in one round trip
  const job = await prisma.$transaction(async (tx) => {
    const [customer, counter] = await Promise.all([
      tx.customer.upsert({
        where: { phone: cleanPhone },
        update: { name: cleanName },
        create: { name: cleanName, phone: cleanPhone },
      }),
      tx.tokenCounter.upsert({
        where: { id: "default" },
        update: { current: { increment: 1 } },
        create: { id: "default", current: 1 },
      }),
    ]);

    const tokenNumber = `BCH-${String(counter.current).padStart(4, "0")}`;

    return tx.serviceJob.create({
      data: {
        tokenNumber,
        jobType,
        estimatedHrs: 1,
        bikeType: cleanBike,
        bikeColor: bikeColor ? sanitize(bikeColor) : null,
        isEcycle: isEcycle || false,
        complaint: cleanComplaint,
        amount: jobAmount,
        partsNeeded: partsNeeded ? sanitize(partsNeeded) : null,
        promisedAt: promisedDate ? new Date(promisedDate) : null,
        priority: priority || 0,
        customerId: customer.id,
        mechanicId: mechanicId || null,
        createdById: user.id,
      },
      include: {
        customer: { select: { name: true, phone: true } },
        mechanic: { select: { name: true, emoji: true } },
      },
    });
  });

  // Audit log
  await prisma.serviceAuditLog.create({
    data: {
      jobId: job.id,
      action: "JOB_CREATE",
      toStatus: "RECEIVED",
      details: `${jobType} - ${cleanBike} for ${cleanName}`,
      userId: user.id,
      userName: user.name,
      userRole: user.roleName,
    },
  });

  return NextResponse.json({ job, tokenNumber: job.tokenNumber, jobId: job.id });
}
