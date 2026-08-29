@AGENTS.md

# IMPORTANT: Read this every session

## Before ANY code change
1. ASK questions first — do not assume you understand the issue
2. Read ALL files related to the change, not just the one mentioned
3. Show a plan. Wait for approval.

## During implementation
- Fix the ROOT CAUSE. Never patch symptoms.
- Check every file that uses the code you changed.
- If something breaks, REVERT and re-plan. Never stack fixes.
- If you discover something unexpected, STOP and ask.
- **Every code path must be observable — see "Logging is mandatory" below.**

## Logging is mandatory
No new code ships without logs. `console.log` is banned; it cannot be turned off in
production and it leaks credentials.

**Use `src/lib/logger.ts`.** Scope it once per module:

```ts
import { createLogger } from "@/lib/logger";
const log = createLogger("stock:reorder");
```

**Level rules — pick by what the reader must DO, not by how you feel about the line:**

| Level | Use for | Example |
|---|---|---|
| `log.debug` | Every outbound request/response, payload sizes, timings | `log.debug("-> POST /items", { count })` |
| `log.info` | A business event completed | `log.info("pull finished", { itemsNew: 42 })` |
| `log.warn` | Recovered, but someone should know | `log.warn("retry 2/3 after 429")` |
| `log.error` | The operation failed | `log.error("pull failed", { status, endpoint })` |

Threshold comes from the environment (`LOG_LEVEL` server, `NEXT_PUBLIC_LOG_LEVEL` browser):
`0`=debug `1`=info `2`=warn `3`=error `4`=silent. Default: `1` in dev, `2` in production.

**Non-negotiables**
- **Never call `fetch().then(r => r.json())` from the browser.** Use `apiFetch` /
  `apiTry` from `src/lib/api-client.ts`. Raw `.json()` on an HTML response produces
  `Unexpected token '<'`, which hides the real fault (expired session -> 307 -> /login
  returns HTML with status 200, so `res.ok` does NOT catch it).
- **Never call `res.json()` on a third-party response.** Use `readJson()` from
  `src/lib/http-json.ts`. It checks content-type first and names the service and status.
- **Every `catch` logs before it rethrows or swallows.** A bare `catch {}` is a bug.
- **Never log a secret.** No tokens, access codes, passwords, refresh tokens, cookies.
  `redact()` covers the obvious keys, but pass deliberate context objects, not whole bodies.
- Log the *identifiers* needed to find the record again (pullId, jobId, vendorId), never
  the whole payload.

## After implementation
- Run `npm run build` — it MUST pass.
- Open the page in the browser and verify visually.
- Tell me: what changed, what's affected, what to test.

## Next.js
This version has breaking changes. Read `node_modules/next/dist/docs/` before writing code.

---

# Architecture you must not break

## Access control is DATA, not code

Permissions live in the database (`modules`, `permissions`, `roles`, `role_permissions`), not
in source files. This is deliberate: access changes take effect on the next request with no
redeploy. There was previously a `Role` enum plus hardcoded permission maps; they are gone.

```
Module 1─* Permission *─* Role 1─* User        one user = one role
                └ RolePermission ┘             a row's existence IS the grant
```

**Rules — a violation here is a bug even if the build passes:**

1. **Never compare a role name.** `if (user.role === "ADMIN")` and
   `["SUPERVISOR","MANAGER"].includes(role)` are both wrong. Roles are rows an admin can
   create at runtime, so no list of names in code can be correct. Check a permission instead:
   `await userCan(user.id, "stock", "edit")`.
2. **Never add a role allow-list to a guard.** `requireFeature(module, action)` takes exactly
   two arguments. There is no fallback-roles parameter and no admin short-circuit — ADMIN
   passes only because it holds every permission.
3. **Never import `prisma/rbac-catalog.ts` from `src/`.** It is seed input. Importing it at
   runtime puts permissions back in a file and defeats the whole design.
4. **Never put permissions in the JWT.** The token carries identity only (`userId`,
   `roleKey`, `roleName`). A JWT cannot be revoked before it expires; permissions must be
   read from the database per request so a revoked grant applies immediately.
5. **Frontend checks are cosmetic.** `canEdit(...)` hides a button. The API must re-check.
   Never let the client be the only gate.

### Where things live

| Concern | File |
|---|---|
| Permission resolver (the primitive) | `src/lib/rbac.ts` — `getAccess`, `userCan` |
| Route guards | `src/lib/auth-helpers.ts` — `requireAuth`, `requireFeature` |
| Workshop route guard | `src/lib/services/guard.ts` — `serviceGuard` |
| Client store | `src/stores/permissions.ts` |
| Seed catalog | `prisma/rbac-catalog.ts` (modules + default roles) |

### Business logic that used to key off roles

Rules like "supervisors see all records, juniors see only their own" are expressed as the
module's **`approve`** grant. Cost-price visibility is its own module (`cost_price`). If you
find yourself wanting a role name to express a business rule, add a permission instead.

## Routes that must stay public

These serve people with no account. **Adding a permission check to them breaks a customer
flow silently** — it has already happened once.

- `/review/[token]` + `GET`/`POST /api/services/reviews` — customer review from a WhatsApp link
- `/fill/[token]` + `/api/public/*` — customer delivery forms
- `/api/auth/*` — the login handler itself
- `/api/my-permissions` — authentication only; gating it deadlocks the permission bootstrap
- `/api/services/earn-sync` — shared-key guarded, for external pollers

