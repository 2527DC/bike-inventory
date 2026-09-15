# Implementation Plan: Dynamic Bin Tracking, Item-Level Bin Matching & Warehouse Directory View

**Status**: PENDING APPROVAL  
**Author**: Antigravity  
**Date**: 2026-09-14  
**Target Path**: `docs/implementation/pending/bin-tracking-dynamic-toggle-and-warehouse-directory-plan.md`

---

## 1. Executive Summary & Requirements

This plan addresses three core inventory requirements:

1. **Item-Level Brand & Category for Inbound & Home Bin Rules**:
   - Inbound line items must prioritize the **Item's / Product's own Brand and Category** (`Product.brandId` and `Product.categoryId`) for Home Bin Rule auto-matching.
   - Only if the product lacks a brand or category does it fall back to the shipment level (`InboundShipment.brandId` / `InboundShipment.categoryId`).
   - Show each line item's respected Brand and Category directly in the Inbound shipment details UI (`/inbound/[id]`).
   - Remove or relax the mandatory shipment-level category requirement so receiving is not blocked when individual items already have categories.

2. **Dynamic Bin Tracking Toggle (Database-Backed with UI Control)**:
   - Remove the static `export const BIN_TRACKING_ENABLED = false;` in `src/lib/inventory-config.ts`.
   - Store the state in the **Database** (`AppSetting` table) so an Admin can toggle Bin Tracking ON or OFF directly from the `/bins` screen with zero code deploys or server restarts.
   - Provide an environment variable fallback (`BIN_TRACKING_ENABLED`) when no database record exists.
   - When ON: Activates bin selection in Inbound receiving, `/stock` bulk bin assignment, transfer orders, and stock audits.
   - When OFF: Gracefully defaults to warehouse-level stock management.

3. **Warehouse Directory & Multi-Site Filter UI on `/bins`**:
   - Replace the single-warehouse horizontal pill switcher with a comprehensive **Store & Warehouse Directory**.
   - Provide Search & Filter controls:
     - Search input (filter by bin code, bin name, zone, or warehouse).
     - Store filter dropdown (filter by store or "All Stores").
     - Type filter (All, `FLOOR`, `GODOWN`).
   - Support an **"All Sites" view**: Warehouses are displayed with their name, store affiliation, and type badge (`FLOOR` / `GODOWN`), with their respective bin cards rendered beneath them.

---

## 2. Architecture & Design Decisions

### A. State Storage: Database vs Environment Variable
| Criterion | Environment Variable (`.env`) | Database (`AppSetting` table) |
|---|---|---|
| **Toggle from UI** | ❌ No (requires server restart/redeploy) | ✅ Yes (instant toggle in `/bins`) |
| **Multi-device sync** | ⚠️ Only after redeploy | ✅ Instant across all phones/tablets |
| **Audit trail** | ❌ None | ✅ Can track who toggled it and when |
| **Recommendation** | Fallback default only | **Primary source of truth** |

We will introduce a lightweight `AppSetting` model in Prisma:
```prisma
model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())

  @@map("app_settings")
}
```
A dedicated route `GET/PUT /api/settings/bin-tracking` will handle reading and updating this setting with permission checks (`bins.edit` or `admin`).

### B. Inbound Item-Level Brand & Category Matching
When `GET /api/inbound/[id]/putaway` suggests bins:
1. First evaluate `item.productId` for a direct product rule.
2. Next evaluate `item.product.brandId` and `item.product.categoryId`.
3. If either is missing on the product, fall back to `shipment.brandId` and `shipment.categoryId`.
4. In `GET /api/inbound/[id]`, include `product: { select: { brand: true, category: true } }` so the UI displays the exact brand and category per item.

---

## 3. Files to Modify & Create

### 1. Database & Configuration
- **[MODIFY]** `prisma/schema.prisma`
  - Add `AppSetting` model for persistent runtime settings.
  - Run `npx prisma db push` or migration.
