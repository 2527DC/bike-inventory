export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse } from "@/lib/api-utils";
import { guarded } from "@/lib/staff-lms/route";
import { LMS_BRANDS, LMS_RIDING_STYLES, LMS_DIFFICULTIES, LMS_SCENARIO_TYPES, LMS_QUIZ_TYPES } from "@/lib/staff-lms/constants";

/**
 * Dropdown options for the content editor.
 *
 * Replaces the source app's `app_settings` table and its `GET /api/settings`, which held
 * exactly two keys (`brands`, `categories`) and was broken: the route ignored `?key=` and
 * never returned `value`, while the screen read `data.value`. The table, the route and the
 * settings screen are all gone rather than ported.
 *
 * Served from an endpoint rather than importing the constants into the client so an
 * external app gets the same lists over HTTP — no second source of truth to drift, and no
 * constants file to bundle.
 *
 * `brands` merges the frozen list with whatever is actually in use, so a brand typed by
 * hand last month appears in the dropdown this month WITHOUT a redeploy. That is the whole
 * reason the field is free text: the list is a convenience, never a constraint.
 */
export const GET = guarded("staff_lms", "view", "staff-lms:options", async () => {
  const inUse = await prisma.lmsProduct.findMany({
    where: { isActive: true },
    select: { brand: true },
    distinct: ["brand"],
  });

  const brands = [...new Set([...LMS_BRANDS, ...inUse.map((r) => r.brand)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return successResponse({
    brands,
    // Riding styles: MTB, Hybrid, Road… NOT the inventory `Category` table, which is a
    // product class (Bicycles, Spare Parts). See src/lib/staff-lms/constants.ts.
    ridingStyles: LMS_RIDING_STYLES,
    difficulties: LMS_DIFFICULTIES,
    scenarioTypes: LMS_SCENARIO_TYPES,
    quizTypes: LMS_QUIZ_TYPES,
  });
});
