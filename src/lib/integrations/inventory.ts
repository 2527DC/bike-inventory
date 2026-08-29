// Zoho Inventory.
import { IntegrationClient, type ProviderKey } from "./base";

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
      itemData
    );
  }
}
