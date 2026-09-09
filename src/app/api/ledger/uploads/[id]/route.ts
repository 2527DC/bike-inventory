export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { StorageNotConfiguredError } from "@/lib/storage";
import { deleteLedgerFile } from "@/lib/brand-ledger/uploads";

const log = createLogger("ledger:uploads");

// DELETE — remove the object from storage (R12), then mark the row. The row and its runs stay:
// a run that was accepted into the ledger keeps its provenance even after the file is gone.
//
// The order matters. The object goes first, and a refusal from the provider is a 502 — the
// owner pressed Delete and must learn the file is still there, not find a row that says
// "deleted" over an object that is not.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let step = "load";
  try {
    const user = await requireFeature("brand_ledger", "delete");
    const { id } = await params;

    const upload = await prisma.ledgerUpload.findUnique({
      where: { id },
      select: { id: true, vendorId: true, fileName: true, fileUrl: true, deletedAt: true },
    });
    if (!upload) return errorResponse("Upload not found", 404);
    if (!upload.fileUrl || upload.deletedAt) return successResponse({ deleted: true, alreadyDeleted: true });

    step = "delete-object";
    try {
      await deleteLedgerFile(upload.fileUrl);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) return errorResponse(e.message, 501);
      const reason = e instanceof Error ? e.message : String(e);
      log.error("file delete refused by storage", { uploadId: id, vendorId: upload.vendorId, reason });
      return errorResponse(`The file could not be deleted from storage: ${reason}`, 502);
    }

    step = "mark";
    await prisma.ledgerUpload.update({ where: { id }, data: { fileUrl: null, deletedAt: new Date() } });
    log.info("upload deleted", { uploadId: id, vendorId: upload.vendorId, userId: user.id });
    return successResponse({ deleted: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return failure(error, { scope: "ledger:uploads", step });
  }
}