## There are no scheduled jobs

This application has **no cron jobs and no background timers.** `api/cron/*` and
`api/services/cron/*` were deleted, `CRON_SECRET` is gone, and `vercel.json` no longer
declares a `crons` array. Screens do not poll either — every one of them loads on mount and
refreshes only when a person asks.

Anything that used to run on a schedule is now a button behind `requireFeature`:

| Was | Now |
|---|---|
| `api/cron/zoho-pull` | `POST /api/zoho/trigger-pull` |
| `api/cron/invoice-pull` | the **Bulk Fetch** tab on `/deliveries` — pulls a date window and imports after review |
| `api/cron/overdue-alerts` | `POST /api/alerts/scorecard` (`settings.edit`) |
| `api/cron/counter-watchdog` | **removed, not replaced** — a dead store counter is no longer reported by anything |
| `api/cron/footfall-rollup` | **removed, not replaced** — `count_events` is no longer pruned and `FootfallDaily` is never written |

**Do not add a cron, a `setInterval`, or a scheduled route.** If work genuinely has nobody
to trigger it, raise it rather than reintroducing a scheduler. See
`docs/implementation/completed/cron-removal-plan.md` for what was removed and what was knowingly given up.

## The service / workshop module

`/services/*` is the former standalone `bch-service` app, merged in. Its own auth layer
(unsigned JSON cookie, trivially forgeable) was deleted — everything goes through NextAuth
plus `serviceGuard`.

- Screens: `src/app/(dashboard)/services/`
- API: `src/app/api/services/`
- Models: `ServiceJob`, `Review`, `TaskAssignment`, `PriceItem`, `AssemblyLog`,
  `TokenCounter`, `ServiceAuditLog`, `NotificationLog`
- **One `Customer` table** shared with inventory. `phone` is required and unique — it is the
  customer's identity, and both the counter and the workshop resolve to the same row.
- **One `User` table.** Workshop staff are ordinary users holding a `SERVICE_*` role. Manage
  them at `/team`, not inside the workshop screens.
- `TokenCounter` mints `BCH-0001` job tokens. Increment it **inside a transaction** —
  `tokenNumber` is unique, so a read-then-write hands two jobs the same token.

Known follow-ups, deliberately not done: ported routes keep the service app's response shape
(`{ jobs }`) rather than `successResponse`, have no zod schemas, and still carry the old
styling rather than the BCH OPS design system.

## Environment gotchas

- **`prisma generate` fails with `EPERM`** while the dev server is running — it holds the
  query engine. Stop the server first.
- **`npm run build` needs a reachable database.** Three pages are server components that
  query Prisma and are statically prerendered, so the build connects to `DATABASE_URL` and
  fails with `PrismaClientInitializationError` if nothing answers:
  `/staff-lms/playbooks`, `/staff-lms/product-learning`, `/staff-lms/products`.
  Start Postgres before building. This is deliberate — they are left static by choice, so
  their content is baked at build time and only changes on redeploy. Adding
  `export const dynamic = "force-dynamic"` to any of them would make it render per request
  and drop the build-time database requirement; do that only if asked.
- **next-auth v4 types don't resolve** under this project's `moduleResolution: "bundler"`.
  Do **not** add `declare module "next-auth"` augmentation — it shadows the package's real
  types and silently degrades `Session` to `{}` across the codebase. Use local structural
  types (see `src/lib/auth.ts`).
- **`ts-node` inline JSON breaks on Windows.** Seed scripts use
  `--project prisma/tsconfig.json`.
- **A truncated `npm install` leaves packages that look installed but aren't.** It has
  produced a 23 MB SWC binary (should be 130 MB) and a `jspdf` with no `types/` directory.
  If a dependency error makes no sense, compare the on-disk size against
  `npm view <pkg> dist.unpackedSize` before working around it.

---

## Board of Agents (8 members)
Before completing any feature, consult the relevant agent(s). Read their doc FIRST, check your implementation against their principles and red flags. If a violation is found, flag it to the user before marking done.

### Domain Consultants (business rules)
- **Inventory / Stock / Reorder / Products**: Read `docs/agents/inventory-consultant.md`
  - Applies to: stock pages, inbound, reorder, product CRUD, stock audit, transfers
- **Warehouse / Bins / Dispatch / Inbound receiving**: Read `docs/agents/warehouse-consultant.md`
  - Applies to: inbound shipment flow, bin management, delivery dispatch, handover checklist
- **Accounting / Bills / Payments / Receivables / Expenses**: Read `docs/agents/accounting-consultant.md`
  - Applies to: bills, payments, receivables, expenses, settlement, Zoho sync
- **GST / Tax Compliance**: Read `docs/agents/gst-consultant.md`
  - Applies to: HSN codes, tax rates, e-way bills, ITC, invoicing, Zoho tax sync

### Technical Agents (implementation quality)
- **Database / Schema / Queries**: Read `docs/agents/database-architect.md`
  - Applies to: schema changes, new models, indexes, raw SQL, transactions
- **Frontend / React / UI**: Read `docs/agents/frontend-engineer.md`
  - Applies to: pages, components, state management, mobile layout, loading/error states
- **Backend / API / Validation**: Read `docs/agents/backend-engineer.md`
  - Applies to: route handlers, Zod schemas, auth, status transitions, business logic
- **Integration / Zoho / Data Flow**: Read `docs/agents/integration-architect.md`
  - Applies to: Zoho sync, Supabase storage, WhatsApp messaging, external API calls
