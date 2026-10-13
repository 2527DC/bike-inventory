export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { errorResponse, failure, paginatedResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { CASE_SELECT, NOTE_SELECT, toCaseDto, toNoteDto } from "./_lib/case-shape";

const log = createLogger("bank-suspense");

const listQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  bankAccountId: z.string().min(1).max(64).optional(),
  // "me", or a user id
  assignee: z.string().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/bank-suspense — one suspense list across every account (plan
// 1210-bank-accounts-and-suspense, R10, D2).
//   ?status=open|closed|all  (open by default)  &bankAccountId=  &assignee=me|<userId>  &page=
// Order: open cases first, longest-parked first (the oldest unexplained money is the most
// urgent); closed cases after them, most recently closed first — history reads newest first.
export async function GET(req: NextRequest) {
  try {
    const user = await requireFeature("bank_recon", "view");
    // An empty parameter (`bankAccountId=` from a cleared select) means "no filter", not a bad id.
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const q = listQuerySchema.parse(raw);

    const where: Prisma.BankSuspenseWhereInput = {
      ...(q.status === "open" ? { resolvedAt: null } : q.status === "closed" ? { resolvedAt: { not: null } } : {}),
      ...(q.assignee ? { assigneeId: q.assignee === "me" ? user.id : q.assignee } : {}),
      ...(q.bankAccountId ? { bankTxn: { bankAccountId: q.bankAccountId } } : {}),
    };
    const orderBy: Prisma.BankSuspenseOrderByWithRelationInput[] =
      q.status === "open"
        ? [{ parkedAt: "asc" }, { id: "asc" }]
        : q.status === "closed"
          ? [{ resolvedAt: "desc" }, { id: "asc" }]
          : [{ resolvedAt: { sort: "desc", nulls: "first" } }, { parkedAt: "asc" }, { id: "asc" }];

    const started = Date.now();
    const [total, cases] = await Promise.all([
      prisma.bankSuspense.count({ where }),
      prisma.bankSuspense.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        // Notes written in one statement (parkLine's "Parked" + "Assigned to") share a timestamp;
        // the cuid breaks the tie in the order they were written.
        select: { ...CASE_SELECT, notes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: NOTE_SELECT } },
      }),
    ]);

    const now = new Date();
    const rows = cases.map((c) => ({
      ...toCaseDto(c, now),
      lastNote: c.notes[0] ? toNoteDto(c.notes[0]) : null,
    }));

    log.debug("suspense listed", {
      status: q.status,
      bankAccountId: q.bankAccountId ?? null,
      assignee: q.assignee ? (q.assignee === "me" ? "me" : "user") : null,
      page: q.page,
      rows: rows.length,
      total,
      ms: Date.now() - started,
    });
    return paginatedResponse(rows, total, q.page, q.limit);
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("suspense list refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message ?? "Invalid filter";
      log.warn("suspense list filter rejected", { message });
      return errorResponse(message, 400);
    }
    return failure(error, { scope: "bank-suspense", step: "list" });
  }
}
