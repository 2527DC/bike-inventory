// Which app vendor a Zoho vendor is — plan 1410-link-vendors-to-zoho, A1.
//
// The app's 83 vendors predate the Zoho link (none carried a Zoho id on 14 Oct 2026), so a bill
// whose vendor is not linked used to fail on the name. GSTIN is the key that finds the existing
// vendor; a name alone never links anything without a person ticking it (the intent of plan
// 2409-zoho-vendor-id, R4, kept). One matcher serves the /vendors preview, the Link and Import
// routes and bill approval, so they cannot disagree. Pure: no database, no Zoho — callers fetch
// and log, and it is safe to import from the browser.
//
// It is given EVERY app vendor, linked or not. A GSTIN or name already held by a vendor linked to
// another Zoho vendor is a conflict — never "new", never created again at bill approval — so Zoho
// duplicates cannot split one business across two vendors here (review of 14 Oct 2026).

/** The Zoho side of a match: a vendor from Zoho's contact list or a bill's contact read. */
export interface ZohoVendorRef {
  zohoId: string;
  name: string;
  gstin: string | null;
}

/** The app side: any vendor here. `zohoVendorId` set = already linked to a Zoho vendor. */
export interface AppVendorRef {
  id: string;
  code: string;
  name: string;
  gstin: string | null;
  isActive: boolean;
  zohoVendorId: string | null;
}

/**
 *   gstin        the GSTIN is on exactly one vendor here, not yet linked — linked automatically
 *   gstin+name   several vendors here share the GSTIN, exactly one also has the name, not yet
 *                linked — linked automatically
 *   ambiguous    several unlinked vendors could be it (a shared GSTIN the name does not decide, or
 *                two Zoho vendors claim the same vendor — Q2, Q4) — linked only when a person picks
 *   name         no GSTIN match, the same name, at most one side has a GSTIN — linked only when ticked
 *   conflict     never linked: the GSTIN or name is held by a vendor linked to another Zoho vendor
 *                ("linked-elsewhere"), the same name carries a different GSTIN ("gstin-differs"), or
 *                every vendor it could be is another Zoho vendor's GSTIN match ("matched-elsewhere")
 *   none         nothing here — a new vendor, importable
 */
export type MatchKind = "gstin" | "gstin+name" | "ambiguous" | "name" | "conflict" | "none";

export interface VendorMatch {
  kind: MatchKind;
  /** The app vendor it pairs with, for gstin / gstin+name / name. */
  vendorId?: string;
  /** The vendors here it was weighed against. For ambiguous: only unlinked ones — the choices. */
  candidates: AppVendorRef[];
  /** Why a conflict is one. */
  reason?: "linked-elsewhere" | "gstin-differs" | "matched-elsewhere";
}

/** "29aadci 7400c1zx " → "29AADCI7400C1ZX"; blank → null (Q5). */
export function normaliseGstin(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, "").toUpperCase();
  return t || null;
}

