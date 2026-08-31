# Browser uploads to S3 die at the CORS preflight

Status: completed — code written and in the tree on `perf/single-auth-query-v2`, 30 Aug 2026.
**`npm run build` and the browser pass in §8 have NOT been run yet** — see §8 before trusting
this in production.
Branch: **`perf/single-auth-query-v2`** — implemented here alongside the auth work, at the
user's request, rather than on a branch of its own.
Prepared 30 Aug 2026 from a live failure on `https://bike-inventory-delta.vercel.app`.

---

## 1. The symptom

Uploading photos on `/second-hand/new`, in production:

```
Access to fetch at 'https://bch1-bucket.s3.ap-south-1.amazonaws.com/second-hand/
sh-1788109705132/0.webp?X-Amz-Expires=600&...' from origin
'https://bike-inventory-delta.vercel.app' has been blocked by CORS policy:
Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.

PUT https://bch1-bucket.s3.ap-south-1.amazonaws.com/... net::ERR_FAILED
```

## 2. Diagnosis

The presigned URL was valid — S3 would have accepted the PUT. **The request never left the
browser.** `bch1-bucket` carried no CORS rule permitting `https://bike-inventory-delta.vercel.app`,
so the `OPTIONS` preflight came back without `Access-Control-Allow-Origin` and Chrome
cancelled the PUT.

The preflight happens at all because `src/lib/media-upload.ts` sends `Content-Type:
image/webp` and `Cache-Control` — neither is a CORS-safelisted header. That is correct and
must stay; the bucket simply has to allow them.

### Three faults, not one

1. **The bucket was misconfigured.** Fixable only in AWS, and the app already had an
   **Apply CORS** button for it — which nobody knew to press, because…
2. **…the storage self-test could not see the problem.** Every step of "Test connection"
   ran **server-side** with IAM credentials (`self-test.ts` → `store.put`/`exists`/`delete`).
   A server-side PUT has no origin and never triggers a preflight, so the test passed
   green on a bucket where no browser upload could ever succeed. The screen offered a test
   that structurally could not fail for this cause.
3. **`applyCors` was destructive.** It wrote ONE rule with ONE origin, replacing whatever
   was there. Pressing it from localhost silently revoked production's access, and pressing
   it from production revoked localhost's. Whoever clicked last won, and the loser failed
   with the same unreadable network error.

And underneath all three: a bucket-side misconfiguration took the whole feature down, with
no path that still worked.

## 3. Part A — uploads survive a missing CORS rule

`src/lib/media-upload.ts`

The presigned PUT is wrapped in try/catch, because **`fetch()` rejects rather than resolving
when a preflight is refused** — there is no status to read, which is exactly why the old
code's `res.status || "network error"` message never fired. On any failure the blob is
POSTed to `/api/upload`, which uploads server-side: no origin, no preflight, no CORS.

The size cap is what makes taking that fallback silently defensible:

```ts
const DIRECT_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;
```

A serverless request body is capped at 4.5 MB. Compressed second-hand photos are 30–150 KB
(`compressImageFull({ maxEdge: 800 })` → webp), so the flow that hit this wall is well
inside it. **Videos are not**, and they keep the original failure with a message saying the
file must go straight to the bucket. Every fallback logs `log.warn` with the key, byte count
and cause, so this never becomes invisible.

`/api/upload` needed no change: it already accepts a caller-supplied key and validates it
through the same `checkUpload` policy as the presign route.

## 4. Part B — `applyCors` merges instead of replacing

`src/lib/storage/s3.ts`, `src/app/api/settings/storage/cors/route.ts`

- New `readCorsOrigins()` returns the bucket's current origins. **`null` and `[]` are
  different answers**: `[]` means S3 answered and nothing is allowed (a fresh bucket, HTTP
  404 `NoSuchCORSConfiguration`), `null` means we lack `s3:GetBucketCors` and know nothing.
  Reporting "no CORS configured" for the second case would send someone to fix a bucket that
  may be fine.
- `applyCors(origins: string[])` writes the **union** of what the bucket already allows and
  what it is given, and returns the result.
- The route now sends three origins at once — the request's own `Origin` header,
  `NEXTAUTH_URL`, and `http://localhost:3000` — so one press covers production and
  development regardless of where it was pressed.

## 5. Part C — the self-test can now see it

`src/lib/storage/self-test.ts`, `.../storage/test/route.ts`, `.../storage/activate/route.ts`

`runStorageTest` takes the browser's origin (`req.headers.get("origin")`) and, for S3, adds
a **Browser uploads (CORS)** step reporting whether that exact origin is in the bucket
policy.

It **deliberately does not affect `result.ok`**. A missing rule no longer makes the provider
unusable — Part A routes around it — so failing the whole test would refuse activation for a
bucket that works. It is reported as its own step because the difference it makes is real:
direct-to-bucket versus every photo passing through a serverless function.

## 6. Files

| File | Change |
|---|---|
| `src/lib/media-upload.ts` | try/catch around the presigned PUT; size-capped fallback to `/api/upload`; `putThroughApi` extracted; logger added |
| `src/lib/storage/s3.ts` | `readCorsOrigins()` added; `applyCors` takes `string[]`, merges, returns the union |
| `src/app/api/settings/storage/cors/route.ts` | sends request origin + `NEXTAUTH_URL` + localhost; response `origin` → `origins` |
| `src/lib/storage/self-test.ts` | optional `browserOrigin` parameter; the CORS step |
| `src/app/api/settings/storage/test/route.ts` | passes the `Origin` header |
| `src/app/api/settings/storage/activate/route.ts` | passes the `Origin` header |
| `src/app/(dashboard)/settings/storage/page.tsx` | response type `{ origin }` → `{ origins }` |

## 7. What this does NOT do

- **It does not configure the bucket.** Only an AWS action can, and pressing **Apply CORS**
  is still the right thing to do: direct-to-bucket uploads are faster and do not spend
  function bandwidth. Part A is a safety net, not the intended path.
- It does not change the presign route, the upload policy, or the key format.
- It does not raise the 4.5 MB body limit; large video uploads still require working CORS.

## 8. Verification — OUTSTANDING

- [ ] `npm run build` passes.
- [ ] Upload a photo on `/second-hand/new` in production **before** touching AWS: it should
      succeed via the fallback, and the browser console should carry the `log.warn` naming
      the CORS cause.
- [ ] Settings → Storage → Test connection: the **Browser uploads (CORS)** step should
      report that the origin is NOT allowed.
- [ ] Press **Apply CORS**, then re-test: the step passes, and a new upload goes straight to
      the bucket with no warning logged.
- [ ] Press **Apply CORS** from localhost afterwards and confirm the production origin is
      still in the bucket policy — this is the regression Part B exists to prevent.
- [ ] Confirm a >4 MB video upload still fails loudly rather than silently truncating.

## 9. Board of Agents

- **Integration architect** — Supabase/S3 storage boundary; the fallback moves bytes through
  a function that previously never carried them, which is a bandwidth and duration change on
  `/api/upload` (`maxDuration = 60`).
