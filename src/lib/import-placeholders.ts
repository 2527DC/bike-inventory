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
 * Every name that means "no real brand", whatever wrote the row.
 *
 * Three writers, three spellings, one meaning:
 *   Imported    the Zoho item import. Nothing writes it any more — that import was deleted —
 *               but rows created before then still carry it.
 *   Unbranded   `scripts/import-products.ts`, for all 8,175 rows of the catalog import.
 *   General     seen on hand-created rows; `api/stock-counts/[id]` has always treated it as
 *               overwritable, and that list is now defined here instead of inline.
 *
 * One definition rather than three, because the display test and the "Needs details" filter
 * MUST agree. If they drift, a card renders as needing a brand while the filter meant to
 * collect it passes it by — and a filter that finds nothing looks exactly like a catalog
 * with no problems.
 */
const PLACEHOLDER_BRAND_NAMES = [PLACEHOLDER_BRAND, "Unbranded", "General"];

/** Lower-cased, for the case-insensitive Prisma `in` filter in `api/products`. */
export const PLACEHOLDER_BRAND_NAMES_LOWER = PLACEHOLDER_BRAND_NAMES.map((n) => n.toLowerCase());

/**
 * True when the brand on a product is a placeholder, not a real manufacturer.
 *
 * Case-insensitive on purpose, and the "Needs details" query matches the same way. A person
 * can rename a brand from /more/brands; if the two disagreed about case the filter would
 * silently miss rows the card is flagging.
 */
export function isPlaceholderBrand(name: string | null | undefined): boolean {
  return PLACEHOLDER_BRAND_NAMES_LOWER.includes((name ?? "").trim().toLowerCase());
}

/**
 * True when the category on a product is the import's placeholder.
 *
 * NOTE: this is no longer a "needs attention" signal and must not be used as one. Every
 * product the catalog import creates is `Uncategorized`, so it is the normal state of the
 * whole catalog rather than the exception — which is why the "Needs details" filter and the
 * /stock card both stopped testing it. Kept because the bill import still writes the name
 * (`api/zoho/pull-review/approve`), and something may yet want to ask.
 */
export function isPlaceholderCategory(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === PLACEHOLDER_CATEGORY.toLowerCase();
}
