export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsScenarioUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { serializeLmsScenario } from "@/lib/staff-lms/serialize";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:playbooks");

export const GET = guarded(
  "staff_lms_learning",
  "view",
  "staff-lms:playbooks",
  async ({ params }) => {
    const id = requireParam(params, "id");
    const row = await prisma.lmsScenario.findUnique({ where: { id } });
    if (!row) throw new AuthError("Playbook not found", 404);
    return successResponse(serializeLmsScenario(row));
  }
);

export const PUT = guarded(
  "staff_lms_learning",
  "edit",
  "staff-lms:playbooks",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsScenarioUpdateSchema.parse(await readBody(req));
    if ((await prisma.lmsScenario.count({ where: { id } })) === 0) {
      throw new AuthError("Playbook not found", 404);
    }
    const updated = await prisma.lmsScenario.update({ where: { id }, data });
    log.info("playbook updated", { playbookId: id, by: user.id });
    return successResponse(serializeLmsScenario(updated));
  }
);

/**
 * Soft delete. Same reasoning as videos: completed playbook ids live in
 * `lms_progress.scenariosCompleted`, a String[] with no foreign key, so a hard delete would
 * leave dangling ids nothing ever cleans up.
 */
export const DELETE = guarded(
  "staff_lms_learning",
  "delete",
  "staff-lms:playbooks",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsScenario.count({ where: { id } })) === 0) {
      throw new AuthError("Playbook not found", 404);
    }
    await prisma.lmsScenario.update({ where: { id }, data: { isActive: false } });
    log.info("playbook deactivated", { playbookId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
