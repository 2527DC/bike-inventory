// Bin configuration — dynamic setting backed by PostgreSQL `AppSetting` and fallback `process.env.BIN_TRACKING_ENABLED`.
//
// For Server / API routes: import { isBinTrackingEnabled } from "@/lib/settings/bin-tracking";
// For Client components:  import { useBinTracking } from "@/hooks/use-bin-tracking";
//
// Environment fallback:
export const BIN_TRACKING_ENABLED =
  process.env.BIN_TRACKING_ENABLED === "true" ||
  process.env.BIN_TRACKING_ENABLED === "1";

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
