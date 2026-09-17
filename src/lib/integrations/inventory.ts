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
   * The Zoho id of this category's parent; `"-1"` (the synthetic ROOT) means top level.
   * Honoured since plan 1709 (P12, 17 Sep 2026): the category import sets `Category.parentId`
   * from it. That reverses the flat-import decision D4 of 8 Sep 2026. Nothing is pushed back.
   */
  parent_category_id?: string;
}

/**
 * A row of Zoho Inventory's item list — only what the category re-link reads (plan 1709, R47).
 * `category_id` is on the LIST payload (verified live 7 Sep 2026: 154 of a 200-item sample
 * carried one); an item with no category has it absent or as an empty string.
 */
export interface ZohoItem {
  item_id: string;
  name?: string;
  sku?: string;
  category_id?: string;
  category_name?: string;
  status?: string;
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

  // ─── Items (plan 1709, R47) ────────────────────────────────────────────────
  // Read only, for the category import's product re-link: item_id -> category_id.
  // `filter_by=Status.All` so an item made inactive in Zoho still reports its category;
  // a product here can outlive the item's active status there.

  /** Pages fetched concurrently by listAllItems. Well under Zoho's concurrent-call limit. */
  private static readonly ITEM_PAGE_WINDOW = 3;

  async listItems(page = 1) {
    return this.apiCall<{ items: ZohoItem[] } & PageContext>(
      "GET",
      `/items?page=${page}&per_page=200&filter_by=Status.All`,
      undefined,
      "items.list.inventory"
    );
  }

  /**
   * Every item, following `page_context.has_more_page`.
   *
   * Pages are requested in windows of three rather than one at a time: the catalog is ~5,700
   * items (~29 pages) and the import that calls this runs inside one HTTP request, so a
   * strictly sequential walk spends most of that request waiting. A window stops at the first
   * page that says there is no more; any later page in the same window is empty and dropped.
   */
  async listAllItems(): Promise<ZohoItem[]> {
    const all: ZohoItem[] = [];
    const started = Date.now();
    let page = 1;
    let pages = 0;
    for (;;) {
      const window = Array.from({ length: InventoryClient.ITEM_PAGE_WINDOW }, (_, i) => page + i);
      const results = await Promise.all(window.map((p) => this.listItems(p)));
      let more = true;
      for (let i = 0; i < results.length; i++) {
        const rows = results[i].items || [];
        pages++;
        log.debug("items page fetched", { page: window[i], rows: rows.length });
        all.push(...rows);
        if (!results[i].page_context?.has_more_page) {
          more = false;
          break;
        }
      }
      if (!more) break;
      page += InventoryClient.ITEM_PAGE_WINDOW;
    }
    log.info("items pull finished", { items: all.length, pages, ms: Date.now() - started });
    return all;
  }
}
