// Bin configuration — dependency-free so both API routes and client components can import it
// without pulling in server-only modules.
//
// Bin-level tracking is intentionally DORMANT (not deleted). The Bin model, its API routes,
// and the per-unit allocation flow all remain in the codebase. While BIN_TRACKING_ENABLED is
// false:
//   - bin UI is hidden from the frontend
//   - inbound/transfers/counts operate on WAREHOUSES, not bins
// Flip this to true to bring bins back.
export const BIN_TRACKING_ENABLED = false;

// ─── What used to live here ──────────────────────────────────────────────────
//
// STOCK_LOCATIONS, type StockLocation, isStockLocation, stockLocationLabel and
// DEFAULT_STOCK_LOCATION are GONE. Locations are rows now — the `Store` and `Warehouse`
// tables — and a hardcoded list of four cannot describe a set an admin edits at runtime.
//
// Read them from the database instead:
//
//   server   src/lib/warehouses.ts   listWarehouses(), warehouseByCode(), assertWarehouse()
//   client   GET /api/warehouses, GET /api/stores   (requireAuth only — see those routes)
//
// DEFAULT_STOCK_LOCATION has NO replacement, deliberately. It was safe only because the enum
// guaranteed a valid value existed at compile time; with warehouses as data there is no such
// guarantee, and the failure it hid is expensive — stock recorded at BCH that physically
// arrived at BCC produces a count discrepancy at both sites and an error at neither. The two
// routes that used it now reject a missing warehouse with a 400. See the plan's Phase 5.
