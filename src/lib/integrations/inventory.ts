// Zoho Inventory.
import { createLogger } from "@/lib/logger";
import { IntegrationClient, type ProviderKey } from "./base";

const log = createLogger("zoho:taxonomy");

/** A row of Zoho's brand master. Only the two fields the taxonomy import uses. */
export interface ZohoBrand {
  brand_id: string;
  /** Zoho returns the label under `name`, NOT `brand_name` — verified live 8 Sep 2026
   *  against /brands, whose rows carry exactly two keys: brand_id and name. */
  name: string;
}

/** A row of Zoho's category master. Zoho returns a tree; we take the nodes. */
export interface ZohoCategory {
  category_id: string;
  /** Zoho returns the label under `name`, NOT `category_name`. `category_name` is the key on an
   *  ITEM payload; the /categories endpoint uses `name`. Verified live 8 Sep 2026. */
  name: string;
  /**
   * Read from Zoho and then DISCARDED — the owner decided on 8 Sep 2026 to import
   * categories flat and arrange the tree by hand on /categories. Kept in the type so the
   * next person can see the field exists and that ignoring it was a decision, not an
   * oversight. Do not start honouring it without asking.
   */
  parent_category_id?: string;
}

/** base.ts declares this shape but does not export it; the two files must not drift. */
interface PageContext {
  page_context?: { has_more_page: boolean };
}

export class InventoryClient extends IntegrationClient {
  protected readonly provider: ProviderKey = "ZOHO_INVENTORY";
  protected readonly apiBase = "https://www.zohoapis.in/inventory/v1";

  /**
   * Fetch line items for many bills at once.
   *
   * Batched five at a time because that is Zoho's concurrent-request limit, with a short
   * pause between batches. A failed bill yields an empty line-item list rather than
   * aborting the batch — a partial result is more useful here than none.
   */
  async getBillDetails(billIds: string[]) {
    const results: Array<{
      bill_id: string;
      line_items: Array<{
        line_item_id?: string; item_id?: string; name: string; sku?: string;
        quantity: number; rate: number; item_total: number;
      }>;
    }> = [];

    for (let i = 0; i < billIds.length; i += 5) {
      const batch = billIds.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const data = await this.getBill(id);
            return { bill_id: id, line_items: data.bill?.line_items || [] };
          } catch {
            // Deliberately swallowed: one unreadable bill must not lose the other four.
            // The empty list is the signal, and the caller reports it.
            return { bill_id: id, line_items: [] };
          }
        })
      );
      results.push(...batchResults);
      if (i + 5 < billIds.length) await this.delay(200);
    }
    return results;
  }

  /** Zoho Inventory posts the item object directly; Books wraps it in JSONString. */
  async createItem(itemData: {
    name: string;
    sku: string;
    purchase_rate: number;
    rate?: number;
    item_type?: string;
    product_type?: string;
  }) {
    return this.apiCall<{ item: { item_id: string; name: string; sku: string } }>(
      "POST",
      "/items",
      itemData,
      "items.create.inventory"
    );
  }

  // ─── Taxonomy reads (brands + categories) ──────────────────────────────────
  // Same pagination shape as listBills/listAllBills in base.ts: per_page=200 and loop while
  // has_more_page. No sleep between pages — these are sequential, not concurrent, and
  // apiCall already backs off on a 429 and refreshes once on a 401.

  async listBrands(page = 1) {
    return this.apiCall<{ brands: ZohoBrand[] } & PageContext>(
      "GET",
      `/brands?page=${page}&per_page=200`,
      undefined,
      "brands.list.inventory"
    );
  }

  async listAllBrands(): Promise<ZohoBrand[]> {
    const all: ZohoBrand[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listBrands(page);
      const rows = data.brands || [];
      log.debug("brands page fetched", { page, rows: rows.length });
      all.push(...rows);
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    log.info("brands pull finished", { brands: all.length, pages: page });
    return all;
  }

  async listCategories(page = 1) {
    return this.apiCall<{ categories: ZohoCategory[] } & PageContext>(
      "GET",
      `/categories?page=${page}&per_page=200`,
      undefined,
      "categories.list.inventory"
    );
  }

  async listAllCategories(): Promise<ZohoCategory[]> {
    const all: ZohoCategory[] = [];
    let page = 1;
    for (;;) {
      const data = await this.listCategories(page);
      const rows = data.categories || [];
      log.debug("categories page fetched", { page, rows: rows.length });
      all.push(...rows);
      if (!data.page_context?.has_more_page) break;
      page++;
    }
    log.info("categories pull finished", { categories: all.length, pages: page });
    return all;
  }
}
