# Store Hierarchy & Team Management Plan

Status: **approved, not started**
Scope: replace the hardcoded `StockLocation` enum with a real `Store → Warehouse`
hierarchy, and rebuild `/team` as a paginated table with row actions.

---

## 1. The problem

Stores and locations are **not data**. They are a Prisma enum:

```prisma
// prisma/schema.prisma:211
enum StockLocation { STORE WAREHOUSE BCH_WAREHOUSE BCH_STORE BCC_WAREHOUSE BCC_STORE }
```

…mirrored by a hardcoded array in `src/lib/inventory-config.ts:17`, and consumed by
**6 models** and **~20 files** under `src/`. Adding a store today means a schema edit,
a `db push` and a redeploy.

This is the same failure mode the RBAC rewrite already fixed for permissions. `CLAUDE.md`
states the principle — *access control is DATA, not code* — and store structure belongs
in the same category: it is operational configuration an admin changes, not a fact about
the program.

Second problem: `/team` renders users as role-grouped cards with no pagination, no row
actions, and no way to see or set which store a person belongs to.

### Where the enum is used today

| Model | Column |
|---|---|
| `StockLevel` | `location` (part of `@@unique([productId, location])`) |
| `TransferOrder` | `fromLocation`, `toLocation` |
| `TransferOrderItem` | `fromLocation`, `toLocation` |
| `CountEvent` | `storeId` |
| `AgentHeartbeat` | `storeId` |
| `AnalyticsDevice` | `storeId` (part of `@@unique([storeId, agentId])`) |
| `FootfallDaily` | `storeId` |

---

## 2. Decisions taken

These were settled before planning. They are recorded here so the reasoning is not lost.

| Question | Decision | Why |
|---|---|---|
| Depth of change | Full migration to tables | A half-fix leaves two sources of truth |
| Child model name | **`Warehouse`**, not `Location` | Matches how the business already speaks; the shop floor is just a warehouse named "BCH Store" |
| `kind` enum on the child | **Dropped** | The name carries the meaning; a `kind` column would be a second thing to keep in sync |
| Store ↔ Warehouse | One store, many warehouses; a warehouse has exactly one store | The FK enforces it — no application code |
| Second warehouse of the same "type" | Allowed | No `@@unique([storeId, kind])` constraint |
| Store with zero warehouses | Allowed | Created first, warehouses added after, shown with a warning badge |
| Existing data | None to preserve | Confirmed — collapses the migration to a single `db push` |
| Legacy `STORE` / `WAREHOUSE` enum values | Deleted with the rest of the enum | No rows depend on them |
| User delete | Hard delete when clean, deactivate when linked | Preserves stock audit trails |
| `/team` on mobile | Table ≥ `sm`, cards below | 7 columns cannot fit a phone; this is a PWA + Capacitor app |
| Build order | Team table before the stock migration | Ships something visible and testable before the risky work |

### Open item

`kind` is gone, which removes the thing that expressed *"only a location with a doorway can
host a footfall camera"* — currently hardcoded at `src/lib/validations.ts:490` as
`z.enum(["BCH_STORE", "BCC_STORE"])`. Replaced by a `Warehouse.hasEntrance` boolean: same
rule, now a column an admin can flip instead of a constant in source. **Revisit if the flag
turns out to be noise** — the alternative is to let any warehouse take a camera.

---

## 3. Schema

```prisma
model Store {
  id        String  @id @default(cuid())
  code      String  @unique          // "BCH", "BCC"
  name      String                   // "Bharath Cycle Hub"
  address   String?
  phone     String?
  isActive  Boolean @default(true)
  sortOrder Int     @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  warehouses Warehouse[]
  users      User[]
}

model Warehouse {
  id          String  @id @default(cuid())
  storeId     String
  store       Store   @relation(fields: [storeId], references: [id])
  code        String  @unique        // "BCH_STORE", "BCH_WAREHOUSE" — reuses the old enum strings
  name        String                 // "BCH Store", "BCH Warehouse"
  hasEntrance Boolean @default(false) // may host a footfall camera
  isActive    Boolean @default(true)
  sortOrder   Int     @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  stockLevels StockLevel[]
  users       User[]

  @@unique([storeId, code])
  @@index([storeId])
}
```

