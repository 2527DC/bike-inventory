// `revalidate = 300` used to sit here and did nothing: both handlers call requireFeature,
// which reads cookies, so the route is dynamic and was never cached. It read as a promise
// of caching that no request ever got.
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { brandSchema } from "@/lib/validations";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const log = createLogger("api:brands");

// Active rows by default. Every picker in the app reads this list, so hiding an inactive
// brand HERE is what makes "inactive" mean anything — no picker filters on its own. The two
// master screens pass `includeInactive` (the vendor list spells it `true`, the new screens
// `1`; both are accepted) to show the retired rows with a badge.
export async function GET(req: NextRequest) {
  try {
    await requireFeature("brands", "view");
    const flag = req.nextUrl.searchParams.get("includeInactive");
    const includeInactive = flag === "1" || flag === "true";
    const brands = await prisma.brand.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    log.debug("brands listed", { count: brands.length, includeInactive });
    return successResponse(brands);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch brands";
    log.error("brand list failed", { message });
    return errorResponse(message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFeature("brands", "create");
    const body = await req.json();
    const data = brandSchema.parse(body);

    // Brand.name is unique on lower(btrim(name)) — migration brand_name_ci_unique. Answer with
    // the brand that already holds the name rather than a raw constraint violation.
    const clash = await prisma.brand.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
      select: { name: true },
    });
    if (clash) return errorResponse(`"${clash.name}" already exists.`, 409);

    const brand = await prisma.brand.create({ data });
    log.info("brand created", { brandId: brand.id });
    return successResponse(brand, 201);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    // The pre-check above lost a race: another request inserted the same name between the
    // read and the write, and the case-insensitive index refused this one.
    if ((error as { code?: string } | null)?.code === "P2002") {
      log.warn("brand create lost a race to a duplicate");
      return errorResponse("A brand with that name already exists.", 409);
    }
    return errorResponse(error instanceof Error ? error.message : "Failed to create brand", 400);
  }
}
