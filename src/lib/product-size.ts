/**
 * The wheel sizes this shop sells, and the parse that recovers one from a product name.
 *
 * Zoho has no size field, so every imported bicycle arrives with `size = null` and the
 * /stock card renders no size badge — even when the size is sitting in the product's own
 * name. In this catalog it is written two ways, and BOTH have to be read:
 *
 *     16'' BICYCLE S/S (BONITA)                                  ->  16"   (leading)
 *     HSBC/E BICYCLE HERCULES BRUTE 27.5T SS AQUAHAZE/BLK        ->  27.5" (mid-name, T suffix)
 *     POLYGON BRAND BICYCLE XTRADA 7 29 2024-PURPLE WHITE M(18)' ->  29"   (mid-name)
 *     AOKI E-BICYCLE STREET MAMBA BLUE                           ->  null  (no size in the name)
 *
 * The first version of this only read a LEADING size, which is what the plan described. Run
 * against a real 132-item pull it reached 1 bicycle in 12: the older `26''BICYCLE S/S(…)`
 * naming puts the size first, but the newer brand-first naming (`HERCULES BRUTE 27.5T SS`)
 * puts it in the middle. Searching the whole name takes that to 5 in 12, and the rest
 * genuinely have no size to find.
 *
 * Dependency-free — the approve route, the backfill route and the /stock screen all read it.
 */

// Stored WITH the inch mark, because that is what the rest of the application already uses:
// the schema comment (`size String? // For bicycles: 16", 20", 24", 26", etc.`), the /stock
// size filter, the second-hand intake's wheel-size picker, and the product edit field's
// `e.g. 26"` placeholder. A bare `26` would render a badge that the size filter — which
// sends `26"` and matches exactly — could never select.
export const BICYCLE_SIZES = ['12"', '14"', '16"', '20"', '24"', '26"', '27.5"', '29"'] as const;

/*
 * Built FROM `BICYCLE_SIZES` rather than repeating it. The sizes the /stock filter offers and
 * the sizes an import can write have to be one list — a parsed size the filter cannot select
 * is a badge with nothing behind it — and two hand-maintained copies drift.
 *
 * Longest first, because alternation is ordered and JS takes the first branch that matches:
 * `27.5` must be tried before any two-digit branch or it could never be reached.
 */
const SIZE_ALTERNATION = [...BICYCLE_SIZES]
  .map((s) => s.replace('"', ""))
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(".", "\\."))
  .join("|");

/*
 * Anywhere in the name, but only as a STANDALONE NUMBER, and only a size on the list above.
 * Every piece is load-bearing; the danger of a whole-name search is a number that means
 * something else, and these are the numbers that actually appear in these names.
 *
 *   (?:^|[^\w.])  Start of string, or a character that is not a letter, digit or dot.
 *                 `2024` -> the `24` is preceded by `0`, rejected. A model year survives.
 *                 `V26`  -> preceded by a letter, rejected. A model code is not a size.
 *
 *                 Written as a consuming group rather than the lookbehind `(?<![\w.])` this
 *                 obviously wants to be. Lookbehind is unsupported in Safari before 16.4, and
 *                 this module is imported by `/stock` for BICYCLE_SIZES — so the regex is
 *                 built in the browser bundle too, and an unsupported one throws at module
 *                 load and takes the whole page down. On a phone-first app that is not a
 *                 theoretical browser.
 *
 *   (?:…)?        An optional unit suffix, so the boundary test lands after it rather than on
 *                 it: `27.5T` (tyre notation), `26''`, `26"`, `29 INCH`. `T\b` and `inch\b`
 *                 are anchored so they cannot eat into a word.
 *
 *   (?![\d.])     Not followed by another digit or a dot.
 *                 `2024`        -> `20` is followed by `2`, rejected. Both halves now fail.
 *                 `26''BICYCLE` -> a letter after the consumed `''` is fine; this only has to
 *                                  rule out more digits.
 *
 * FIRST match wins, scanning left to right, so a leading size is still preferred
 * automatically and a name carrying two sizes resolves predictably rather than arbitrarily.
 */
const WHEEL_SIZE = new RegExp(
  `(?:^|[^\\w.])(${SIZE_ALTERNATION})(?:\\s*(?:''|"|”|T\\b|inch\\b))?(?![\\d.])`,
  "i"
);

/**
 * A wheel size found in a product name, or null.
 *
 * Two rules for every caller, both from the plan and both load-bearing:
 *
 *   1. Only apply it when `type === "BICYCLE"`. This is now the ONLY thing keeping the parse
 *      off spare parts: a whole-name search reads `BRAKE CABLE 26 INCH` and `TUBE 26X1.75`
 *      as 26" quite happily, because in isolation it cannot tell a wheel from a cable that
 *      fits one. The leading-only version was self-limiting; this one is not, and the type
 *      gate carries the weight the regex used to.
 *
 *   2. Never use it to overwrite a size a person typed. It fills blanks, it does not correct.
 */
export function parseBicycleSize(name: string | null | undefined): string | null {
  const match = WHEEL_SIZE.exec(name ?? "");
  return match ? `${match[1]}"` : null;
}