/** Case-insensitive, trimmed, inner runs of spaces collapsed — "Naren  International" = "NAREN INTERNATIONAL". */
export function normaliseName(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const isFree = (v: AppVendorRef) => !v.zohoVendorId;

/** One Zoho vendor (not itself linked here) against every vendor here. */
export function matchOne(z: ZohoVendorRef, vendors: AppVendorRef[]): VendorMatch {
  const gstin = normaliseGstin(z.gstin);
  const name = normaliseName(z.name);

  if (gstin) {
    const group = vendors.filter((v) => normaliseGstin(v.gstin) === gstin);
    if (group.length > 0) {
      const open = group.filter(isFree);
      if (group.length === 1) {
        return isFree(group[0])
          ? { kind: "gstin", vendorId: group[0].id, candidates: group }
          : { kind: "conflict", reason: "linked-elsewhere", candidates: group };
      }
      // Several vendors here share the GSTIN: the name decides, or a person does.
      const named = group.filter((v) => normaliseName(v.name) === name);
      if (named.length === 1) {
        return isFree(named[0])
          ? { kind: "gstin+name", vendorId: named[0].id, candidates: group }
          : { kind: "conflict", reason: "linked-elsewhere", candidates: named };
      }
      return open.length > 0
        ? { kind: "ambiguous", candidates: open }
        : { kind: "conflict", reason: "linked-elsewhere", candidates: group };
    }
  }

  // No vendor here has this GSTIN. The name may still find one — for a person to confirm.
  // `Vendor.name` is unique only exactly, so folding case and spaces can find more than one.
  const byName = vendors.filter((v) => normaliseName(v.name) === name);
  if (byName.length === 0) return { kind: "none", candidates: [] };
  const open = byName.filter(isFree);
  if (open.length === 0) return { kind: "conflict", reason: "linked-elsewhere", candidates: byName };
  if (open.length > 1) return { kind: "ambiguous", candidates: open };
  const theirs = normaliseGstin(open[0].gstin);
  if (gstin && theirs && gstin !== theirs) return { kind: "conflict", reason: "gstin-differs", candidates: open };
  return { kind: "name", vendorId: open[0].id, candidates: open };
}

/**
 * Every Zoho vendor at once (the ones not linked here yet). Two rules across rows:
 *   - An app vendor that two Zoho vendors pair with is linked to neither automatically —
 *     `zohoVendorId` is unique, and choosing between duplicates in Zoho is a person's call (Q4) —
 *     so both rows become ambiguous, offering that vendor.
 *   - An ambiguous row does not offer a vendor that another row matches automatically by GSTIN:
 *     picking it would take it from the Zoho vendor it really is (found on the test data, where
 *     Zoho's SOLID INDUSTRIES shares a GSTIN with three vendors that each have their own same-name
 *     Zoho vendor). With nothing left to offer, the row is a conflict, "matched-elsewhere".
 */
export function matchAll(zohoVendors: ZohoVendorRef[], vendors: AppVendorRef[]): Map<string, VendorMatch> {
  const out = new Map(zohoVendors.map((z) => [z.zohoId, matchOne(z, vendors)] as const));

  const claims = new Map<string, string[]>();
  for (const [zohoId, m] of out) {
    if (m.vendorId) claims.set(m.vendorId, [...(claims.get(m.vendorId) ?? []), zohoId]);
  }
  for (const zohoIds of claims.values()) {
    if (zohoIds.length < 2) continue;
    for (const zohoId of zohoIds) {
      const m = out.get(zohoId)!;
      const choice = m.candidates.filter((c) => c.id === m.vendorId);
      out.set(zohoId, { kind: "ambiguous", candidates: choice });
    }
  }

  const takenAutomatically = new Set<string>();
  for (const m of out.values()) if (isAutomatic(m.kind) && m.vendorId) takenAutomatically.add(m.vendorId);
  for (const [zohoId, m] of out) {
    if (m.kind !== "ambiguous") continue;
    const free = m.candidates.filter((c) => !takenAutomatically.has(c.id));
    if (free.length === m.candidates.length) continue;
    out.set(
      zohoId,
      free.length > 0
        ? { kind: "ambiguous", candidates: free }
        : { kind: "conflict", reason: "matched-elsewhere", candidates: m.candidates }
    );
  }
  return out;
}

/** Whether linking this app vendor to this match is allowed — the server's re-check of a ticked pair. */
export function pairAllowed(m: VendorMatch, vendorId: string): boolean {
  switch (m.kind) {
    case "gstin":
    case "gstin+name":
    case "name":
      return m.vendorId === vendorId;
    case "ambiguous":
      return m.candidates.some((c) => c.id === vendorId && isFree(c));
    default:
      return false;
  }
}

/** Matches linked without a person choosing (R3): the GSTIN decides. */
export function isAutomatic(kind: MatchKind): boolean {
  return kind === "gstin" || kind === "gstin+name";
}
