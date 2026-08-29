# Zoho / Zakya Config Consolidation Plan

Status: in-progress — being implemented on refactor/integration-config
Branch: `refactor/integration-config` (separate from storage and cron work).
Prepared 28 Aug 2026.

---

## 1. Answer to the direct question

**Yes — `ZohoConfig`, `ZakyaConfig` and `ZohoInventoryConfig` are all dropped.** They are
replaced by a single `IntegrationConfig` table with a `provider` discriminator.

The app is being restructured and data loss is acceptable, so this plan does **not** carry
old rows across. See §7 — the one practical cost is re-authorising the three connections.

## 2. Why — the duplication is worse than three tables

### The tables are byte-identical

All three declare the **same 13 columns in the same order**: `id`, `clientId`,
`clientSecret`, `refreshToken`, `accessToken`, `accessTokenExpiresAt`, `organizationId`,
`organizationName`, `isConnected`, `lastSyncAt`, `createdAt`, `updatedAt`. Not similar —
identical. There is no field that distinguishes one integration from another.

### The clients are triplicated too

| File | Lines |
|---|---|
| `src/lib/zoho.ts` | 510 |
| `src/lib/zakya.ts` | 369 |
| `src/lib/zoho-inventory.ts` | 331 |
| **total** | **1,210** |

Every one of them declares the *same constant*:

```ts
const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";
```

The only genuine difference between the three is one line:

| Client | API base |
|---|---|
| `zoho.ts` | `https://www.zohoapis.in/books/v3` |
| `zakya.ts` | `https://api.zakya.in/inventory/v1` |
| `zoho-inventory.ts` | `https://www.zohoapis.in/inventory/v1` |

**Copied verbatim three times** — `init()`, `refreshAccessToken()`, `delay()`, `apiCall()`
and the standalone `exchangeGrantToken*()`. That is roughly **465 of the 1,210 lines**.

And the duplication continues into the domain methods. These exist in more than one client
with the same signature, because all three speak the same Zoho response shapes:

`listBills` · `listAllBills` · `getBill` · `listInvoices` · `listAllInvoices` ·
`getInvoice` · `listCustomerPayments` · `listAllCustomerPayments` · `listItems` ·
`listAllItems`

### And the routes

Nine route files that differ only in which client they import:

```
src/app/api/zoho/auth/{connect,disconnect,status}/route.ts
src/app/api/zakya/auth/{connect,disconnect,status}/route.ts
src/app/api/zoho-inventory/auth/{connect,disconnect,status}/route.ts
```

## 3. Target shape

```
              ┌────────────────────────────────────┐
              │  IntegrationConfig  (one table)    │
              │  provider = ZOHO_BOOKS | ZAKYA_POS │
              │             | ZOHO_INVENTORY       │
              └─────────────────┬──────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │  IntegrationClient  (base class)   │
              │  init · refresh · apiCall · delay  │
              │  + the shared list*/get* methods   │
              └─────┬───────────┬──────────────┬───┘
             BooksClient   ZakyaClient   InventoryClient
            (items,        (nothing but  (items,
             contacts)      its base URL) bill details)

  /api/integrations/[provider]/{connect,disconnect,status}   ← 3 routes, not 9
```

## 4. Data model

Replaces all three models:

```prisma
model IntegrationConfig {
  provider             String    @id   // ZOHO_BOOKS | ZAKYA_POS | ZOHO_INVENTORY
  clientId             String?
  clientSecret         String?
  refreshToken         String?
  accessToken          String?
  accessTokenExpiresAt DateTime?
  organizationId       String?
  organizationName     String?
  isConnected          Boolean   @default(false)
  lastSyncAt           DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@map("integration_config")
}
```

`provider` is the primary key. Each integration is a singleton, exactly as today — the old
`id @default("singleton")` becomes the provider name, which is more honest about what the
row is.

> Keeping `provider` as a plain `String` rather than a Prisma enum is deliberate: adding a
> fourth integration should be a row, not a migration. The three valid values are validated
> in the route with zod.

## 5. Client architecture

**`src/lib/integrations/base.ts`** — everything currently triplicated:

