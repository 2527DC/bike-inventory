export const dynamic = "force-dynamic";

// GET /api/stores/zoho-locations — Zoho Books' locations, for linking a store to one on /stores
// (plan 1210 credit notes, Part 2.3; Q2 answered 13 Oct 2026: Zoho uses Locations).
//
// One read (`GET /locations`, scope settings.READ, granted). Writes nothing — the link is saved
// by PUT /api/stores/[id] { zohoLocationId }. Zoho returns "BHARATH CYCLE HUB" (primary),
// "bharath cycle centre", a warehouse sub-location under each (parent_location_id) and
// GODOWN 1–3; each comes back with the store already linked to it, if any.
//
// Guarded by stores.edit: only the people who can save the link need the list.
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("stores:zoho-location");

export async function GET() {
  try {
    await requireFeature("stores", "edit");

    const books = await getBooks();
    if (!books) {
      log.warn("locations refused — Zoho Books is not connected");
      return errorResponse("Zoho Books is not connected. Connect it in Settings › Integrations, then try again.", 503);
    }

    let zohoLocations;
    try {
      const started = Date.now();
      log.debug("-> locations.list");
      zohoLocations = (await books.listLocations()).locations ?? [];
      log.debug("<- locations.list", { count: zohoLocations.length, ms: Date.now() - started });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("locations read failed", { message });
      return errorResponse(`Zoho Books did not return its locations: ${message}`, 502);
    }

    const linked = await prisma.store.findMany({
      where: { zohoLocationId: { not: null } },
      select: { id: true, code: true, name: true, isActive: true, zohoLocationId: true },
    });
    const byLocation = new Map(linked.map((s) => [s.zohoLocationId as string, s]));

    const locations = zohoLocations
      .filter((l) => l.location_id)
      .map((l) => {
        const store = byLocation.get(l.location_id);
        return {
          id: l.location_id,
          name: l.location_name,
          primary: Boolean(l.is_primary_location),
          active: l.is_location_active !== false,
          parentId: l.parent_location_id || null,
          linkedStore: store ? { id: store.id, code: store.code, name: store.name, isActive: store.isActive } : null,
        };
      });

    // A store linked to a location Zoho no longer lists (deleted there) — shown, so the link can
    // be cleared rather than silently pointing nowhere.
    const known = new Set(locations.map((l) => l.id));
    const orphanLinks = linked
      .filter((s) => !known.has(s.zohoLocationId as string))
      .map((s) => ({ storeId: s.id, storeName: s.name, zohoLocationId: s.zohoLocationId }));
    if (orphanLinks.length) log.warn("stores linked to a location Zoho does not list", { storeIds: orphanLinks.map((o) => o.storeId) });

    log.debug("locations listed", { count: locations.length, linked: linked.length });
    return successResponse({ locations, orphanLinks });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("locations list failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse("Could not load Zoho locations. Try again.", 500);
  }
}
