export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { successResponse } from "@/lib/api-utils";
import { lmsProductSchema } from "@/lib/validations";
import { guarded, readBody } from "@/lib/staff-lms/route";
import { serializeLmsProduct } from "@/lib/staff-lms/serialize";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:products");

/**
 * List product playbooks.
 *
 * Returns the FULL row including every narrative Json column. That is deliberate: the
 * product list screen shows cards, but the compare screen and the flashcard deck both need
 * objections and specs for several products at once, and ~40 rows is not worth three
 * endpoints. Revisit if the catalog grows past a few hundred.
 */
export const GET = guarded("staff_lms_products", "view", "staff-lms:products", async ({ req }) => {
  const includeInactive = new URL(req.url).searchParams.get("includeInactive") === "true";

  const rows = await prisma.lmsProduct.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
  });

  return successResponse(rows.map(serializeLmsProduct));
});

export const POST = guarded(
  "staff_lms_products",
  "create",
  "staff-lms:products",
  async ({ req, user }) => {
    const data = lmsProductSchema.parse(await readBody(req));
    const created = await prisma.lmsProduct.create({
      data: data as Prisma.LmsProductUncheckedCreateInput,
    });
    log.info("product created", { productId: created.id, by: user.id });
    return successResponse(serializeLmsProduct(created), 201);
  }
);
