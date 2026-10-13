export const dynamic = "force-dynamic";

// GET /api/vendors/[id]/ledger?storeId&page&pageSize&all=1 — one supplier's ledger.
// Plan 1210 credit notes and payables, Part 6.2. The rules (D9, Q8, Q14) live in
// src/lib/payables/ledger.ts; this route only validates the query and shapes errors.
//
//   storeId   a Store id, "none" for rows with no store, omitted for every store
//   page      1-based, newest rows first; the balance column is continuous across pages
//   pageSize  1–200, default 50
//   all=1     every row up to 5,000, for the Excel export (page/pageSize ignored)

import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
  vendorLedger,
  LedgerNotFoundError,
  LEDGER_DEFAULT_PAGE_SIZE,
  LEDGER_MAX_PAGE_SIZE,
} from "@/lib/payables/ledger";

const log = createLogger("payables:ledger");

const querySchema = z.object({
  storeId: z.string().trim().min(1).max(64).optional(),
  page: z.coerce.number().int("Page must be a whole number").min(1, "Page starts at 1").max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int("Page size must be a whole number")
    .min(1, "Page size must be at least 1")
    .max(LEDGER_MAX_PAGE_SIZE, `Page size can be at most ${LEDGER_MAX_PAGE_SIZE}`)
    .default(LEDGER_DEFAULT_PAGE_SIZE),
  all: z.enum(["1", "true", "0", "false"]).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let vendorId: string | undefined;
  try {
    await requireFeature("vendors", "view");
    vendorId = (await params).id;

    const sp = req.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      storeId: sp.get("storeId") || undefined,
      page: sp.get("page") || undefined,
      pageSize: sp.get("pageSize") || undefined,
      all: sp.get("all") || undefined,
    });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid ledger query";
      log.warn("ledger query refused", { vendorId, message });
      return errorResponse(message, 400);
    }
    const q = parsed.data;

    const ledger = await vendorLedger(vendorId, {
      storeId: q.storeId,
      page: q.page,
      pageSize: q.pageSize,
      all: q.all === "1" || q.all === "true",
    });
    return successResponse(ledger);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    if (error instanceof LedgerNotFoundError) {
      log.warn("ledger not found", { vendorId, message: error.message });
      return errorResponse(error.message, 404);
    }
    log.error("ledger failed", {
      vendorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("Could not load the supplier ledger. Try again.", 500);
  }
}
