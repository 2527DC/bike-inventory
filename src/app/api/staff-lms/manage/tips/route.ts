export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { lmsDailyTipSchema, lmsDailyTipUpdateSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:tips");

/** Every tip, scheduled or not — the editor's list. The dashboard picks today's. */
export const GET = guarded("staff_lms", "view", "staff-lms:tips", async () => {
  const rows = await prisma.lmsDailyTip.findMany({
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
  });
  return successResponse(rows);
});

export const POST = guarded("staff_lms", "create", "staff-lms:tips", async ({ req, user }) => {
  const data = lmsDailyTipSchema.parse(await readBody(req));
  const created = await prisma.lmsDailyTip.create({ data });
  log.info("tip created", { tipId: created.id, by: user.id });
  return successResponse(created, 201);
});

export const PUT = guarded("staff_lms", "edit", "staff-lms:tips", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);
  const data = lmsDailyTipUpdateSchema.parse(await readBody(req));
  if ((await prisma.lmsDailyTip.count({ where: { id } })) === 0) {
    throw new AuthError("Tip not found", 404);
  }
  const updated = await prisma.lmsDailyTip.update({ where: { id }, data });
  log.info("tip updated", { tipId: id, by: user.id });
  return successResponse(updated);
});

export const DELETE = guarded("staff_lms", "delete", "staff-lms:tips", async ({ req, user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new AuthError("id is required", 400);
  if ((await prisma.lmsDailyTip.count({ where: { id } })) === 0) {
    throw new AuthError("Tip not found", 404);
  }
  await prisma.lmsDailyTip.delete({ where: { id } });
  log.info("tip deleted", { tipId: id, by: user.id });
  return successResponse({ id });
});
