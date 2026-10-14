import { loadHomeBinRules, pickHomeBin, type Db } from "@/lib/bins/rule-match";
import { createLogger } from "@/lib/logger";

const log = createLogger("stock:add-stock-bin");

/**
 * THE bin Add stock puts a product into — decided here, never chosen on the screen.
 *
 * Owner, 14 Oct 2026 (plan 1410-stock-quick-add, §7): "it must show the product related bin
 * not all bin … and that bin must be only readable", and "no bin means there can't be add
 * stock — the add stock action must not happen".
 *
 * The product's bin, in order:
 *   1. its home bin's warehouse has a home-bin rule for it → the RULE's bin (the inbound lock,
 *      plan 2109 R34 — the rule wins over the home bin in its own warehouse);
 *   2. otherwise its home bin (`Product.binId`), when that bin and its warehouse are active;
 *   3. no home bin, and rules place it in exactly ONE warehouse → that rule's bin;
 *   4. anything else → no bin, and Add stock is refused with the reason.
 *
 * Both the GET (what the sheet shows, read-only) and the POST (which refuses any other bin) ask
 * this one function, so the screen and the route cannot disagree.
 */

export interface AddStockBin {
  id: string;
  code: string;
  name: string;
  nonAssemblable: boolean;
  warehouseId: string;
  warehouseName: string;
}

export type AddStockBinResolution =
  | { ok: true; bin: AddStockBin; source: "home" | "rule"; rule: string | null }
  | { ok: false; reason: string };

export interface AddStockBinProduct {
  id: string;
  name: string;
  binId: string | null;
  brandId: string | null;
  categoryId: string | null;
}

/** Where a person gives a product its bin — said in every refusal, so the next step is obvious. */
const HOW_TO_SET = "set its bin on the product's page (Edit → Bin) or with a home-bin rule";

export async function resolveAddStockBin(db: Db, product: AddStockBinProduct): Promise<AddStockBinResolution> {
  const item = { productId: product.id, brandId: product.brandId, categoryId: product.categoryId };

  if (product.binId) {
    const home = await db.bin.findUnique({
      where: { id: product.binId },
      select: {
        id: true, code: true, name: true, isActive: true, nonAssemblable: true,
        warehouse: { select: { id: true, name: true, isActive: true } },
      },
    });
    if (!home) {
      log.warn("home bin row missing", { productId: product.id, binId: product.binId });
      return { ok: false, reason: `${product.name}'s bin no longer exists — ${HOW_TO_SET}, then add stock` };
    }
    if (!home.warehouse.isActive) {
      return { ok: false, reason: `${product.name}'s bin ${home.code} is in ${home.warehouse.name}, which is not active — ${HOW_TO_SET}` };
    }

    // A rule only speaks for its own warehouse, and loadHomeBinRules returns active bins only.
    const match = pickHomeBin(await loadHomeBinRules(db, home.warehouse.id), item);
    if (match && match.bin.id !== home.id) {
      return {
        ok: true,
        source: "rule",
        rule: match.label,
        bin: {
          id: match.bin.id, code: match.bin.code, name: match.bin.name, nonAssemblable: match.bin.nonAssemblable,
          warehouseId: home.warehouse.id, warehouseName: home.warehouse.name,
        },
      };
    }
    if (!home.isActive) {
      return { ok: false, reason: `${product.name}'s bin ${home.code} is not active — reactivate it or ${HOW_TO_SET}` };
    }
    return {
      ok: true,
      source: "home",
      rule: match?.label ?? null,
      bin: {
        id: home.id, code: home.code, name: home.name, nonAssemblable: home.nonAssemblable,
        warehouseId: home.warehouse.id, warehouseName: home.warehouse.name,
      },
    };
  }

  // No home bin: does a rule place it? Every active warehouse's rules, matched per warehouse.
  const rules = await loadHomeBinRules(db);
  const byWarehouse = new Map<string, typeof rules>();
  for (const r of rules) {
    const list = byWarehouse.get(r.bin.warehouseId) ?? [];
    list.push(r);
    byWarehouse.set(r.bin.warehouseId, list);
  }
  const matches = [...byWarehouse.values()]
    .map((list) => pickHomeBin(list, item))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (matches.length === 0) {
    return { ok: false, reason: `${product.name} has no bin — Add stock is not possible until it has one. ${capitalise(HOW_TO_SET)}.` };
  }
  if (matches.length > 1) {
    log.info("rules place the product in several warehouses — no single bin", { productId: product.id, warehouses: matches.length });
    return { ok: false, reason: `Rules place ${product.name} in ${matches.length} warehouses — set its home bin on the product's page (Edit → Bin) so Add stock knows which` };
  }

  const match = matches[0];
  const warehouse = await db.warehouse.findUnique({ where: { id: match.bin.warehouseId }, select: { name: true } });
  return {
    ok: true,
    source: "rule",
    rule: match.label,
    bin: {
      id: match.bin.id, code: match.bin.code, name: match.bin.name, nonAssemblable: match.bin.nonAssemblable,
      warehouseId: match.bin.warehouseId, warehouseName: warehouse?.name ?? "",
    },
  };
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
