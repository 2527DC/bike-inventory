/**
 * Indian mobile numbers, in the one format the deliveries flow writes (plan 1609-deliveries).
 *
 * Owner, 16 Sep 2026: every phone in this flow is written `+91-XXXXXXXXXX` (A12b) so that
 * comparing two numbers is plain text equality (A3b); a number of the wrong length keeps its
 * digits rather than being truncated into a different person (A3 — `+91-89512050058` stays as
 * written). Existing `Customer` rows are bare 10 digits, so lookups also try `bare10` (A13).
 *
 * Pure functions, safe in the browser and on the server.
 */

/** Digits only. */
function digitsOf(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/**
 * The national number: the digits with a country code or trunk zero removed when what remains
 * is still at least 10 digits long. `919741541309` → `9741541309`; `09964288130` → `9964288130`;
 * `9189512050058` → `89512050058` (wrong length, kept). Never strips into fewer than 10 digits.
 */
function nationalDigits(raw: string | null | undefined): string {
  let d = digitsOf(raw);
  if (d.length >= 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/** `+91-XXXXXXXXXX`, or null when there are no digits at all. */
export function toPlus91(raw: string | null | undefined): string | null {
  const d = nationalDigits(raw);
  return d ? `+91-${d}` : null;
}

/** The bare 10-digit form of a number, or null when it is not exactly 10 national digits. */
export function bare10(raw: string | null | undefined): string | null {
  const d = nationalDigits(raw);
  return d.length === 10 ? d : null;
}

/** True when the number has exactly 10 national digits. */
export function isValidMobile(raw: string | null | undefined): boolean {
  return bare10(raw) !== null;
}

/** Same person's number, compared in the `+91-` form (A12). Two empties are not "the same". */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = toPlus91(a);
  return pa !== null && pa === toPlus91(b);
}

/** Digits for a `wa.me/` or `api.whatsapp.com/send?phone=` link: `91` + the national number. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const d = nationalDigits(raw);
  return d ? `91${d}` : null;
}
