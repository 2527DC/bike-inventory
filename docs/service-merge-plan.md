# Merging `bch-service` into `bch_management`

**Status:** plan only — no merge code written.
**Prerequisite:** the RBAC migration must be complete and `npm run build` green before phase 1 starts.

---

## 1. What this merge is

Fold the standalone workshop app (`F:\bharath  Cycle\bch-service`) into the inventory app so there is:

- **one database** — no duplicate `User` / `Customer` tables
- **one login** — the service app's own auth layer is deleted
- **one sidebar** — service screens appear as modules, gated by `view` permission
- **one route tree** — every service screen lives under `/services/*`

### Measured size of what moves

| | Count | Lines |
|---|---:|---:|
| Pages | 13 | ~4,290 |
| API routes | 33 | ~1,670 |
| Components | 8 | ~1,980 |
| Lib files | 6 | ~380 |
| Prisma models | 10 | — |
| Prisma enums | 4 | — |
| **Total source** | | **~8,500** |

---

## 2. Two findings that shape the whole plan

### 2.1 The service session is forgeable — treat as a live vulnerability

`bch-service/src/lib/auth.ts` reads the session from a cookie called `bch-session` containing
**plain, unsigned JSON**, and trusts it as-is:

```ts
const data = JSON.parse(sessionData);
if (data.id && data.name && data.role) {
  return { id: data.id, name: data.name, role: data.role, emoji: data.emoji || "" };
}
```

No signature, no encryption, no server-side verification. Anyone who can set a cookie in their
own browser can become a `MANAGER`. The in-file comment — *"Session cookie now stores full user
data — no DB call needed"* — shows this was a deliberate performance decision, so it will not
look like a bug to a reviewer skimming the file.

**Consequence for this plan:** the merge deletes this file outright. Until the merge ships, the
standalone app should be treated as compromised-by-design. This is also the strongest argument
for *not* leaving `bch-service` deployed after cutover.

### 2.2 Role keys collide between the two worlds

The service app's `UserRole` enum contains `SUPERVISOR` and `MANAGER`. The inventory app's
retired enum also had `SUPERVISOR`, meaning something different — a stock supervisor, not a
workshop supervisor. Because `roles.key` is `@unique`, seeding both naively either errors or
silently merges two unrelated jobs into one role.

**Resolution:** namespace every service role on the way in.

| Service enum value | New role key |
|---|---|
| `MECHANIC` | `SERVICE_MECHANIC` |
| `SUPERVISOR` | `SERVICE_SUPERVISOR` |
| `STAFF` | `SERVICE_STAFF` |
| `MANAGER` | `SERVICE_MANAGER` |
| `BILLING` | `SERVICE_BILLING` |
| `VIEWER` | `SERVICE_VIEWER` |

---

## 3. Schema merge

Both schemas are Postgres and the service models all carry `@@map`, so most table names do not
collide at SQL level. The duplication is conceptual, which is the harder kind.

| Service model | Table | Action | Notes |
|---|---|---|---|
| `User` | `users` | **drop** | Duplicate. Inventory `User` survives. Service users become inventory users with a `SERVICE_*` role. |
| `Customer` | `customers` | **merge** | Shape conflict — service has `phone` unique + required and a `whatsapp` field; inventory has `phone` optional/non-unique plus `email`/`address`/`type`. Add `whatsapp` to inventory `Customer`; do **not** add the unique constraint. |
| `AuditLog` | `audit_logs` | **merge** | Overlaps inventory `OpsActivityLog`. Fold in with a `scope` discriminator rather than keeping two audit trails. |
| `ServiceJob` | `service_jobs` | port | Core entity. Repoint `mechanicId` / `createdById` at inventory `User`. |
| `Review` | `reviews` | port | Repoint `mechanicId`, `customerId`. |
| `AssemblyLog` | `assembly_logs` | port | Repoint `mechanicId`. Photos move to R2. |
| `TaskAssignment` | `task_assignments` | port | Has an unenforced `mechanicId` — add the real FK while porting. |
| `PriceItem` | `price_items` | port as-is | Service labour pricing. No inventory equivalent (`Product` is goods, not labour). |
| `NotificationLog` | `notification_logs` | port as-is | WhatsApp send log, self-contained. |
| `TokenCounter` | `token_counter` | port | Singleton row minting `BCH-0001`. See risk 7.1. |

**Enums:** `JobStatus`, `JobType`, `PaymentStatus` port unchanged — they encode real workshop
vocabulary. `UserRole` is deleted; its six values become `roles` rows.

**User model additions** (only if PIN login is kept — see open question 1):

