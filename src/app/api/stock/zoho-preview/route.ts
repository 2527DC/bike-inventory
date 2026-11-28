export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";
import { getInventory } from "@/lib/integrations";
import type { ZohoItem } from "@/lib/integrations/inventory";
import { getTodayIST, istDayBounds } from "@/lib/services/timezone";
import { DEFAULT_BRAND, PLACEHOLDER_CATEGORY } from "@/lib/import-placeholders";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:zoho-preview");

const CACHE_KEY = "zoho_inventory_items_cache_v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface StockPreviewItem {
  zohoId: string;
  name: string;
  sku?: string;
  brandName: string;
  brandStatus: "existing" | "new";
  categoryName: string;
  categoryId?: string;
  categoryStatus: "existing" | "new";
  status: "new" | "update";
  costPrice: number;
  sellingPrice: number;
  gstRate: number;
  hsnCode?: string;
  stockOnHand: number;
  modifiedAt?: string;
}

interface ZohoItemsCache {
  cachedAt: string;
  lastModifiedCursor: string;
  items: ZohoItem[];
}

type SyncMode = "cache" | "delta" | "full";

/** Date-only and unqualified timestamps from the inventory organisation are IST. */
function itemTimestamp(value?: string): number {
  if (!value) return -Infinity;
  const local = value.length === 10 ? `${value}T00:00:00` : value;
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(local) ? local : `${local}+05:30`);
  return Number.isFinite(ms) ? ms : -Infinity;
}

/** Format an epoch instant as Zoho's IST cursor (`YYYY-MM-DDTHH:mm:ss+0530`). */
function formatZohoCursorIST(epochMs = Date.now()): string {
  return `${new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 19)}+0530`;
}

/** Subtract `(days - 1)` calendar days from an IST `YYYY-MM-DD` date without FY clamping. */
function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d) - (Math.max(1, days) - 1) * DAY_MS;
  return new Date(startMs).toISOString().slice(0, 10);
}

