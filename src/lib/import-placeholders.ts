/**
 * The two names the Zoho import INVENTS.
 *
 * `Product.brandId` and `Product.categoryId` are non-null (`schema.prisma:449,451`), so an
 * import with no brand and no category cannot record "unknown" — it has to write something.
 * It writes these. They are not facts about the product; they are the absence of a fact,
 * wearing a name, and the /stock card used to render `Imported` in exactly the same blue as
 * a real brand like `Atlas`.
 *
 * They live here rather than as literals because five import sites spelled them
 * independently, and every screen that wants to say "this one still needs a person" has to
 * compare against the same spelling. One drifted literal and the "Needs details" filter
 * silently returns nothing — a filter that finds nothing looks exactly like a catalog with
 * no problems.
 *
 * Deliberately dependency-free: imported by both API routes and client components, so it
 * must not pull in prisma or anything server-only. Same rule as `inventory-config.ts`.
 *
 * The root cause is Part D of `docs/implementation/completed/imported-product-data-quality-plan.md`
 * — making the two columns nullable so absence can be recorded honestly. That is a schema
 * change touching every screen that assumes a brand and a category exist, and it is
 * deliberately not done here. Until it is, these are the marker.
 */
export const PLACEHOLDER_BRAND = "Imported";
export const PLACEHOLDER_CATEGORY = "Uncategorized";

/**
 * True when the brand on a product is the import's placeholder, not a real manufacturer.
 *
 * Case-insensitive on purpose, and the "Needs details" query in `api/products` matches the
 * same way (`mode: "insensitive"`). A person can rename a brand from /more/brands; if the
 * display test and the filter test disagreed about case, a card would render as a
 * placeholder while the filter that is supposed to collect it passed it by.
 */
export function isPlaceholderBrand(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === PLACEHOLDER_BRAND.toLowerCase();
}

/** True when the category on a product is the import's placeholder. See above. */
export function isPlaceholderCategory(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === PLACEHOLDER_CATEGORY.toLowerCase();
}