```ts
export abstract class IntegrationClient {
  protected abstract provider: string;   // row key
  protected abstract apiBase: string;    // the one real difference

  async init(): Promise<boolean>                    // load row, refresh if stale
  protected async refreshAccessToken(...)           // one copy, not three
  async apiCall<T>(method, endpoint, body?)         // one copy, not three
  async delay(ms)

  // shared because all three speak the same Zoho response shapes
  async listBills(...)      async listAllBills(...)     async getBill(id)
  async listInvoices(...)   async listAllInvoices(...)  async getInvoice(id)
  async listCustomerPayments(...)  async listAllCustomerPayments(...)
  async listItems(...)      async listAllItems(...)
}

export async function exchangeGrantToken(              // one copy, not three
  provider: string, clientId: string, clientSecret: string, grantToken: string
)
```

**`src/lib/integrations/{books,zakya,inventory}.ts`** — thin subclasses declaring
`apiBase`, `provider`, and only what is genuinely theirs:

| Subclass | Keeps |
|---|---|
| `BooksClient` | `createItem`, `createContact`, `createInvoice`, `createBill`, `searchContacts`, `listContacts`, `listAllContacts`, `getOrganizations` |
| `ZakyaClient` | nothing beyond the base — it is base URL plus configuration |
| `InventoryClient` | `getBillDetails`, `createItem` |

Expected result: **~1,210 lines → ~450**, with each behaviour existing once.

> A subclass must not inherit a method its API does not support. Where an endpoint is
> genuinely absent for a provider, override it to throw a clear error rather than letting
> it 404 at runtime with a confusing Zoho message.

## 6. Routes

Nine collapse to three:

```
src/app/api/integrations/[provider]/connect/route.ts
src/app/api/integrations/[provider]/disconnect/route.ts
src/app/api/integrations/[provider]/status/route.ts
```

- `[provider]` is validated against the three known values; anything else is a 400 before
  any database or network call.
- Guards are unchanged: `requireFeature("zoho", "create" | "edit" | "view")`. The `zoho`
  module keeps its key, so **every existing role grant keeps working**.
- The old nine directories are deleted.

## 7. What breaks, and the one thing you must do afterwards

**All three integrations will show "Not connected" and must be re-authorised.** The old
tables are dropped without copying rows, so the stored `refreshToken` values go with them.
A refresh token cannot be regenerated from the client id and secret — you have to redo the
self-client grant-token flow in the Zoho console for each of Books, Zakya and Inventory.

Practically: keep the three client ids and secrets to hand before starting, and budget ten
minutes at the end to reconnect all three through the UI.

Nothing else is lost. Synced business data — bills, invoices, contacts, items — lives in
its own tables and is not touched.

## 8. File-by-file

### New

| File | Purpose |
|---|---|
| `src/lib/integrations/base.ts` | `IntegrationClient` + `exchangeGrantToken` |
| `src/lib/integrations/books.ts` | `BooksClient` |
| `src/lib/integrations/zakya.ts` | `ZakyaClient` |
| `src/lib/integrations/inventory.ts` | `InventoryClient` |
| `src/lib/integrations/index.ts` | `getClient(provider)` factory + provider constants |
| `src/app/api/integrations/[provider]/connect/route.ts` | replaces 3 |
| `src/app/api/integrations/[provider]/disconnect/route.ts` | replaces 3 |
| `src/app/api/integrations/[provider]/status/route.ts` | replaces 3 |

### Deleted

| File | Reason |
|---|---|
| `src/lib/zoho.ts`, `src/lib/zakya.ts`, `src/lib/zoho-inventory.ts` | superseded |
| `src/app/api/zoho/auth/**` (3) | superseded |
| `src/app/api/zakya/auth/**` (3) | superseded |
| `src/app/api/zoho-inventory/auth/**` (3) | superseded |

### Modified

| File | Change |
|---|---|
| `prisma/schema.prisma` | drop 3 models, add `IntegrationConfig` |
| `src/app/api/zoho/trigger-pull/route.ts` | import the factory |
| `src/app/api/zoho/import/**` | import the factory |
| `src/app/api/deliveries/import-zoho/`, `search-zoho/` | import the factory |
| `src/app/api/services/zoho/route.ts` | import the factory |
| the integrations page | point the three cards at `/api/integrations/<provider>/*` |

