/**
 * Reading `Product.productType` without breaking the screens that still say `type`.
 *
 * `Product.type` was a Prisma enum; it is now a `productTypeId` pointing at the `ProductType`
 * table, so `select: { type: true }` no longer compiles and every list endpoint had to change.
 *
 * ─── WHY AN ALIAS AND NOT A CLEAN RENAME ─────────────────────────────────────────────────
 *
 * Seventeen files under `(dashboard)` declare their OWN `interface { type: string }` over a
 * `fetch` result rather than importing a Prisma type. The compiler has nothing to compare
 * those against, so simply dropping `type` from the responses would leave every one of them
 * reading `undefined` with a completely green `npm run build` — and at
 * `stock-audit/brand-count/page.tsx` it would throw outright on `p.type.replace(...)`.
 * That failure mode is recorded as §15.3 of the Stock Management plan.
 *
 * So the shape carries both:
 *   `productType: { id, name }`  — the truth, for anything that filters, writes, or links
 *   `type: string | null`        — the NAME, so existing readers keep rendering
 *
 * The alias is a migration aid, not a permanent fixture. When the last screen reads
 * `productType.name`, delete `withTypeName` and the `type` key with it.
 *
 * Note the displayed value changes: cards that showed `SPARE_PART` now show `Spares`, because
 * the name is what a person actually chose. That is an improvement, not a regression.
 */

/** The one shape every Product select should ask for. */
export const PRODUCT_TYPE_SELECT = { select: { id: true, name: true } } as const;

type WithProductType = { productType: { id: string; name: string } | null };

/** Adds the flat `type` name alongside the relation. */
export function withTypeName<T extends WithProductType>(row: T): T & { type: string | null } {
  return { ...row, type: row.productType?.name ?? null };
}

/** The same, for a row that nests the product one level down (serials, stock-count items). */
export function withNestedTypeName<T extends { product: WithProductType | null }>(
  row: T
): T & { product: (WithProductType & { type: string | null }) | null } {
  return {
    ...row,
    product: row.product ? withTypeName(row.product) : null,
  };
}
