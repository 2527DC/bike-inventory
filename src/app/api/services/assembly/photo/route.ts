import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function GET(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_assembly", "view");
  if (authError) return authError;

  const logId = req.nextUrl.searchParams.get("logId");
  const index = parseInt(req.nextUrl.searchParams.get("index") || "0");

  if (!logId) return new NextResponse("Missing logId", { status: 400 });

  const log = await prisma.assemblyLog.findUnique({
    where: { id: logId },
    select: { photos: true },
  });

  if (!log || index < 0 || index >= log.photos.length) {
    return new NextResponse("Not found", { status: 404 });
  }

  const res = await fetch(log.photos[index], {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });

  if (!res.ok) return new NextResponse("Failed to load image", { status: 502 });

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const imageBuffer = await res.arrayBuffer();

  return new NextResponse(imageBuffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
