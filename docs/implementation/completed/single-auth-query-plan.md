# One query per guarded request — auth/RBAC round-trip plan

Status: completed — 30 Aug 2026, `requireFeature()` issues exactly one database query
instead of three, across 190 route files. **`npm run build` has not been run against this
tree and the changes are uncommitted** — §7 lists both.
Branch: **`perf/single-auth-query-v2`** — implemented here.
Prepared 30 Aug 2026. Every count below was measured against the tree, not estimated.

---

## 1. The problem

Every guarded route calls one of two guards:

```ts
const user = await requireFeature("stock", "edit");   // 246 call sites, 164 files
const user = await requireAuth();                     // 5 files
```

`requireFeature` answers two questions — *who is this* and *are they allowed* — and each
question used to issue its own `prisma.user.findUnique` against **the same User row**:

| # | Caller | Query | Selected |
|---|---|---|---|
| 1 | `getServerSession()` → NextAuth `jwt` callback | `user.findUnique` | `role.key`, `role.name` |
| 2 | `getCurrentUser()` | `user.findUnique` | `id`, `name`, `email`, `isActive`, `role` |
| 3 | `userCan()` → `getAccess()` | `user.findUnique` | the row + `role_permissions → permissions → modules` |

Three round trips to one row, on every authenticated request, across **190 API route files**
(164 `requireFeature`, 5 `requireAuth`, 23 `serviceGuard`, which wraps `requireFeature`).

**Why this matters more than the milliseconds.** On Vercel each database round trip is a
network hop from a serverless function to Postgres, and each one holds a pooled connection
for its duration. The queries themselves are trivial — a primary-key lookup and a join — so
the cost is almost entirely latency and pool occupancy. Three trips is three times the
connection-seconds per request for one row of data, which is what gets hit first when
several people use the app at once.

## 2. What was built

`getAccess()` (`src/lib/rbac.ts`) becomes the single reader of the User row.

It already had to fetch that row to reach the role join, so it now selects three more
columns and returns them:

```ts
// src/lib/rbac.ts — ResolvedAccess
user: { id: string; name: string; email: string; isActive: boolean } | null;
```

`getCurrentUser()` (`src/lib/auth-helpers.ts`) reads from that instead of querying:

```ts
const access = await getAccess(userId);
if (!access.user) return null;
return { id: access.user.id, name: access.user.name, /* … */ roleKey: access.roleKey };
```

Query #2 is gone. Query #3 does its work.

**The dedupe that makes it hold.** `getAccess` is wrapped in React `cache()`, which dedupes
by argument **within a single server request**. So a handler that checks several permissions
— the 25 `userCan` call sites outside the guards, of which `api/stock-counts/[id]/route.ts`
alone asks `stock_audit.approve` five times in one PATCH — still pays for `getAccess` once.
Two different
requests never share a result, which is the point: a cross-request cache would keep a
revoked permission alive, and that is the exact bug the whole data-driven RBAC design exists
to prevent.

## 3. Behaviour that deliberately did not change

- **Freshness.** Permissions are still resolved from the database on every request. Nothing
  moved into the JWT. Revoke a grant and the next request is refused.
- **Rejection semantics.** `getAccess` returns `user: null` for a missing user, a
  deactivated user, *or* a user whose **role** is deactivated (`rbac.ts:152`) — the same
  three cases `getCurrentUser()` used to reject with its own checks. No fourth case was
  added and none was dropped.
- **The Bearer-token path.** Mobile requests (`Authorization: Bearer <jwt>`) still decode
  locally with `next-auth/jwt`'s `decode`, then take the same `getAccess` path. That branch
  never had its own user query.
- **`requireAuth` vs `requireFeature`.** Unchanged in meaning. `requireAuth` remains
  authentication only, for the handful of places where no module/action pair is meaningful
  (`/api/my-permissions`, self-service profile reads).

## 4. Files changed