async function readItemsCache(): Promise<ZohoItemsCache | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<ZohoItemsCache>;
    if (!Array.isArray(parsed.items)) return null;
    return {
      cachedAt: typeof parsed.cachedAt === "string" ? parsed.cachedAt : row.updatedAt.toISOString(),
      lastModifiedCursor: typeof parsed.lastModifiedCursor === "string" ? parsed.lastModifiedCursor : "",
      items: parsed.items,
    };
  } catch (err) {
    log.warn("corrupt zoho items cache ignored", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function latestCursorFor(items: ZohoItem[]): string {
  let maxMs = -Infinity;
  let bestCursor = "";
  for (const it of items) {
    const raw = it.last_modified_time || it.created_time;
    const ms = itemTimestamp(raw);
    if (ms > maxMs && raw) {
      maxMs = ms;
      bestCursor = raw;
    }
  }
  return bestCursor || formatZohoCursorIST();
}

async function writeItemsCache(items: ZohoItem[]): Promise<ZohoItemsCache> {
  const payload: ZohoItemsCache = {
    cachedAt: new Date().toISOString(),
    lastModifiedCursor: latestCursorFor(items),
    items,
  };
  await prisma.appSetting.upsert({
    where: { key: CACHE_KEY },
    update: { value: JSON.stringify(payload) },
    create: { key: CACHE_KEY, value: JSON.stringify(payload) },
  });
  return payload;
}

interface PreviewParams {
  days?: string | number | null;
  all?: string | boolean | null;
  fromDate?: string | null;
  toDate?: string | null;
  sync?: string | null;
}

async function buildPreview(params: PreviewParams) {
  const today = getTodayIST();
  const rawAll = params.all === true || params.all === "1" || params.all === "true" || params.days === "all";
  const fromDate = typeof params.fromDate === "string" ? params.fromDate : null;
  const toDate = typeof params.toDate === "string" ? params.toDate : null;

  let window: { from: string; to: string } | null = null;
  if (!rawAll) {
    if (fromDate !== null || toDate !== null) {
      const date = z.iso.date();
      if (!fromDate || !toDate || !date.safeParse(fromDate).success || !date.safeParse(toDate).success) {
        return errorResponse("Choose a valid start and end date.", 400);
      }
      if (fromDate > toDate) return errorResponse("End date must be on or after start date.", 400);
      if (toDate > today) return errorResponse("Choose today or an earlier end date.", 400);
      window = { from: fromDate, to: toDate };
    } else {
      const parsedDays = typeof params.days === "number" ? params.days : parseInt(String(params.days ?? ""), 10);
      const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : 7;
      window = { from: subtractDays(today, days), to: today };
    }
  }

  const syncParam = params.sync === "delta" || params.sync === "full" ? params.sync : "cache";
  let source: SyncMode = syncParam;
  let cache = await readItemsCache();

  if (syncParam === "full" || !cache) {
    const zoho = await getInventory();
    if (!zoho) {
      log.warn("stock preview refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try again.",
        503
      );
    }
    log.info("rebuilding full active items cache from Zoho Inventory");
    const fresh = await zoho.listAllActiveItems();
    cache = await writeItemsCache(fresh);
    source = "full";
  } else if (syncParam === "delta") {
    const zoho = await getInventory();
    if (!zoho) {
      log.warn("stock delta sync refused - Zoho Inventory is not connected");
      return errorResponse(
        "Zoho Inventory is not connected. Connect it in Settings > Integrations, then try again.",
        503
      );
    }
    if (cache.lastModifiedCursor) {
      log.info("delta syncing active items from Zoho Inventory", { cursor: cache.lastModifiedCursor });
      const deltaItems = await zoho.listAllActiveItems(cache.lastModifiedCursor);
      const merged = new Map<string, ZohoItem>(cache.items.map((it) => [it.item_id, it]));
      for (const it of deltaItems) {
        if (it.item_id) merged.set(it.item_id, it);
      }
      cache = await writeItemsCache([...merged.values()]);
      source = "delta";
    } else {
      log.info("no cursor in cache - running full rebuild");
      const fresh = await zoho.listAllActiveItems();
      cache = await writeItemsCache(fresh);
      source = "full";
    }
  }

  const start = window ? istDayBounds(window.from).start.getTime() : -Infinity;
  const end = window ? istDayBounds(window.to).end.getTime() : Infinity;

  const [localProducts, localBrands, localCategories] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, sku: true, zohoItemId: true, name: true },
    }),
    prisma.brand.findMany({
      select: { id: true, name: true, zohoBrandId: true },
    }),
    prisma.category.findMany({
      select: { id: true, name: true, zohoCategoryId: true },
    }),
  ]);

  const productByZohoId = new Map(
    localProducts.filter((p) => p.zohoItemId).map((p) => [p.zohoItemId!, p])
  );
  const productBySku = new Map(
    localProducts.filter((p) => p.sku).map((p) => [p.sku.trim().toLowerCase(), p])
  );
  const brandByName = new Map(localBrands.map((b) => [b.name.trim().toLowerCase(), b]));
  const categoryByName = new Map(localCategories.map((c) => [c.name.trim().toLowerCase(), c]));
  const categoryByZohoId = new Map(
    localCategories.filter((c) => c.zohoCategoryId).map((c) => [c.zohoCategoryId!, c])
  );

  let newCount = 0;
  let updateCount = 0;
  const brandsToCreate = new Set<string>();
  const categoriesToCreate = new Set<string>();
  const matched: Array<{ ts: number; item: StockPreviewItem }> = [];

  for (const item of cache.items) {
    if (item.status?.toLowerCase() !== "active") continue;

    const updated = Math.max(itemTimestamp(item.last_modified_time), itemTimestamp(item.created_time));
    if (window && (updated < start || updated > end)) continue;

    const zohoId = item.item_id;
    if (!zohoId) continue;

    const sku = item.sku?.trim() || "";
    const name = (item.name ?? "").trim();

    const existingProduct =
      productByZohoId.get(zohoId) ||
      (sku ? productBySku.get(sku.toLowerCase()) : undefined);
    const status: "new" | "update" = existingProduct ? "update" : "new";

    if (status === "new") newCount++;
    else updateCount++;

    const brandName = item.brand?.trim() || DEFAULT_BRAND;
    const brandKey = brandName.toLowerCase();
    const brandStatus: "existing" | "new" = brandByName.has(brandKey) ? "existing" : "new";
    if (brandStatus === "new") brandsToCreate.add(brandKey);

    const categoryName = item.category_name?.trim() || PLACEHOLDER_CATEGORY;
    const categoryId = item.category_id?.trim() || undefined;
    const catKey = categoryName.toLowerCase();
    const isExistingCategory =
      Boolean(categoryId && categoryByZohoId.has(categoryId)) || categoryByName.has(catKey);
    const categoryStatus: "existing" | "new" = isExistingCategory ? "existing" : "new";
    if (categoryStatus === "new") categoriesToCreate.add(catKey);

    const modifiedRaw = item.last_modified_time || item.created_time;
    matched.push({
      ts: updated,
      item: {
        zohoId,
        name,
        sku: sku || undefined,
        brandName,
        brandStatus,
        categoryName,
        categoryId,
        categoryStatus,
        status,
        costPrice: item.purchase_rate ?? 0,
        sellingPrice: item.rate ?? 0,
        gstRate: item.tax_percentage ?? 18,
        hsnCode: item.hsn_or_sac?.trim() || undefined,
        stockOnHand: item.stock_on_hand ?? 0,
        modifiedAt: modifiedRaw ? modifiedRaw.slice(0, 10) : undefined,
      },
    });
  }

  matched.sort((a, b) => b.ts - a.ts);
  const items = matched.map((m) => m.item);

  log.info("stock preview built", {
    total: items.length,
    new: newCount,
    update: updateCount,
    brandsToCreate: brandsToCreate.size,
    categoriesToCreate: categoriesToCreate.size,
    source,
    cachedTotal: cache.items.length,
    window,
    allActive: rawAll,
  });

  return successResponse({
    window,
    allActive: rawAll,
    cache: {
      totalItems: cache.items.length,
      cachedAt: cache.cachedAt,
      lastModifiedCursor: cache.lastModifiedCursor,
      source,
    },
    counts: {
      total: items.length,
      new: newCount,
      update: updateCount,
      brandsToCreate: brandsToCreate.size,
      categoriesToCreate: categoriesToCreate.size,
    },
    items,
  });
}

/**
 * GET /api/stock/zoho-preview
 *
 * Previews active items from the local Zoho item cache (`AppSetting`) with 0 Zoho API calls on filter,
 * or syncs via `?sync=delta` / `?sync=full`. Supports `?days=3|7|30|180|365`, `?all=1`, or `?fromDate=&toDate=`.
 */
export async function GET(req: NextRequest) {
  try {
    await requireFeature("stock", "fetch");
    const { searchParams } = new URL(req.url);
    return await buildPreview({
      days: searchParams.get("days"),
      all: searchParams.get("all"),
      fromDate: searchParams.get("fromDate"),
      toDate: searchParams.get("toDate"),
      sync: searchParams.get("sync"),
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock preview failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to preview Zoho stock items",
      500
    );
  }
}

/** POST fallback supporting JSON body for the same preview/sync parameters. */
export async function POST(req: NextRequest) {
  try {
    await requireFeature("stock", "fetch");
    const body = (await req.json().catch(() => ({}))) as PreviewParams;
    return await buildPreview(body);
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    log.error("stock preview failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "Failed to preview Zoho stock items",
      500
    );
  }
}
