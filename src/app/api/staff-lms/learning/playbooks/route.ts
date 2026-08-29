export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsScenarioSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { serializeLmsScenario } from "@/lib/staff-lms/serialize";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:playbooks");

/**
 * Win-a-client playbooks — "scenarios" in the source app and in the table name
 * (`lms_scenarios`), "Playbooks" everywhere a person can read it. The table keeps the old
 * name because renaming it buys nothing; the UI uses the word sellers actually use.
 */
export const GET = guarded("staff_lms_learning", "view", "staff-lms:playbooks", async ({ req }) => {
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const type = url.searchParams.get("type");

  const rows = await prisma.lmsScenario.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      ...(type ? { type } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return successResponse(rows.map(serializeLmsScenario));
});

export const POST = guarded(
  "staff_lms_learning",
  "create",
  "staff-lms:playbooks",
  async ({ req, user }) => {
    const data = lmsScenarioSchema.parse(await readBody(req));
    const created = await prisma.lmsScenario.create({ data });
    log.info("playbook created", { playbookId: created.id, by: user.id });
    return successResponse(serializeLmsScenario(created), 201);
  }
);
