export const dynamic = "force-dynamic";
// Reads every sizeless bicycle and writes back in a handful of statements. Bounded by SCAN_CAP
// below, but the read itself crosses Mumbai to Singapore, so it gets the same 60 s the other
// bulk import routes get rather than the default.
export const maxDuration = 60;

import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { parseBicycleSize } from "@/lib/product-size";

const log = createLogger("products:backfill-size");

// Never rewrite the whole catalog in one request. If more than this needs doing, the button
// is pressed twice — a second run only sees what the first left behind, because a row that
// got a size no longer matches the query.
const SCAN_CAP = 5000;

// A single `IN (...)` with several thousand ids produces a very large query; same chunk size
// the pull uses for its lookups.
const UPDATE_CHUNK = 1000;

/**
 * POST — recover the wheel size of existing bicycles from their names.
 *
 * A one-off, person-triggered backfill, NOT a migration and NOT a scheduled job. Deliberately
 * so: the parse is a reading of a name, and a reading should be something someone chooses to
 * apply and can see the result of, not something that happens to the database on deploy.
 *
 * It only ever fills a blank. The `size: null` predicate is repeated on the write, not just
 * the read, so a size typed by a person between the two — or by a second person pressing this
 * button at the same time — is never overwritten. That rule is the whole reason this is safe
 * to press twice.
 */
export async function POST() {
  const startedAt = Date.now();
  try {
    // stock.edit, not stock.create: this changes a field on rows that already exist.
    const user = await requireFeature("stock", "edit");

    const candidates = await prisma.product.findMany({
      where: {
        type: "BICYCLE",
        // Empty string counts as blank. Nothing writes one today, but a cleared text input is
        // one edit away from producing one, and a "" size renders no badge either.
        OR: [{ size: null }, { size: "" }],
      },
      select: { id: true, name: true },
      take: SCAN_CAP,
    });

    // Group by the size parsed out, so N products become at most one statement per distinct
    // wheel size (eight of them exist) instead of one statement per product.
    const bySize = new Map<string, string[]>();
    for (const p of candidates) {
      const size = parseBicycleSize(p.name);
      if (!size) continue;
      const ids = bySize.get(size);
      if (ids) ids.push(p.id);
      else bySize.set(size, [p.id]);
    }

    let updated = 0;
    const counts: Record<string, number> = {};
    for (const [size, ids] of bySize) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
        const result = await prisma.product.updateMany({
          // The blank check again. Between the read above and this write a person may have
          // typed a size on one of these rows; theirs wins.
          where: {
            id: { in: ids.slice(i, i + UPDATE_CHUNK) },
            type: "BICYCLE",
            OR: [{ size: null }, { size: "" }],
          },
          data: { size },
        });
        updated += result.count;
        counts[size] = (counts[size] || 0) + result.count;
      }
    }

    const unmatched = candidates.length - [...bySize.values()].reduce((n, ids) => n + ids.length, 0);

    log.info("size backfill finished", {
      requestedBy: user.id,
      scanned: candidates.length,
      updated,
      unmatched,
      capped: candidates.length === SCAN_CAP,
      bySize: counts,
      ms: Date.now() - startedAt,
    });

    return successResponse({
      scanned: candidates.length,
      updated,
      // Bicycles whose name begins with nothing recognisable as a wheel size. Reported rather
      // than hidden: it is the number that says whether the parse is worth keeping.
      unmatched,
      // True when the cap was hit and there is more to do — press again.
      hasMore: candidates.length === SCAN_CAP,
      bySize: counts,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    const message = error instanceof Error ? error.message : "Size backfill failed";
    log.error("size backfill failed", { message, ms: Date.now() - startedAt });
    return errorResponse(message, 500);
  }
}
