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
- `/api/services/cron/*`, `/api/cron/*` — invoked by a scheduler, no user exists
- `/api/services/earn-sync` — shared-key guarded, for external pollers

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