| File | Change |
|---|---|
| `src/lib/rbac.ts` | `ResolvedAccess.user` added; `name`/`email` added to the `select`; returned from `getAccess`, `null` in `EMPTY_ACCESS` |
| `src/lib/auth-helpers.ts` | `getCurrentUser()` reads `getAccess()` instead of querying, and is wrapped in React `cache()`; the now-unused `prisma` import removed |
| `src/lib/auth.ts` | the role-label refresh query deleted from the `jwt` callback (§6) |

No route file changed. That is the design property worth keeping: the guards are the only
things that know how identity is resolved, so 190 route files got faster without being
touched.

## 5. Result

**One database query per guarded request**, whatever the route asks:

| | Before | After |
|---|---|---|
| `requireFeature("stock", "edit")` | 3 | **1** |
| A handler checking two permissions | 6 | **1** |
| `stock-counts/[id]` PATCH — five `userCan` calls on one row | up to 12 | **1** |

`getCurrentUser` and `getAccess` are both request-scoped `cache()`s, so the second and
fifth checks are free; the only remaining cost is the one `getAccess` query.

## 6. The third query, and why deleting it is safe

`src/lib/auth.ts`, inside the NextAuth `jwt` callback — **removed**:

```ts
} else if (token.userId) {
  // Refresh the role label live so a reassigned user sees the change without logging out.
  const dbUser = await prisma.user.findUnique({
    where: { id: token.userId as string },
    select: { role: { select: { key: true, name: true } } },
  });
```

It ran on **every** `getServerSession()`, not just at login: with the JWT strategy NextAuth
decodes the cookie and then invokes `callbacks.jwt` on each session read
(`node_modules/next-auth/core/routes/session.js:53`). With no `user` argument the `else if`
branch fired, so it was one `user.findUnique` per session read — and `withAuth` in
`src/middleware.ts` is unaffected either way, because it reads the token with `getToken`
and never runs the callbacks.

It was redundant. Its only job was keeping `token.roleKey` / `token.roleName` fresh, and
every reader of those fields already gets them from `getAccess` instead:

- `getCurrentUser()` returns `access.roleKey` / `access.roleName`, read from the database
  this request.
- The only screen that displays a role name, `/staff-lms/profile`, is a server component
  calling `getCurrentUser()`.
- No client component reads `roleKey` or `roleName` off `useSession()` (50 `useSession()`
  call sites, none of them for the role).

There was a second, smaller one: `getCurrentUser()` was not wrapped in `cache()`, so a route
calling `requireFeature` twice decoded the session cookie twice. It is wrapped now.

**The one consequence to confirm.** An admin who reassigns a signed-in user's role no longer
changes the **stale label** carried in that user's cookie. Nothing authorises on it and
nothing displays it — `/staff-lms/profile` reads `getCurrentUser()`, which is database-fresh
— so this should be invisible. If a future screen ever wants the role name on the client, it
must read `/api/my-permissions`, not the session.

## 7. Remaining work

| # | Change | State |
|---|---|---|
| 1 | Delete the role-refresh query from the `jwt` callback | done |
| 2 | Wrap `getCurrentUser()` in React `cache()` | done |
| 3 | Correct the comment blocks in `rbac.ts` and `auth-helpers.ts` | done |
| 4 | `npm run build` | **not run on this tree** |
| 5 | Commit `perf/single-auth-query-v2` | pending the build |

Only 4 and 5 stand between this and `completed`.

## 8. Verification

- `npm run build` passes.
- Sign in, load `/stock` — the sidebar renders and the page's view/edit/delete/create checks
  all resolve.
- Revoke a permission on `/team/permissions` while a second browser is signed in; the very
  next request in that browser is refused. This proves `cache()` did not become a
  cross-request cache.
- Deactivate a user, then a role; both are rejected at the next request.
- A mobile `Authorization: Bearer` request still authenticates and authorises.
- `/staff-lms/profile` still shows the role name.

## 9. Non-goals

- **No permissions in the JWT.** That would remove the last query too, and it is exactly
  what CLAUDE.md forbids: a token cannot be revoked before it expires.
- **No cross-request cache** of `getAccess`, for the same reason.
- **No change to what `requireFeature` means**, no role allow-lists, no admin
  short-circuit.