```prisma
pin   String?  // bcrypt-hashed 4-digit PIN, workshop staff only
emoji String?  // avatar shown on the shop-floor picker
```

---

## 4. RBAC: modules, permissions, roles

### 4.1 New modules

Seven modules in a new **Service** sidebar group, following the same `module × action` shape as
the existing 26. Added to `prisma/rbac-catalog.ts`, which is idempotent, so this is purely
additive.

| key | Label | Actions |
|---|---|---|
| `service_jobs` | Service Jobs | view, create, edit, delete, approve |
| `service_assembly` | Assembly Log | view, create, edit, delete |
| `service_billing` | Service Billing | view, create, edit, approve |
| `service_prices` | Service Pricing | view, create, edit, delete |
| `service_reviews` | Customer Reviews | view, delete |
| `service_incentives` | Mechanic Incentives | view, edit |
| `service_reports` | Service Reports | view |

Takes the system to **33 modules / ~128 permissions**.

### 4.2 Default roles seeded with their permissions

This is the change you asked for: the seed currently creates only ADMIN. It should also create
**ready-made roles that already carry sensible grants**, so an admin can create a user and attach
a role without hand-ticking a permission grid.

Proposed default grants — each row is what that role holds, everything else denied:

| Role | Modules granted |
|---|---|
| `SERVICE_MECHANIC` | `service_jobs` (view, edit) · `service_assembly` (view, create, edit) |
| `SERVICE_SUPERVISOR` | `service_jobs` (all) · `service_assembly` (all) · `service_prices` (view) · `service_reports` (view) |
| `SERVICE_STAFF` | `service_jobs` (view, create, edit) · `service_prices` (view) · `customers` (view, create) |
| `SERVICE_BILLING` | `service_billing` (all) · `service_jobs` (view) · `service_prices` (view) · `customers` (view) |
| `SERVICE_MANAGER` | every service module · `service_reports` · `cost_price` (view) |
| `SERVICE_VIEWER` | `service_jobs` (view) · `service_reports` (view) |

Implementation shape — extend the catalog with a role catalog and seed it the same idempotent
way as modules:

```ts
// prisma/rbac-catalog.ts
export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  /** module key -> actions granted on it */
  grants: Record<string, ActionKey[]>;
}
export const ROLE_CATALOG: RoleSeed[] = [ /* the six above */ ];
```

**Important seeding rule:** default roles are seeded **only on first creation**. Re-running the
seed must not reset grants an admin has since edited — otherwise every deploy silently reverts
their customisations. Only `ADMIN` is force-synced to all permissions, because it must never be
able to lock itself out.

### 4.3 One user ↔ one role

Already satisfied by the current schema — `User.roleId` is a required scalar with a relation to
`Role`, and `Role.users` is the back-reference. That is a one-role-per-user (many-users-per-role)
model, which is what you described.

---

## 5. Route mapping

All authenticated service screens move under `/services`.

| bch-service | bch_management | Module |
|---|---|---|
| `/counter` | `/services/counter` | `service_jobs` |
| `/counter/queue` | `/services/counter/queue` | `service_jobs` |
| `/mechanic` | `/services/mechanic` | `service_jobs` |
| `/supervisor` | `/services/supervisor` | `service_jobs` |
| `/supervisor/assign` | `/services/supervisor/assign` | `service_jobs` |
| `/manager` | `/services/manager` | `service_reports` |
| `/billing` | `/services/billing` | `service_billing` |
| `/assembly` | `/services/assembly` | `service_assembly` |
| `/prices` | `/services/prices` | `service_prices` |
| `/history` | `/services/history` | `service_jobs` |
| `/updates` | `/services/updates` | `service_jobs` |
| `/login` | `/login` (existing) | — |
| `/review/[token]` | `/review/[token]` — **stays public** | — |

`review/[token]` is customer-facing and token-authenticated. It must **not** move under the
dashboard layout or behind a permission check.

API routes move `/api/*` → `/api/services/*`, except `api/seed`, which is dropped — seeding
belongs in `prisma/`, not behind an HTTP endpoint.

### Folder structure after merge

```
src/app/(dashboard)/services/     11 authenticated service screens
src/app/api/services/             32 service API routes
src/components/services/          JobCard, PartsSelector, PhotoUpload,
                                  StatusFilter, CheckoffGate, TeamManager
src/lib/services/                 constants.ts, timezone.ts, whatsapp.ts
```

Not carried over: `lib/prisma.ts`, `lib/auth.ts`, `lib/zoho.ts` — the host app already has all
three. The service `zoho.ts` should be diffed against the inventory one and any genuinely new
calls folded in, rather than kept as a second client.

