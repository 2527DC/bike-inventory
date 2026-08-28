import { NextRequest, NextResponse } from "next/server";
import { tryGetStorage } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_assembly", "edit");
  if (authError) return authError;
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const logId = formData.get("logId") as string | null;

  if (!file || !logId) {
    return NextResponse.json({ error: "File and logId required" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only images allowed" }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB per photo" }, { status: 400 });
  }

  const log = await prisma.assemblyLog.findUnique({
    where: { id: logId },
    select: { id: true, photos: true },
  });

  if (!log) return NextResponse.json({ error: "Log not found" }, { status: 404 });

  if (log.photos.length >= 3) {
    return NextResponse.json({ error: "Max 3 photos" }, { status: 400 });
  }

  const storage = await tryGetStorage();
  if (!storage) {
    return NextResponse.json(
      { error: "Storage is not configured. Set it up in Settings > Storage." },
      { status: 503 }
    );
  }

  try {
    const ext = file.type.split("/")[1] || "jpg";
    const url = await storage.put(
      `service/assembly/${logId}-${Date.now()}.${ext}`,
      await file.arrayBuffer(),
      file.type
    );

    await prisma.assemblyLog.update({
      where: { id: logId },
      data: { photos: { push: url } },
    });

    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