`Warehouse.code` is deliberately seeded to the **old enum strings**. That keeps URLs such
as `/stock/by-location/BCH_STORE` resolvable through the transition and makes the seed a
plain lookup rather than a mapping table.

`User` gains two nullable columns: `storeId` and `warehouseId`. Both optional — a user may
be assigned to a store, a warehouse, both, or neither.

---

## 4. Phases

Ordered so the visible work lands before the destructive work.

### Phase 1 — Tables

- Add `Store` and `Warehouse` to `prisma/schema.prisma`.
- Add nullable `User.storeId` / `User.warehouseId`.
- `npm run db:push`.
- New `prisma/seed-stores.ts` — creates BCH and BCC plus their four warehouses, with
  `code` set to the old enum values and `hasEntrance = true` on the two shop floors.

Nothing else is touched. The enum still runs the stock system at the end of this phase.

### Phase 2 — `/team` as a table

New components (neither exists in `src/components/ui/` today):

- `table.tsx`
- `pagination.tsx`

`src/app/(dashboard)/team/page.tsx` — **the role-grouped card block at lines 80–137 is
deleted outright.** No toggle, no fallback, no dead code.

| Name / email | Role | Store · Warehouse | Status | Txns | Created | Actions |
|---|---|---|---|---|---|---|

Actions column uses `lucide-react` (already a dependency):

| Icon | Action |
|---|---|
| `Pencil` | → `/team/[id]` |
| `UserCheck` / `UserX` | toggle `isActive` via `PUT /api/users/[id]` |
| `Trash2` | `DELETE /api/users/[id]`, behind a confirm |

The delete handler **surfaces the message the API returns** rather than assuming success.
`DELETE /api/users/[id]` hard-deletes a user with no history and silently falls back to
deactivating one that has transactions or stock counts — today the UI would show both as
"deleted", which is a lie.

Pagination moves **server-side**. `GET /api/users` already returns `paginatedResponse`;
the page currently requests `limit: "50"` (`page.tsx:34`) and discards the `pagination`
block entirely. 20 rows per page, prev/next plus page numbers.

Below the `sm` breakpoint the table is replaced by a compact card list carrying the same
three action icons.

Two `CLAUDE.md` violations in this file are fixed as part of the rewrite:

- `page.tsx:36` uses `fetch().then(r => r.json())`, which is **banned** — a 307 to `/login`
  returns HTML with status 200 and `res.ok` does not catch it. Replaced with `apiFetch`
  from `src/lib/api-client.ts`.
- The file has no logging. Adds `createLogger("team:list")`.

### Phase 3 — Roles search & store assignment

- `/team/permissions`: a search input above the role pill row, filtering on name and key.
  Client-side — every role already arrives in one request, so a round-trip per keystroke
  would be slower, not faster.
- A role filter on the team table as well. *"Search in the roles listing"* could
  reasonably mean either; both are cheap.
- `/team/[id]` and `/team/new`: a **Store** select and a **Warehouse** select, the latter
  filtered to the chosen store's warehouses.
- `POST /api/users` and `PUT /api/users/[id]` accept `storeId` / `warehouseId` and
  **reject a warehouse that does not belong to the chosen store**. The client-side filter
  is cosmetic; the API is the gate.
- `userSchema` in `src/lib/validations.ts` updated.

**Not in scope:** the assignment is stored and displayed only. It does **not** filter what
a user sees — a BCH-assigned user still sees BCC stock. Enforcing visibility means touching
every stock query and the RBAC resolver, and belongs in its own phase with its own plan.

### Phase 4 — Stock migration

Every enum column becomes a `warehouseId` FK:

| Model | Before | After |
|---|---|---|
| `StockLevel` | `location` | `warehouseId`, `@@unique([productId, warehouseId])` |
| `TransferOrder` | `fromLocation` / `toLocation` | `fromWarehouseId` / `toWarehouseId` |
| `TransferOrderItem` | `fromLocation` / `toLocation` | `fromWarehouseId` / `toWarehouseId` |
| `CountEvent` | `storeId` | `warehouseId` |
| `AgentHeartbeat` | `storeId` | `warehouseId` |
| `AnalyticsDevice` | `storeId` | `warehouseId`, `@@unique([warehouseId, agentId])` |
| `FootfallDaily` | `storeId` | `warehouseId` |

