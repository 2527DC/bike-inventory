import { NextRequest, NextResponse } from "next/server";
import { r2Put, isR2Configured } from "@/lib/r2";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_jobs", "edit");
  if (authError) return authError;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;
  const photoType = (formData.get("type") as string | null) || "inward"; // "inward" or "after"

  if (!file || !jobId) {
    return NextResponse.json(
      { error: "File and jobId required" },
      { status: 400 }
    );
  }

  // Validate file type
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Only images allowed" },
      { status: 400 }
    );
  }

  // Max 5MB
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Max 5MB per photo" },
      { status: 400 }
    );
  }

  const job = await prisma.serviceJob.findUnique({
    where: { id: jobId },
    select: { id: true, tokenNumber: true, photos: true, afterPhotos: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const isAfter = photoType === "after";
  const currentPhotos = isAfter ? job.afterPhotos : job.photos;

  // Max 7 photos per type
  if (currentPhotos.length >= 7) {
    return NextResponse.json(
      { error: `Max 7 ${isAfter ? "after-service " : ""}photos per job` },
      { status: 400 }
    );
  }

  // Photos go to R2, which is what this app already uses for media. The standalone service
  // app used Vercel Blob with access:"private" and streamed every read back through the
  // server; there is no reason to keep a second storage provider after the merge.
  if (!isR2Configured()) {
    return NextResponse.json({ error: "File storage is not configured" }, { status: 503 });
  }

  try {
    const prefix = isAfter ? "service/after" : "service/bikes";
    const ext = file.type.split("/")[1] || "jpg";
    const url = await r2Put(
      `${prefix}/${job.tokenNumber}-${Date.now()}.${ext}`,
      await file.arrayBuffer(),
      file.type
    );

    const field = isAfter ? "afterPhotos" : "photos";
    const updated = await prisma.serviceJob.update({
      where: { id: jobId },
      data: { [field]: { push: url } },
    });

    // Return proxy URLs that the browser can load
    const photos = isAfter ? updated.afterPhotos : updated.photos;
    const proxyPhotos = photos.map(
      (_, i) => `/api/services/upload/photo?jobId=${jobId}&index=${i}&type=${photoType}`
    );

    return NextResponse.json({ url, photos: proxyPhotos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — return proxy URLs for job photos
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  const photoType = req.nextUrl.searchParams.get("type") || "inward";
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const job = await prisma.serviceJob.findUnique({
    where: { id: jobId },
    select: { photos: true, afterPhotos: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const isAfter = photoType === "after";
  const source = isAfter ? job.afterPhotos : job.photos;

  const photos = source.map(
    (_, i) => `/api/services/upload/photo?jobId=${jobId}&index=${i}&type=${photoType}`
  );

  return NextResponse.json({ photos });
}
