import { NextRequest, NextResponse } from "next/server";
import { r2Delete, r2KeyFromUrl } from "@/lib/r2";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const { jobId, index, type } = await req.json();
  const photoType = type || "inward";

  if (!jobId || index === undefined || index === null) {
    return NextResponse.json({ error: "jobId and index required" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({
    where: { id: jobId },
    select: { id: true, tokenNumber: true, photos: true, afterPhotos: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const isAfter = photoType === "after";
  const source = isAfter ? job.afterPhotos : job.photos;
  const field = isAfter ? "afterPhotos" : "photos";

  if (index < 0 || index >= source.length) {
    return NextResponse.json({ error: "Invalid photo index" }, { status: 400 });
  }

  // Remove the stored object. A failure here must not block the DB update: a row pointing
  // at a file that no longer exists is worse than an orphaned file nobody references.
  const key = r2KeyFromUrl(source[index]);
  if (key) {
    try {
      await r2Delete(key);
    } catch {
      /* already gone, or transient — the row is still removed below */
    }
  }

  // Remove from DB array
  const updatedPhotos = source.filter((_, i) => i !== index);
  await prisma.serviceJob.update({
    where: { id: jobId },
    data: { [field]: updatedPhotos },
  });

  // Log the deletion
  await prisma.serviceAuditLog.create({
    data: {
      jobId,
      action: "PHOTO_DELETE",
      details: `Deleted ${isAfter ? "after-service " : ""}photo ${index + 1} of ${job.tokenNumber}`,
      userId: user.id,
      userName: user.name,
      userRole: user.roleName,
    },
  });

  return NextResponse.json({
    photos: updatedPhotos.map((_, i) => `/api/services/upload/photo?jobId=${jobId}&index=${i}&type=${photoType}`),
  });
}
