# Storage Implementation Plan

Status: completed — 28 Aug 2026, runtime-switchable storage provider and Settings module
Prepared 28 Aug 2026.

---

## 1. Goal

Make the media backend a **runtime choice**, configured from the UI instead of from `.env`,
with AWS S3 as the intended default and the server filesystem as the fallback when nothing
is configured. Add a Settings module in the sidebar with a Storage sub-module, permission
gated, carrying the AWS setup instructions inline.

## 2. Where we are today

| Fact | Evidence |
|---|---|
| `src/lib/r2.ts` already speaks the S3 protocol | `aws4fetch`, `service: "s3"`, SigV4 |
| Provider is chosen by env vars, synchronously | `isR2Configured()` reads `process.env` |
| Supabase is a hardcoded fallback | `src/lib/media-upload.ts` falls back on HTTP 501 |
| Browser uploads go direct to the bucket | `POST /api/media/presign` → presigned PUT |
| Six route files import the storage lib | see §7 |
| A working `PutBucketCors` call already exists | `scripts/migrate-media-to-r2.js:55-64` |

**Switching to AWS S3 is not a rewrite.** The differences are the endpoint host, a real
region instead of `"auto"`, and who pays for egress.

| | Cloudflare R2 | AWS S3 |
|---|---|---|
| Endpoint | `{account}.r2.cloudflarestorage.com/{bucket}/{key}` | `{bucket}.s3.{region}.amazonaws.com/{key}` |
| Region | `auto` | real, e.g. `ap-south-1` |
| Egress | free | billed per GB |
| New npm packages | — | **none**, `aws4fetch` covers it |

> The comment at `src/lib/r2.ts:1-2` says media lives on R2 *because* egress is free —
> "every WhatsApp share / list view downloads files for free". On S3 each of those views is
> a billed GB. If the move is for consolidation rather than cost, put CloudFront in front of
> the bucket. The provider abstraction below makes that switchable rather than permanent.

## 3. Target architecture

```
                    ┌─────────────────────────┐
  browser  ───────► │ POST /api/media/presign │  auth + path allowlist + type/size
                    └───────────┬─────────────┘
                                │ asks
                    ┌───────────▼─────────────┐
                    │  src/lib/storage/index  │  reads StorageConfig from DB (cached)
                    └───────────┬─────────────┘
                                │ picks one
        ┌──────────┬────────────┼────────────┬──────────────┐
     s3.ts       r2.ts    supabase.ts    local.ts      (future)
    default     legacy      legacy       fallback
```

One interface, four implementations:

```ts
interface StorageProvider {
  presignPut(key, contentType, expiresSeconds): Promise<string | null>;
  put(key, body, contentType): Promise<string>;   // server-side upload
  delete(key): Promise<void>;
  publicUrl(key): string;
  keyFromUrl(url): string | null;                 // refuses foreign URLs
}
```

`presignPut` returns `null` for providers that cannot hand the browser a direct URL (the
local filesystem). The client then posts the file through the API instead. That is the one
behavioural branch the UI has to know about.

### Provider selection order

1. `StorageConfig.provider` from the database, when `isConnected` is true.
2. `S3_*` / `R2_*` environment variables, if no row exists yet (bootstrap).
3. **Local filesystem** — always resolvable, never absent.

Rule: **the resolver never throws.** A missing or broken config degrades to the fallback and
logs `log.error`; it does not 500 an upload.

## 4. The local filesystem provider

- Files land under `STORAGE_LOCAL_DIR` (default `./.storage`), keyed exactly like an object
  key (`vendor-issues/2026/abc.webp`), so a later move to S3 is a file copy with no key
  rewriting.
- Served back through a new route `GET /api/media/[...key]` which resolves the key against
  the storage root, **refuses any path escaping it**, and streams with the same one-year
  immutable cache header the buckets use.
- `presignPut` returns `null`, so the browser posts to `/api/upload`. The 100 MB cap now
  genuinely matters, because the file passes through the serverless function.

> ### ⚠️ Blocking constraint — read before approving
> `vercel.json` exists and pins `regions: ["bom1"]`, so this app deploys on **Vercel**,
> where the filesystem is **read-only apart from `/tmp`, and `/tmp` is wiped between
> invocations**. A local-filesystem provider **cannot persist anything on Vercel** — an
> uploaded photo would vanish before anyone could view it.
>
> It works correctly on a VPS, a Docker container with a mounted volume, or any long-lived
> Node process. There is an empty `Dockerfile` in the repo root, which may mean a container
> move is planned.
>
> **This needs an answer before the local provider is built.** If the app stays on Vercel,
> the honest fallback is "no provider configured → uploads disabled with a message pointing
> at Settings → Storage", not a filesystem that silently loses files.

## 5. Data model

```prisma
model StorageConfig {
  id              String    @id @default("singleton")
  provider        String    @default("LOCAL")   // LOCAL | S3 | R2 | SUPABASE
  bucket          String?
  region          String?
  accountId       String?                        // R2 only
  accessKeyId     String?
  secretAccessKey String?                        // plaintext, matching ZohoConfig precedent
  publicBaseUrl   String?                        // CloudFront / custom domain
  localDir        String?
  isConnected     Boolean   @default(false)
  lastTestedAt    DateTime?
  lastTestError   String?
  updatedAt       DateTime  @updatedAt
  @@map("storage_config")
}
```

Singleton row, same shape as `ZohoConfig`. Secrets are plaintext **by explicit decision**,
consistent with `ZohoConfig.clientSecret` today: anyone with database read access has the
AWS keys. That is accepted, not overlooked.