Exact call sites: every file matching
`grep -rln "zohoConfig\|zakyaConfig\|zohoInventoryConfig" src/` — **14 files** at time of
writing — plus importers of the three old libs.

> Sequencing note: if the cron branch lands first, `src/app/api/cron/zoho-pull/route.ts`
> is already gone and is one fewer file to touch here.

## 9. Rollout

1. Branch `refactor/integration-config`.
2. Write `base.ts` and the three subclasses; keep the old files in place so the build
   stays green while porting.
3. Add the three `[provider]` routes.
4. Repoint all 14 call sites.
5. Delete the old libs and the nine old routes.
6. Schema: drop the three models, add `IntegrationConfig`. **Editing
   `prisma/schema.prisma` now triggers the schema-review hook — expect a review before the
   push.**
7. Stop the dev server, then `npm run db:push`. `prisma generate` fails with `EPERM`
   while the server holds the query engine.
8. `npm run build`.
9. Reconnect Books, Zakya and Inventory through the UI (§7).

## 10. Verification

- `npm run build` passes.
- `grep -rn "zohoConfig\|zakyaConfig\|zohoInventoryConfig" src/` returns nothing.
- `grep -rn "ZOHO_ACCOUNTS_URL" src/` returns **one** hit, not three.
- All three cards on the integrations page connect, show **Connected**, and survive a
  reload — proving the refresh path works for each provider through one code path.
- A Zoho pull runs end to end and writes the same rows it did before.
- A user holding only `zoho.view` sees status but cannot connect — proving the guard
  survived the route move.

## 11. The fourth client — found 29 Aug 2026, now fixed

§2 counted three Zoho clients. There were **four**. `src/lib/services/zoho.ts` (204 lines,
the workshop's invoice lookup) was missed because it matches none of the greps this plan
used to find call sites: it never mentions `zohoConfig`, and it does not import
`src/lib/zoho.ts`. It carried its own module-scoped token cache, its own hardcoded
`https://accounts.zoho.in/oauth/v2/token`, and read credentials from **environment
variables** — `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_ORG_ID`.

That is worse than duplication. It is a **second source of truth for one integration**:
disconnecting Zoho Books in Settings → Integrations did not disconnect it for the workshop,
because this file never read `IntegrationConfig`. The JobCard invoice lookup kept working
off env vars regardless of what the UI said.

**Fixed.** Both files now go through `getBooks()`:

| File | Change |
|---|---|
| `src/lib/services/zoho.ts` | transport removed — `getAccessToken`, the token cache, `ORG_ID`, `BASE` and `zohoGet` all deleted; the five workshop query functions now call `client.apiCall` |
| `src/app/api/services/zoho/route.ts` | the bare `catch {}` now logs and distinguishes "not connected" (503) from a genuine Zoho failure (500); the duplicated nine-field invoice mapper is one function |

Two side effects worth recording:

- **`res.json()` on a third-party response is gone.** The old `zohoGet` called it directly,
  which CLAUDE.md bans — an HTML gateway page surfaced as `Unexpected token '<'`. `apiCall`
  uses `readJson`, which names the service and status.
- **Four environment variables are now unused.** Nothing in `src/` reads `ZOHO_REFRESH_TOKEN`,
  `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` or `ZOHO_ORG_ID`. They can be removed from `.env`
  and from the deployment environment.

### Dead code found in passing — decision needed

`extractTokenNumbers` and `listPaidInvoices` in `src/lib/services/zoho.ts` have **zero
consumers** anywhere in `src/`. They were ported to the shared client rather than deleted,
so nothing was silently dropped, but they are ~70 lines that nothing calls. Delete them, or
name what is meant to call them.

## 12. Open question

**Scope.** This document plans the full restructure (table + routes + clients), which is
what "restructure it to use it properly" implies. It can be stopped earlier:

| Level | Result | Files |
|---|---|---|
| 1 — table only | one table, everything else unchanged | 14 edited |
| 2 — + routes | 9 auth routes become 3 | 14 → ~8 |
| 3 — + clients *(this plan)* | 1,210 lines of client code become ~450 | 14 → ~6 |

Confirm level 3, or name a lower one.
