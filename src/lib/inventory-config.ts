// Bin tracking is ALWAYS ON (plan 2109, Q27). The unused `BIN_TRACKING_ENABLED` constant that
// lived here, the `AppSetting` switch (`src/lib/settings/bin-tracking.ts`), `useBinTracking()`
// and `/api/settings/bin-tracking` were all removed: a bin is mandatory wherever stock lands.

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
