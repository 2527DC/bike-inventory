import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("purchase-orders:company");

export interface CompanyIdentity {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  /** From NotificationConfig — the address a vendor's reply goes to. */
  email: string | null;
  /** The display name on outgoing mail, when one is configured. */
  fromName: string | null;
}

/**
 * Who this purchase order is FROM.
 *
 * The active `Store` with the lowest `sortOrder`, plus the sender identity from
 * `NotificationConfig`. There is no separate "company" table — the shop's own details live on
 * its first store, which is also what `seed-stores.ts` orders as `BCH_STORE` (sortOrder 10)
 * ahead of `BCC_STORE` (20).
 *
 * ⚠ `Store` has NO email column. The plan's `replyTo = company.email ?? fromEmail` reads as if
 * a store could carry its own address; it cannot, so `email` here is the notification
 * `fromEmail` and nothing else. Worth knowing before someone writes a fallback that can never
 * fire.
 *
 * ─── EXPECT THESE TO BE EMPTY ────────────────────────────────────────────────────────────
 *
 * `seed-stores.ts` writes only `code`, `name` and `sortOrder`. Address, phone, GSTIN and state
 * code are all null until somebody fills them in on `/stores` — P13 built that form; nothing
 * has used it yet. So the header degrades to a name and a blank line, and that is deliberate:
 * a purchase order with a missing GSTIN is a document somebody should fix, not one this code
 * should invent a value for.
 *
 * The warning is logged ONCE per render rather than per field, because until the form is used
 * every field is missing and four warnings per PDF is noise nobody will read.
 */
export async function loadCompanyIdentity(): Promise<CompanyIdentity> {
  const [store, config] = await Promise.all([
    prisma.store.findFirst({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true, address: true, phone: true, gstin: true, stateCode: true },
    }),
    prisma.notificationConfig.findUnique({
      where: { id: "singleton" },
      select: { fromName: true, fromEmail: true },
    }),
  ]);

  const identity: CompanyIdentity = {
    // A purchase order with no company name at all is not worth rendering, but the fallback is
    // a string rather than a throw: the document is still useful to whoever is looking at it.
    name: store?.name ?? "Bharath Cycle Hub",
    address: store?.address ?? null,
    phone: store?.phone ?? null,
    gstin: store?.gstin ?? null,
    stateCode: store?.stateCode ?? null,
    email: config?.fromEmail ?? null,
    fromName: config?.fromName ?? null,
  };

  const missing = (["address", "phone", "gstin"] as const).filter((k) => !identity[k]);
  if (!store) {
    log.warn("no active store — the purchase order header will carry a placeholder name");
  } else if (missing.length > 0) {
    log.warn("company details missing from the header", { missing, store: identity.name });
  }

  return identity;
}
