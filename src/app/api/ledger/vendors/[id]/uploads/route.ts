export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { StorageNotConfiguredError } from "@/lib/storage";
import { checkLedgerFile, contentTypeFor, storeLedgerFile } from "@/lib/brand-ledger/uploads";

const log = createLogger("ledger:uploads");

const kindSchema = z.enum(["STATEMENT", "CHAT", "SCREENSHOT", "DOCUMENT"]);

// GET — every file uploaded on this vendor's ledger screen, newest first, with its AI runs.
// A deleted file (R12) still lists: fileUrl null, deletedAt set, its runs intact.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireFeature("brand_ledger", "view");
    const { id } = await params;

    const uploads = await prisma.ledgerUpload.findMany({
      where: { vendorId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        fileUrl: true,
        deletedAt: true,
        createdAt: true,
        runs: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            task: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            chunks: true,
            error: true,
            proposals: true,
          },
        },
      },
    });

    return successResponse({
      uploads: uploads.map((u) => ({
        ...u,
        runs: u.runs.map(({ proposals, ...run }) => ({ ...run, proposalsCount: proposalsCount(proposals) })),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:uploads", step: "list" });
  }
}

function proposalsCount(proposals: unknown): number {
  if (!proposals || typeof proposals !== "object") return 0;
  const p = proposals as { rows?: unknown[]; claims?: unknown[] };
  return Array.isArray(p.rows) ? p.rows.length : Array.isArray(p.claims) ? p.claims.length : 0;
}

// POST — multipart `file` + `kind`. Storage is resolved BEFORE anything else costs money or
// time: a ledger upload exists to be read back by an AI run, so "stored nowhere" is a refusal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "parse";
  try {
    const user = await requireFeature("brand_ledger", "create");
    const { id } = await params;

    const form = await req.formData();
    const file = form.get("file");
    const kindParsed = kindSchema.safeParse(form.get("kind"));
    if (!kindParsed.success) return errorResponse("kind must be STATEMENT, CHAT, SCREENSHOT or DOCUMENT", 400);
    const kind = kindParsed.data;
    if (!(file instanceof File)) return errorResponse("No file uploaded", 400);

    const refusal = checkLedgerFile(kind, file.name, file.size);
    if (refusal) return errorResponse(refusal, 400);

    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return errorResponse("Vendor not found", 404);

    step = "store";
    const bytes = await file.arrayBuffer();
    const contentType = contentTypeFor(file.name);
    log.debug("storing upload", { vendorId: id, kind, bytes: bytes.byteLength, userId: user.id });
    const fileUrl = await storeLedgerFile(id, kind, file.name, contentType, bytes);

    step = "insert";
    const upload = await prisma.ledgerUpload.create({
      data: {
        vendorId: id,
        kind,
        fileName: file.name,
        contentType,
        sizeBytes: bytes.byteLength,
        fileUrl,
        uploadedById: user.id,
      },
      select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, fileUrl: true, deletedAt: true, createdAt: true },
    });
    log.info("upload stored", { uploadId: upload.id, vendorId: id, kind, bytes: bytes.byteLength });
    return successResponse({ ...upload, runs: [] }, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof StorageNotConfiguredError) return errorResponse(error.message, 501);
    return failure(error, { scope: "ledger:uploads", step });
  }
}
