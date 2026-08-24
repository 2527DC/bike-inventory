# BCH Management

Operations software for Bharath Cycle Hub — inventory, accounts, and the service workshop in
one application, behind one login, with access controlled by a database-driven permission
system.

The UI is branded **BCH OPS**.

---

## What's in it

| Area | Covers |
|---|---|
| **Stock** | Products, serials, stock levels across four locations, audits, transfers |
| **Inbound** | Shipments, receiving, putaway |
| **Outward** | Deliveries, dispatch, pre-bookings |
| **Purchase** | Vendors, purchase orders, brand stock uploads, reorder + AI insights |
| **Accounts** | Vendor bills, payments, expenses, receivables, bank statements, POS settlement |
| **Service** | Workshop job cards, mechanic assignment, assembly log, billing, customer reviews |
| **Admin** | Team, roles and permissions, Zoho/Zakya sync, WhatsApp templates, app settings |

`/services/*` is the workshop app, merged in from the former standalone `bch-service`.

---

## Stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Prisma 6** + **PostgreSQL**
- **NextAuth v4** — credentials provider, stateless JWT sessions
- **Zustand** — client-side permission store
- **Tailwind CSS v4**
- **Cloudflare R2** — media storage (single provider; the workshop's former Vercel Blob usage was migrated)
- **Capacitor** — Android wrapper

---

## Getting started

### 1. Environment

Create `.env` in the project root:

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/bch"
DIRECT_URL="postgresql://user:pass@localhost:5432/bch"

# NextAuth — REQUIRED. Without it every login fails with NO_SECRET.
NEXTAUTH_SECRET="<32 random bytes, base64>"
NEXTAUTH_URL="http://localhost:3000"

# Media storage (optional in dev; uploads return 503 without it)
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET=""
R2_PUBLIC_BASE_URL=""
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`NEXTAUTH_URL` must match the origin you actually browse. If you open the LAN address
(`http://192.168.x.x:3000`) while this says `localhost`, next-auth throws
`CLIENT_FETCH_ERROR` on `/api/auth/session`.

### 2. Install and set up the database

```bash
npm install
npm run db:push        # create tables
npm run db:seed:rbac   # modules, permissions, roles, and the admin user
```

### 3. Run

```bash
npm run dev
```

Sign in at http://localhost:3000/login with the seeded admin access code:

```
ADMIN123
```

Override the seeded admin with `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_ACCESS_CODE`.
**Change the access code before any real use** — it is the login credential.

---

## Access control

Permissions are **data, not code**. Nothing about who-can-do-what lives in a source file, so
access changes take effect on the next request with no redeploy.

### The model

```
Module  1───*  Permission  *───*  Role  1───*  User
                      └── RolePermission ──┘
```

- **Module** — a functional area (`stock`, `service_jobs`, `bills`)
- **Permission** — one action on one module (`stock.edit`), from
  `view · create · edit · delete · approve · fetch`
- **Role** — holds any number of permissions
- **User** — holds exactly **one** role

A `RolePermission` row's *existence* is the grant. Revoking is a delete, so the table never
stores "false" noise.

Seeded: **33 modules · 124 permissions · 7 roles** (`ADMIN` plus six `SERVICE_*`).

### How a request is authorised

1. `POST /api/stock` arrives with the session cookie
2. `requireFeature("stock", "create")` runs
3. The cookie is decrypted → `userId`
4. The user is **re-read from the database** — catches a deactivated account immediately
5. Their role's grants are resolved in one query and memoised for that request only
6. Grant present → proceed. Absent → `403`

There is **no admin short-circuit**. `ADMIN` passes because it was granted all 124
permissions, not because code names it. Revoke one and the admin is refused too.

### Sessions

`session: { strategy: "jwt" }` — there is **no session table**. The session is an encrypted,
httpOnly cookie holding only `userId`, `roleKey` and `roleName`.

**Permissions are deliberately not in the token.** A JWT can't be revoked before it expires,
so baking permissions in would mean a revoked grant stayed live for up to 30 days. Identity
rides on the token; authorisation is read from the database every request.

### On the client

The Zustand store (`src/stores/permissions.ts`) fetches `/api/my-permissions` once after
login and holds the permission map plus the granted module list. The sidebar renders from it.

Client checks are **cosmetic** — they hide buttons that would fail. The API re-checks
everything.

---

## Adding a module

1. Add an entry to `MODULE_CATALOG` in `prisma/rbac-catalog.ts` (key, label, icon, route,
   group, actions).
2. `npm run db:seed:rbac` — idempotent; it syncs the catalog and prunes removed entries.
3. Guard your routes with `requireFeature("<key>", "<action>")`.
4. Grant it to a role in **Team → Roles & Permissions**.

The sidebar needs no code change — it renders whatever modules the user can `view`. A module
with `route: null` is permission-only and shows no nav entry.

---

## Project layout

```
prisma/
  schema.prisma        inventory + service models, RBAC tables
  rbac-catalog.ts      SEED INPUT ONLY — never imported by the app
  seed-rbac.ts         modules, permissions, roles, admin user
  rbac-migration.sql   backfill for a database that already has users

src/
  app/(dashboard)/     the main app
  app/(dashboard)/services/   workshop screens
  app/desktop/         wide-screen shell
  app/review/[token]/  PUBLIC customer review page — no login
  app/api/             161 inventory routes
  app/api/services/    33 workshop routes
  lib/rbac.ts          permission resolver — the authorisation primitive
  lib/auth-helpers.ts  requireAuth / requireFeature
  lib/services/        workshop constants, timezone, whatsapp, guard
  stores/permissions.ts
```

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build |
| `npm run lint` | ESLint |
| `npm run db:push` | Sync schema to the database |
| `npm run db:seed:rbac` | Seed modules, permissions, roles, admin |
| `npm run db:seed` | RBAC seed + sample catalogue data |
| `npm run db:studio` | Prisma Studio |

---

## Troubleshooting

**`NO_SECRET` / `/api/auth/error?error=Configuration` after login**
`NEXTAUTH_SECRET` is missing. Add it and restart — `.env` is read only at startup.

**`CLIENT_FETCH_ERROR` on `/api/auth/session`**
Usually `NEXTAUTH_URL` not matching the origin you're browsing. Also fires harmlessly if the
route is still compiling right after a restart.

**`Turbopack is not supported on this platform`**
The native SWC binary failed to load and Next fell back to WASM, which Turbopack can't use.
Nearly always a truncated download from an interrupted install:

```bash
rm -rf node_modules/@next/swc-win32-x64-msvc && npm install
```

A healthy binary is ~130 MB. Compare with
`npm view @next/swc-win32-x64-msvc@<version> dist.unpackedSize`. The same failure mode can
strip a package's `types/` directory, producing a bogus "could not find a declaration file"
error — the fix is the same.

**`EPERM: operation not permitted, rename … query_engine-windows.dll.node`**
`prisma generate` can't replace the query engine while the dev server holds it. Stop the dev
server, generate, restart.

**Sidebar missing modules you just seeded**
The permission store fetches once per session. Hard-refresh or sign out and back in.

---

## Notes

- **Roles are rows, not an enum.** Never compare role names in code — check a permission.
- `prisma/rbac-catalog.ts` is seed input. Importing it at runtime would put permissions back
  in a file and defeat the design.
- `/review/[token]` and `/fill/[token]` are **public by design** — customers have no account.
  Do not add permission checks to them.
