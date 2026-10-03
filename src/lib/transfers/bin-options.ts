/**
 * The shape of `GET /api/transfer-orders/bin-options` — plan 0310, Part C (2209 Phase 1). Types
 * only, so the route and the browser hook share one definition without the browser importing a
 * route module.
 */

export interface TransferBinOption {
  id: string;
  code: string;
  name: string;
}

export interface TransferBinOptions {
  /** productId → the source warehouse's bins holding it, with how many. Most first. */
  fromBins: Record<string, (TransferBinOption & { qty: number })[]>;
  /** productId → the destination bin its home-bin rule locks it to, or null. */
  ruleBins: Record<string, TransferBinOption | null>;
  /** Every active bin of the destination warehouse. */
  toBins: (TransferBinOption & { nonAssemblable: boolean })[];
}
