import { NextRequest, NextResponse } from "next/server";
import { tryGetStorage } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

const log = createLogger("services:photo-delete");

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
  const storage = await tryGetStorage();
  // keyFromUrl returns null for a URL this provider did not issue — a photo stored before
  // the provider was switched. The row is still cleaned up; only the old object is left.
  const key = storage?.keyFromUrl(source[index]) ?? null;
  if (storage && key) {
    try {
      await storage.delete(key);
    } catch (e) {
      // Already gone, or transient. Logged rather than swallowed, so an accumulating pile
      // of orphaned files is visible somewhere instead of being invisible by design.
      log.warn("stored object could not be deleted; row is still removed", {
        key,
        provider: storage.key,
        error: e instanceof Error ? e.message : String(e),
      });
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
