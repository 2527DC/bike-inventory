export const dynamic = "force-dynamic";

// GET /api/stock/locations — the Location and Bin pickers on /stock (plan
// 1410-stock-location-and-bin, A1). Each store's active locations, each location's active bins,
// and what each holds now:
//
//   { stores: [{ id, code, name, warehouses: [{ id, code, name, kind, products, items,
//       noBin: { products, items }, bins: [{ id, code, name, products, items }] }] }] }
//
// The numbers come from getWarehouseHoldings, the function the list's "No bin" scope reads and
// the same rule as getBinQtyMap behind a bin scope, over ACTIVE products — so the count beside a
// bin in the picker is the total the list shows when that bin is chosen.
//
// Guarded by stock.view, NOT bins.view: the pickers sit on /stock, which ADMIN,
// INVENTORY_INWARDS, OUTWARDS and SALES_STAFF open, and in production only ADMIN holds
// bins.view (14 Oct 2026). GET /api/bins stays the admin Bins screen's route, unchanged.
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import { listStores } from "@/lib/stores";
import { listWarehouses } from "@/lib/warehouses";
import { getWarehouseHoldings } from "@/lib/units/bin-qty";

const log = createLogger("stock:locations");

interface Held {
  products: number;
  items: number;
}

export async function GET() {
  try {
    await requireFeature("stock", "view");
    const started = Date.now();

    const [stores, warehouses] = await Promise.all([listStores(), listWarehouses()]);
    const [bins, allHoldings] = await Promise.all([
      prisma.bin.findMany({
        where: { isActive: true, warehouseId: { in: warehouses.map((w) => w.id) } },
        select: { id: true, code: true, name: true, warehouseId: true },
        orderBy: { code: "asc" },
      }),
      Promise.all(warehouses.map((w) => getWarehouseHoldings(w.id))),
    ]);

    // Counted over ACTIVE products only: the list opens on ACTIVE (every chip but Inactive sends
    // status=ACTIVE), and a deactivated product can still hold stock — counting it would make the
    // number beside a bin larger than the list it opens.
    const heldIds = new Set<string>();
    // A bin's products, not only the location's: a bin quantity is read from the units and does
    // not depend on StockLevel, so a product can be in a bin while its StockLevel says 0.
    for (const h of allHoldings) {
      for (const id of h.atLocation.keys()) heldIds.add(id);
      for (const id of h.inBins.keys()) heldIds.add(id);
    }
    const active = new Set(
      (
        await prisma.product.findMany({
          where: { id: { in: [...heldIds] }, status: "ACTIVE" },
          select: { id: true },
        })
      ).map((p) => p.id)
    );
    const onlyActive = <V>(m: Map<string, V>) => new Map([...m].filter(([id]) => active.has(id)));
    const holdings = allHoldings.map((h) => ({
      atLocation: onlyActive(h.atLocation),
      inBins: onlyActive(h.inBins),
      noBin: onlyActive(h.noBin),
    }));

    const result = {
      stores: stores
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          warehouses: warehouses
            .map((w, i) => ({ w, h: holdings[i] }))
            .filter(({ w }) => w.storeId === s.id)
            .map(({ w, h }) => {
              const perBin = new Map<string, Held>();
              for (const byBin of h.inBins.values()) {
                for (const [binId, qty] of byBin) {
                  const held = perBin.get(binId) ?? { products: 0, items: 0 };
                  held.products += 1;
                  held.items += qty;
                  perBin.set(binId, held);
                }
              }
              const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
              return {
                id: w.id,
                code: w.code,
                name: w.name,
                kind: w.kind,
                products: h.atLocation.size,
                items: sum(h.atLocation),
                noBin: { products: h.noBin.size, items: sum(h.noBin) },
                // Bins holding stock first, then the empty ones (Q3); by code within each.
                bins: bins
                  .filter((b) => b.warehouseId === w.id)
                  .map((b) => ({ id: b.id, code: b.code, name: b.name, ...(perBin.get(b.id) ?? { products: 0, items: 0 }) }))
                  .sort((a, b) => Number(b.items > 0) - Number(a.items > 0) || a.code.localeCompare(b.code)),
              };
            }),
        }))
        .filter((s) => s.warehouses.length > 0),
    };

    log.debug("locations", {
      stores: result.stores.length,
      warehouses: warehouses.length,
      bins: bins.length,
      ms: Date.now() - started,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("locations failed", { reason: error instanceof Error ? error.message : String(error) });
    return errorResponse("Failed to load locations and bins", 500);
  }
}
