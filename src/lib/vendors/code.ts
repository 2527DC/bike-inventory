/**
 * A vendor code in the shape the Zoho import mints one: 6 alphanumerics + 4 digits of now.
 *
 * Shared by the bill import (`resolve-zoho-vendor.ts`) and the inbound-issue auto-create
 * (`api/inbound/[id]/issues`), which each carried their own copy of this before.
 */
export function vendorCodeFor(name: string, suffix: string = String(Date.now()).slice(-4)): string {
  return (
    name
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 6)
      .toUpperCase() + suffix
  );
}

/** A random 4-digit suffix, for a retry after `code` collided. */
export function randomCodeSuffix(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}
