export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-utils";
import { requireFeature, AuthError } from "@/lib/auth-helpers";

// Patterns to classify products by name
const BICYCLE_PATTERNS = [
  /\b\d{2,2}(\.\d)?["']?\s*(t\b|ss\b|ms\b|fs\b|sp\b)/i, // "26T", "27.5 SS", "29T MS"
  /\b(bicycle|cycle|e-bicycle|e-bike|ebike)\b/i,
  /\b(lectro|firefox|schnell|hero|emotorad|keysto|leader|atlas|hercules|bsa|avon|gang|montra|trinx|polygon|giant|trek|scott)\b.*\b\d{2}/i,
  /\bFFBC\b/i, // FFBC prefix = bicycle
  /\bEMBC\b/i, // EMBC prefix = e-bicycle
  /\b(geared|non.geared|single.speed|7.speed|7sp|21.speed|21sp|shimano.*speed)\b/i,
  /\b(MTB|mountain.bike|road.bike|hybrid|fat.bike|fat.tyre|cruiser)\b/i,
];

const ACCESSORY_PATTERNS = [
  /\b(helmet|lock|pump|light|bell|bottle|cage|mirror|stand|carrier|basket|mudguard|fender)\b/i,
  /\b(glove|jersey|shorts|raincoat|poncho|bag|pannier|saddlebag)\b/i,
  /\b(speedometer|computer|gps|phone.mount|mobile.holder)\b/i,
  /\b(kickstand|side.stand|center.stand)\b/i,
  /\b(tool.kit|repair.kit|puncture.kit|multi.tool)\b/i,
  /\b(training.wheel|stabilizer)\b/i,
  /\b(seat.cover|cushion|gel.seat)\b/i,
  /\b(horn|hooter)\b/i,
];

// Everything else = Spares (tubes, tyres, brakes, chains, pedals, rims, spokes, etc.)

function classifyByName(name: string): "Bicycles" | "Spares" | "Accessories" {
  for (const pattern of BICYCLE_PATTERNS) {
    if (pattern.test(name)) return "Bicycles";
  }
  for (const pattern of ACCESSORY_PATTERNS) {
    if (pattern.test(name)) return "Accessories";
  }
  return "Spares";
}

// GET — Preview auto-classification (dry run)
export async function GET() {
  try {
    await requireFeature("stock", "view");

    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, sku: true, type: true, category: { select: { name: true } } },
    });

    const preview: Record<string, { count: number; samples: string[] }> = {
      Bicycles: { count: 0, samples: [] },
      Spares: { count: 0, samples: [] },
      Accessories: { count: 0, samples: [] },
    };

    for (const p of products) {
      const cat = classifyByName(p.name);
      preview[cat].count++;
      if (preview[cat].samples.length < 5) {
        preview[cat].samples.push(p.name);
      }
    }

    // Also count current state
    const currentGeneral = products.filter(p => p.category.name === "General").length;

    return successResponse({
      totalProducts: products.length,
      currentlyInGeneral: currentGeneral,
      classification: preview,
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}

// POST — Apply auto-classification
export async function POST(req: NextRequest) {
  try {
    await requireFeature("stock", "create");
    const body = await req.json();
    const { dryRun } = body as { dryRun?: boolean };

    // Ensure the 3 categories exist
    const categoryNames = ["Bicycles", "Spares", "Accessories"];
    const categories: Record<string, string> = {};

    for (const name of categoryNames) {
      let cat = await prisma.category.findFirst({ where: { name } });
      if (!cat) {
        cat = await prisma.category.create({ data: { name, description: `${name} category` } });
      }
      categories[name] = cat.id;
    }

    // Get all active products
    const products = await prisma.product.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, categoryId: true },
    });

    const changes: { id: string; name: string; from: string; to: string }[] = [];
    const stats = { Bicycles: 0, Spares: 0, Accessories: 0, unchanged: 0 };

    for (const p of products) {
      const targetCat = classifyByName(p.name);
      const targetCatId = categories[targetCat];

      if (p.categoryId !== targetCatId) {
        changes.push({ id: p.id, name: p.name, from: p.categoryId, to: targetCat });
        stats[targetCat]++;
      } else {
        stats.unchanged++;
      }
    }

    if (dryRun) {
      return successResponse({
        wouldUpdate: changes.length,
        unchanged: stats.unchanged,
        breakdown: { Bicycles: stats.Bicycles, Spares: stats.Spares, Accessories: stats.Accessories },
        sampleChanges: changes.slice(0, 20).map(c => ({ name: c.name, to: c.to })),
      });
    }

    // Apply in batches of 200
    let updated = 0;
    for (const catName of categoryNames) {
      const ids = changes.filter(c => c.to === catName).map(c => c.id);
      if (ids.length === 0) continue;

      // Also update ProductType to match
      const productType = catName === "Bicycles" ? "BICYCLE" : catName === "Accessories" ? "ACCESSORY" : "SPARE_PART";

      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        await prisma.product.updateMany({
          where: { id: { in: batch } },
          data: { categoryId: categories[catName], type: productType as "BICYCLE" | "SPARE_PART" | "ACCESSORY" },
        });
        updated += batch.length;
      }
    }

    return successResponse({
      updated,
      breakdown: { Bicycles: stats.Bicycles, Spares: stats.Spares, Accessories: stats.Accessories },
    });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed", 500);
  }
}
