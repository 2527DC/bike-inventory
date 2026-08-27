export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { successResponse } from "@/lib/api-utils";
import { lmsProductUpdateSchema } from "@/lib/validations";
import { guarded, readBody, requireParam } from "@/lib/staff-lms/route";
import { serializeLmsProduct } from "@/lib/staff-lms/serialize";
import { AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("staff-lms:products");

export const GET = guarded(
  "staff_lms_products",
  "view",
  "staff-lms:products",
  async ({ params }) => {
    const id = requireParam(params, "id");
    const row = await prisma.lmsProduct.findUnique({
      where: { id },
      include: {
        videos: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!row) throw new AuthError("Product not found", 404);

    const { videos, ...product } = row;
    return successResponse({ ...serializeLmsProduct(product), videos });
  }
);

export const PUT = guarded(
  "staff_lms_products",
  "edit",
  "staff-lms:products",
  async ({ req, params, user }) => {
    const id = requireParam(params, "id");
    const data = lmsProductUpdateSchema.parse(await readBody(req));

    // Checked rather than caught: Prisma raises P2025 on an update against a missing row,
    // which `failure()` reports as a 500. Editing something that is not there is a 404.
    if ((await prisma.lmsProduct.count({ where: { id } })) === 0) {
      throw new AuthError("Product not found", 404);
    }

    const updated = await prisma.lmsProduct.update({
      where: { id },
      data: data as Prisma.LmsProductUncheckedUpdateInput,
    });
    log.info("product updated", { productId: id, by: user.id });
    return successResponse(serializeLmsProduct(updated));
  }
);

/**
 * Soft delete — flips `isActive`, never removes the row.
 *
 * A learner's `lms_activity_log` rows reference products by id in their `details` JSON, and
 * `lms_progress.videosWatched` holds video ids. Hard-deleting a product would leave those
 * pointing at nothing, so the profile and performance screens would render blanks in place
 * of history someone actually earned.
 */
export const DELETE = guarded(
  "staff_lms_products",
  "delete",
  "staff-lms:products",
  async ({ params, user }) => {
    const id = requireParam(params, "id");
    if ((await prisma.lmsProduct.count({ where: { id } })) === 0) {
      throw new AuthError("Product not found", 404);
    }

    await prisma.lmsProduct.update({ where: { id }, data: { isActive: false } });
    log.info("product deactivated", { productId: id, by: user.id });
    return successResponse({ id, isActive: false });
  }
);
