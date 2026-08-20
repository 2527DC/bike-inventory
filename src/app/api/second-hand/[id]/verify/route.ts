export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// POST: Verify a second-hand cycle (Ranju or Admin)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireFeature("second_hand", "approve");
    const { id } = await params;

    const cycle = await prisma.secondHandCycle.findUnique({ where: { id } });
    if (!cycle) return errorResponse("Cycle not found", 404);
    if (cycle.isVerified) return errorResponse("Already verified", 400);

    const updated = await prisma.secondHandCycle.update({
      where: { id },
      data: {
        isVerified: true,
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
    });

    return successResponse(updated);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 400);
  }
}
