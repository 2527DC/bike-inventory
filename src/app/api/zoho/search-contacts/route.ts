export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getBooks } from "@/lib/integrations";
import { createLogger } from "@/lib/logger";

const log = createLogger("zoho:search-contacts");

// The Zoho contact search on /vendor-issues/new, its only caller.
export async function GET(req: NextRequest) {
  try {
    // vendor_issues.fetch — the tick the screen's search checks (plan
    // 1410-per-module-fetch-permissions). Was zoho.fetch.
    await requireFeature("vendor_issues", "fetch");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return errorResponse("Search query must be at least 2 characters", 400);
    }

    const zoho = await getBooks();
    if (!zoho) {
      log.warn("contact search refused — Zoho Books not connected");
      return errorResponse("Zoho not connected", 400);
    }

    const result = await zoho.searchContacts(query, "customer");
    const contacts = (result.contacts || []).map(c => ({
      id: c.contact_id,
      name: c.contact_name,
      phone: c.phone || c.mobile || null,
      email: c.email || null,
      city: c.billing_address?.city || null,
      address: c.billing_address?.address || null,
    }));

    log.debug("contact search", { found: contacts.length });
    return successResponse(contacts);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("contact search failed", { message: error instanceof Error ? error.message : String(error) });
    return errorResponse(error instanceof Error ? error.message : "Search failed", 500);
  }
}