`enum StockLocation` is deleted. Single `db push --accept-data-loss`, then reseed.

> This project has **no `prisma/migrations/` directory** — it uses `prisma db push`. With
> real data present this migration would need a three-step add-nullable → backfill → drop
> sequence. It does not, which is the only reason a single push is safe here. **If this
> plan is picked up after data exists, that assumption is void.**

### Phase 5 — Delete the hardcoded location code

Removed from `src/lib/inventory-config.ts` (`BIN_TRACKING_ENABLED` stays):

`STOCK_LOCATIONS` · `type StockLocation` · `isStockLocation` · `stockLocationLabel` ·
`DEFAULT_STOCK_LOCATION`

New `src/lib/warehouses.ts` reads the set from the database with a request-scoped cache, so
a dropdown does not issue four queries. New `GET /api/warehouses` for client components.

Files to rewrite:

| Layer | Files |
|---|---|
| lib | `stock-location.ts`, `validations.ts`, `analytics/store.ts`, `analytics/device-auth.ts` |
| API | `stock/by-location/[location]`, `stock/by-bin`, `inbound/[id]`, `inbound/[id]/status`, `transfer-orders`, `transfer-orders/[id]/approve`, `stock-counts`, `stock-counts/[id]`, `analytics/dashboard`, `cron/counter-watchdog` |
| Pages | `transfers`, `transfers/new`, `stock-audit/new`, `stock-audit/brand-count`, `stock/by-location/[location]`, `stock/by-brand`, `inbound/[id]`, `analytics`, `analytics/devices` |

Two behaviours to preserve deliberately:

- `src/app/api/transfer-orders/route.ts:17` hardcodes the four values in a zod enum →
  becomes *"must be an active warehouse id"*.
- `src/lib/validations.ts:490` restricts camera devices to `BCH_STORE` / `BCC_STORE` →
  becomes *"must be a warehouse with `hasEntrance`"*.

The edge counting agents authenticate by API key, not by `storeId`, so their ingest
contract is unaffected — **verify this before touching `analytics/device-auth.ts`, not
after.**

### Phase 6 — `/settings/stores`

- New `stores` module in `prisma/rbac-catalog.ts` — route `/settings/stores`, full CRUD
  actions. Requires `npm run db:seed:rbac`.
- `GET/POST /api/stores`, `GET/PUT/DELETE /api/stores/[id]`
- `GET/POST /api/warehouses`, `GET/PUT/DELETE /api/warehouses/[id]`
- All behind `requireFeature("stores", …)`.
- Screen: store list → expand to its warehouses → create / edit / delete both.

**Delete rule**, matching `/team`: hard-delete when nothing references the row; when a
warehouse holds stock or transfer history, refuse with a precise message — *"BCH Warehouse
holds 412 stock rows across 87 products"* — and offer deactivate. Stock is never silently
orphaned.

---

## 5. Blast radius

- **Phases 4–5 rewrite every stock read in the application.** `StockLevel` is the source of
  the cached `Product.currentStock`. A missed file reads as zero stock, not as an error.
- **Analytics and footfall** move four models at once.
- **The counting agents** — confirm the ingest contract before Phase 5.
- **Existing role grants** — the new `stores` module means every non-system role starts
  with no access to it until granted on `/team/permissions`. ADMIN is unaffected because it
  holds every permission by construction.
- **Phases 2–3 ship against an enum-based stock layer.** That is the price of doing the
  visible work first. The two areas do not overlap.

## 6. Verification

`npm run build` at the end of Phase 3, Phase 4 and Phase 5 — it must pass before the next
phase starts.

Pages to open and check by hand:

`/team` · `/team/[id]` · `/team/new` · `/team/permissions` · `/settings/stores` ·
`/stock/by-location/BCH_STORE` · `/transfers/new` · `/stock-audit/brand-count` ·
`/stock-audit/new` · `/analytics` · `/analytics/devices` · `/inbound/[id]`

Per `AGENTS.md`, every `git`, `npm` and `prisma` command is proposed for approval rather
than run on initiative.
