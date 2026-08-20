import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// Proxy private blob images to the browser
export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_jobs", "view");
  if (authError) return authError;

  const jobId = req.nextUrl.searchParams.get("jobId");
  const index = parseInt(req.nextUrl.searchParams.get("index") || "0");
  const photoType = req.nextUrl.searchParams.get("type") || "inward";

  if (!jobId) {
    return new NextResponse("Missing jobId", { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({
    where: { id: jobId },
    select: { photos: true, afterPhotos: true },
  });

  if (!job) {
    return new NextResponse("Not found", { status: 404 });
  }

  const source = photoType === "after" ? job.afterPhotos : job.photos;

  if (index < 0 || index >= source.length) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Photos live in R2 under a public URL now, so this no longer streams bytes through the
  // server — it redirects. The route is kept because stored proxy URLs and the page
  // components point at it, and because the permission check above still decides who may
  // resolve a job's photo at all.
  return NextResponse.redirect(source[index]);
}