## 6. Sidebar module tree and permissions

```
Admin
 └ Settings                    settings            /settings
    ├ Storage                  settings_storage    /settings/storage
    └ Integrations             zoho (re-parented)  /settings/integrations
```

- `settings` keeps its key, gains `route: "/settings"` and a real hub page.
- `settings_storage` is new. Actions: `view`, `edit`, **`approve`**. `approve` is the
  authority to *switch the live provider* — repointing all company media is a bigger
  decision than fixing a typo in a bucket name, and this codebase expresses that as a
  permission rather than a role name.
- `zoho` is **re-parented, not recreated.** `prisma/seed-rbac.ts:74-128` upserts `route`,
  `group`, `sortOrder` and `parentId` in both `create` and `update`, so a re-seed moves it.
  Existing role grants survive because permissions key off the module *key*.
- A child's `group` must equal its parent's (`"Admin"`) — the seeder asserts this.

## 7. File-by-file

### New

| File | Purpose |
|---|---|
| `src/lib/storage/types.ts` | the interface above |
| `src/lib/storage/s3.ts` | AWS endpoint + real region |
| `src/lib/storage/r2.ts` | moved from `src/lib/r2.ts` |
| `src/lib/storage/supabase.ts` | wraps the existing client |
| `src/lib/storage/local.ts` | filesystem provider |
| `src/lib/storage/cors.ts` | `PutBucketCors`, lifted from the migration script |
| `src/lib/storage/index.ts` | resolver + cache + env bootstrap |
| `src/app/api/media/[...key]/route.ts` | serves local files |
| `src/app/api/settings/storage/route.ts` | GET/PUT, secret masked on read |
| `src/app/api/settings/storage/test/route.ts` | put → get → delete round trip |
| `src/app/api/settings/storage/activate/route.ts` | switch provider (`approve`) |
| `src/app/(dashboard)/settings/page.tsx` | hub page |
| `src/app/(dashboard)/settings/storage/page.tsx` | provider cards |
| `.../settings/storage/_components/setup-guide.tsx` | AWS instructions + Apply CORS |

### Modified

| File | Change |
|---|---|
| `prisma/schema.prisma` | add `StorageConfig` |
| `prisma/rbac-catalog.ts` | settings tree, `settings_storage`, re-parent `zoho` |
| `src/app/api/media/presign/route.ts` | async resolver; handle `presignPut → null` |
| `src/app/api/upload/route.ts` | async; drop the inline Supabase client |
| `src/app/api/services/upload/route.ts` | async |
| `src/app/api/services/upload/delete/route.ts` | async |
| `src/app/api/services/assembly/route.ts` | async |
| `src/app/api/services/assembly/upload/route.ts` | async |
| `src/lib/media-upload.ts` | provider-driven, not HTTP-501-driven |
| `src/lib/media-compress.ts:1` | comment still says "upload to Supabase Storage" |
| `src/app/(dashboard)/more/app-logic/page.tsx:425` | doc text references `/more/zoho` |
| `scripts/migrate-media-to-r2.js` | import the shared `cors.ts` |

### Moved

`more/zoho/page.tsx` → `settings/integrations/page.tsx`,
`more/zoho/pull-review/` → `settings/integrations/pull-review/`.
Four internal links follow (`page.tsx:673`, `:707`, `pull-review/page.tsx:220`).

**The one breaking ripple:** `isR2Configured()` is synchronous and env-based. It becomes an
async database read, so all six route files above must `await`. That is why this is a plan
and not a patch.

## 8. The setup guide UI

A collapsible panel inside `/settings/storage`, with copy buttons:

1. Create the bucket — the region matters, it goes in the endpoint.
2. IAM user with a least-privilege policy: `s3:PutObject`, `s3:GetObject`,
   `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`, plus `s3:PutBucketCors` only if the
   automatic CORS button should work.
3. **CORS** — the step that silently breaks browser uploads when skipped. Preflight must
   allow `PUT` from the app origin with `Content-Type` and `Cache-Control` in
   `AllowedHeaders`. Offer **Apply CORS automatically**: `scripts/migrate-media-to-r2.js:55-64`
   already does this via `PUT {bucket}?cors`, and the identical call works on S3. Narrow
   `AllowedOrigin` to the app origin — the existing script uses `*`, acceptable behind R2's
   custom domain but too loose for S3.
4. Public read: bucket policy, or CloudFront in front — this fills `publicBaseUrl`.
5. Paste keys → **Test connection** → **Make active**.

## 9. Rollout

1. `npm run db:push` — **stop the dev server first**; `prisma generate` throws `EPERM`
   while it holds the query engine.
2. `npm run db:seed:rbac` — creates `settings_storage`, moves `zoho`.
3. Grant `settings_storage` to the admin role at `/team/permissions`. It ships
   **unassigned**, the same way Staff LMS did.
4. `npm run build`.
5. Configure S3 in the UI → Test → Make active. Upload a photo on `/vendor-issues/new`
   and confirm it renders.

No data migration: this is a fresh S3 bucket, per the decision that there is nothing to
carry over. Stored URLs are absolute, so anything that does exist keeps resolving from
wherever it was written.

## 10. Open questions

1. **Where does this deploy?** Vercel or a container/VPS? Decides whether the local
   filesystem provider is real or a footgun (§4).
2. If it stays on Vercel, should "no config" mean *uploads disabled with a clear message*
   rather than a filesystem that loses files?
3. CloudFront in front of S3, or a public bucket policy?
4. Which region — `ap-south-1` (Mumbai), to match the current `bom1`?
