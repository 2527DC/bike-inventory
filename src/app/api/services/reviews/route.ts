import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PUBLIC — no session required.
//
// The customer reaches this from a WhatsApp link after their bike is delivered; they have no
// account and never will. The job's token (BCH-0042) is the credential, which is why this
// route must NOT carry a permission check — adding one silently breaks every review link.
//
// Known weakness, inherited from the standalone app and left as-is rather than changed
// blind: tokens are sequential, so they can be enumerated to read a job's customer name,
// bike and mechanic. Fixing it properly means issuing an unguessable per-job review token
// (as /fill/[token] already does for deliveries) and is a deliberate follow-up, not a
// drive-by change to a customer-facing flow.
export async function GET(req: NextRequest) {
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

// PUBLIC — the customer submits their own review, so there is no session to check.
// Abuse is bounded by the checks below: the job must exist, must have a mechanic, and must
// not already carry a review (one review per job, enforced by Review.jobId being @unique).
export async function POST(req: NextRequest) {
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
