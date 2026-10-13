export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse, failure } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("bank-suspense");

// GET /api/bank-suspense/assignees — the staff a suspense line can be given to (plan
// 1210-bank-accounts-and-suspense, D2/D4). Exists because /api/users needs team.view, which
// bank staff do not hold (§2.4). Active users, id and name only: nothing else about a person
// leaves this route. Who may then actually work the line is decided by their own grants.
export async function GET() {
  try {
    await requireFeature("bank_recon", "edit");
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    log.debug("assignees listed", { count: users.length });
    return successResponse({ users });
  } catch (error) {
    if (error instanceof AuthError) {
      log.warn("assignee list refused", { status: error.status });
      return errorResponse(error.message, error.status);
    }
    return failure(error, { scope: "bank-suspense", step: "assignees" });
  }
}
