import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — fetch job details for review page (public, no auth)
export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_reviews", "view");
  if (authError) return authError;

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({
    where: { tokenNumber: token },
    select: {
      id: true,
      tokenNumber: true,
      status: true,
      bikeType: true,
      jobType: true,
      workDone: true,
      mechanic: { select: { id: true, name: true, emoji: true } },
      customer: { select: { name: true } },
      review: { select: { id: true, rating: true, comment: true } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

// POST — submit review (public, no auth needed)
export async function POST(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_reviews", "create");
  if (authError) return authError;

  const { tokenNumber, rating, comment, googleReview } = await req.json();

  if (!tokenNumber || !rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Token and rating (1-5) required" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({
    where: { tokenNumber },
    select: {
      id: true,
      status: true,
      customerId: true,
      mechanicId: true,
      review: { select: { id: true } },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.review) {
    return NextResponse.json({ error: "Already reviewed" }, { status: 400 });
  }

  if (!job.mechanicId) {
    return NextResponse.json({ error: "No mechanic assigned" }, { status: 400 });
  }

  const sanitize = (s: string) => s.replace(/<[^>]*>/g, "").trim();
  const review = await prisma.review.create({
    data: {
      rating,
      comment: comment ? sanitize(comment) : null,
      googleReview: googleReview === true,
      jobId: job.id,
      customerId: job.customerId,
      mechanicId: job.mechanicId,
    },
  });

  return NextResponse.json({ review });
}