- **[MODIFY]** `src/lib/inventory-config.ts`
  - Convert static boolean export to a dynamic resolver:
    - Server helper: `isBinTrackingEnabled(): Promise<boolean>`
    - Client hook/state: `useBinTracking()` hook or direct API fetch.
  - Keep backward-compatible signature so other files don't break.

### 2. API Routes
- **[NEW]** `src/app/api/settings/bin-tracking/route.ts`
  - `GET`: Returns `{ enabled: boolean, source: "db" | "env" }`
  - `PUT`: Updates `AppSetting` with key `"BIN_TRACKING_ENABLED"`. Requires `bins.edit` permission.
- **[MODIFY]** `src/app/api/inbound/[id]/route.ts`
  - Include `brand` and `category` in `lineItems.product` query.
  - Use dynamic bin tracking check instead of static constant.
  - Relax mandatory shipment-level category check if line items have product categories.
- **[MODIFY]** `src/app/api/inbound/[id]/putaway/route.ts`
  - Update matching logic to strictly prioritize `item.product.brandId` and `item.product.categoryId` before shipment fallback.
  - Return item brand and category in the putaway response.
- **[MODIFY]** `src/app/api/products/bulk/route.ts`
  - Check dynamic bin tracking setting before rejecting bin assignment.
- **[MODIFY]** `src/app/api/stock/by-bin/route.ts`
  - Check dynamic bin tracking setting.

### 3. Frontend Components & Pages
- **[MODIFY]** `src/app/(dashboard)/bins/page.tsx`
  - Add **Bin Tracking Toggle Switch** in the page header with instant status update.
  - Replace single-site pill buttons with **Store & Warehouse Filter bar** (search input, store dropdown, type filter, "All Sites" view).
  - Group and render bins under warehouse headers showing Store name, Warehouse name, and Type (`FLOOR` / `GODOWN`).
- **[MODIFY]** `src/app/(dashboard)/inbound/[id]/page.tsx`
  - Update `LineItem` interface with `product.brand` and `product.category`.
  - Render Brand and Category badges next to product name and SKU on each line item card.
  - Call `/api/inbound/[id]/putaway` suggestions when loading to pre-select home bins.
- **[MODIFY]** `src/app/(dashboard)/stock/page.tsx`
  - Fetch dynamic bin tracking setting so the **"Bin"** bulk action button is visible and active when enabled.

---

## 4. Open Questions & Clarifications for User

1. **Shipment-Level Category Gate**:
   - Currently, receiving lines requires setting the shipment category (e.g. Cycles vs Spares) because Cycles generate unit codes (`U-000481`) while Spares do not.
   - If we remove the shipment-level category requirement, should the system determine whether an item is a Cycle based on the **Item's own Category / Tags** (e.g. if the item's category is "Bicycles" or has cycle tags)?
2. **Toggle Permission**:
   - Should only users with `ADMIN` role or any user with `bins.edit` permission be allowed to toggle Bin Tracking ON/OFF in `/bins`?

---

## 5. Verification Plan

### Automated Build Verification:
```bash
npm run build
```
Ensure zero TypeScript compilation errors and valid Next.js route builds.

### Manual Test Flows:
1. **Toggle Bin Tracking**:
   - Open `/bins`. Toggle switch to ON.
   - Verify `/stock` immediately shows the bulk "Bin" action button.
   - Toggle switch to OFF. Verify `/stock` hides bin controls.
2. **Warehouse Directory View**:
   - Open `/bins`. Select "All Sites".
   - Verify all warehouses (BCH Floor, Godown, etc.) display with their type badges and their respective bins.
   - Type in the search box to filter bins across all warehouses.
3. **Inbound Line Item Brand & Category**:
   - Open an inbound shipment `/inbound/[id]`.
   - Verify each line item card displays its respected Brand badge and Category badge.
   - Verify Home Bin Rule matches item-level brand + category and suggests the correct bin.