Dropped components: `BottomNav.tsx`, `InstallPrompt.tsx` — the host app already provides both.

---

## 6. Phases

Ordered by dependency. Sizes are relative effort, not calendar estimates.

| # | Phase | Depends on | Size |
|---|---|---|---|
| 0 | Resolve open questions (§8) | — | small |
| 1 | Merge schema; `db push`; `generate` | 0 | medium |
| 2 | Seed service modules, permissions, default roles | 1 | small |
| 3 | Delete service auth layer; wire NextAuth | 2 | medium ⚠ security |
| 4 | Port 32 API routes onto `requireFeature` + zod + R2 | 3 | large |
| 5 | Port 13 pages under `/services`; restyle to BCH OPS | 4 | large |
| 6 | Migrate data (only if the service DB has records) | 5 | medium |
| 7 | Verify + retire the old deployment | 6 | medium |

### Phase 3 detail — killing the auth layer

- Delete `lib/auth.ts`, `api/auth/login`, `api/auth/logout`, `api/auth/me`, `api/auth/users`.
- If PIN login stays, add a **second NextAuth credentials provider** keyed on `name + PIN`.
  It must resolve the user from the DB and never accept a role claim from the client.
- Replace `getRoleRedirect(role)` — a hardcoded `switch` over role names — with a
  permission-driven landing route: send the user to the first service module they hold `view` on,
  read from the permission store.

### Phase 4 detail — per-route work

Each ported handler:
1. swaps `getSession()` for `requireFeature("service_x", "action")`
2. gains a zod schema in `src/lib/validations.ts`
3. returns via `successResponse` / `errorResponse`
4. if it uploads, moves from `@vercel/blob` to `src/lib/r2.ts`

### Dependency deltas to resolve during the port

| Concern | bch-service | bch_management | Resolution |
|---|---|---|---|
| File storage | `@vercel/blob` | Cloudflare R2 | Rewrite 3 upload routes onto `lib/r2.ts` |
| Validation | none | `zod` | Add schemas for every ported body |
| Auth | unsigned cookie | `next-auth` JWT | Delete the service layer |

---

## 7. Risks

### 7.1 Token number collisions
`TokenCounter` is a single row incremented to mint `BCH-0001`. Under the inventory app's heavier
concurrency, a read-then-write without row locking hands two jobs the same token — and
`tokenNumber` is `@unique`, so the second insert throws in front of a customer at the counter.
Wrap the increment in a transaction with `SELECT … FOR UPDATE` during the port.

### 7.2 Two apps, one database, during cutover
If both run against the same Postgres mid-merge, the service app writes through its forgeable
auth while the inventory app enforces RBAC. Keep them on separate databases until cutover, then
migrate once and retire the old deployment.

### 7.3 Role sprawl
Six service roles on top of the inventory roles gives a long list where most users need one or
two modules. The `SERVICE_*` six exist to preserve today's behaviour; revisit once the merge is
stable.

### 7.4 Scope
This is roughly the size of the RBAC project itself. It should not be interleaved with that work
— both touch the same guards, and a failure becomes ambiguous.

---

## 8. Open questions — needed before phase 1

| # | Question | Why it blocks |
|---|---|---|
| 1 | **Keep the 4-digit PIN login for mechanics?** | Shop-floor staff tap a name + PIN today; inventory uses typed access codes. Keeping PIN means a second NextAuth provider and `pin`/`emoji` columns on `User`. Changing it is a workflow change for every mechanic. |
| 2 | **Does the service database hold live records?** | Decides whether phase 6 exists. There is no `.env` in `bch-service`, so I could not check. |
| 3 | **Dedupe customers on phone?** | Both tables will contain the same people. Phone is the only shared key, and inventory allows it null and duplicated. |
| 4 | **Migrate existing job photos off Vercel Blob?** | Copy to R2, or leave historical URLs on Blob and send only new uploads to R2. |
| 5 | **Fold `AuditLog` into `OpsActivityLog`?** | Recommended, but it reshapes existing service audit rows. |
| 6 | **Does `bch-service` stay deployed after cutover?** | If yes, the forgeable-cookie vulnerability stays live and two apps write to one database under different auth models. Strong recommendation: retire it. |
| 7 | **Are the six default role grants in §4.2 right?** | They are my reading of what each screen allows today. You know the shop; a wrong grant either blocks someone mid-shift or over-exposes pricing. |
| 8 | **Should service roles be able to see inventory modules?** | E.g. should `SERVICE_MANAGER` see stock levels? Currently modelled as service-only. |

