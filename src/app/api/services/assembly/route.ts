import { NextRequest, NextResponse } from "next/server";
import { tryGetStorage } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — fetch assembly logs (optionally filtered by date/mechanic)
export async function GET(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_assembly", "view");
  if (authError) return authError;
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  const mechanicId = searchParams.get("mechanicId");

  const where: Record<string, unknown> = {};

  if (date) {
    const start = new Date(date + "T00:00:00");
    const end = new Date(date + "T23:59:59");
    where.createdAt = { gte: start, lte: end };
  }

  if (mechanicId) {
    where.mechanicId = mechanicId;
  }

  const logs = await prisma.assemblyLog.findMany({
    where,
    include: {
      mechanic: { select: { name: true, emoji: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ logs });
}

// POST — log an assembly with photo (FormData)
export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_assembly", "create");
  if (authError) return authError;
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const formData = await req.formData();
  const assemblyType = formData.get("assemblyType") as string;
  const file = formData.get("file") as File | null;

  if (!assemblyType || !["A50", "A85", "FULL"].includes(assemblyType)) {
    return NextResponse.json({ error: "Invalid assembly type" }, { status: 400 });
  }

  if (!file || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Photo required" }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB" }, { status: 400 });
  }

  try {
    // Upload to Vercel Blob
    const storage = await tryGetStorage();
    if (!storage) {
      return NextResponse.json(
        { error: "Storage is not configured. Set it up in Settings > Storage." },
        { status: 503 }
      );
    }

    const ext = file.type.split("/")[1] || "jpg";
    const url = await storage.put(
      `service/assembly/${user.id}-${Date.now()}.${ext}`,
      await file.arrayBuffer(),
      file.type
    );

    const log = await prisma.assemblyLog.create({
      data: {
        mechanicId: user.id,
        assemblyType,
        photos: [url],
      },
      include: {
        mechanic: { select: { name: true, emoji: true } },
      },
    });

    return NextResponse.json({ log });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
