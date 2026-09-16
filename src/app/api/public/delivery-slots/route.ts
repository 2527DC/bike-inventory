export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { createLogger } from "@/lib/logger";
import { buildSlotCalendar } from "@/lib/deliveries/slots";

/**
 * The customer's delivery-date calendar. PUBLIC BY DESIGN — the self-fill form at `/fill/[token]`
 * calls it with no session (CLAUDE.md "Routes that must stay public").
 *
 * The counting rules live in `src/lib/deliveries/slots.ts` (plan 1609-deliveries, T9) so this
 * calendar, the customer's submit and the staff date editor agree on what "full" means.
 */
const log = createLogger("public:delivery-slots");

export async function GET() {
  try {
    const { slots, nextAvailable } = await buildSlotCalendar(prisma);
    log.debug("slot calendar built", { days: slots.length, nextAvailable });
    return successResponse({ slots, nextAvailable });
  } catch (error) {
    log.error("slot calendar failed", {
      name: error instanceof Error ? error.name : "non-Error thrown",
      error: error instanceof Error ? error.message : undefined,
    });
    return errorResponse("Failed to fetch delivery slots", 500);
  }
}
