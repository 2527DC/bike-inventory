# Zoho / Zakya in Postman

Files:

| File | What it is |
|---|---|
| `zoho-integration.postman_collection.json` | 27 requests covering all 19 endpoints in the registry |
| `zoho-books.postman_environment.json` | Zoho Books credentials + `apiBase` |
| `zakya-pos.postman_environment.json` | Zakya POS |
| `zoho-inventory.postman_environment.json` | Zoho Inventory |

Regenerate after changing `src/lib/integrations/endpoints.ts`:

```
node scripts/gen-zoho-postman.js
```

The collection is generated from the registry on purpose — the same reason
`docs/integrations-endpoints.md` is. A hand-edited collection drifts from the code within a
month; edit `scripts/gen-zoho-postman.js` instead.

---

## Setup

### 1. Create the Zoho client — on the India data centre

<https://api-console.zoho.in> — note the **`.in`**. A client created on `api-console.zoho.com`
produces `invalid_client` on every call no matter how correct the id and secret look, and the
error message never mentions the data centre. This is the single most common way to lose an
hour here.

Two ways to get a grant token:

**Self Client** (faster, no redirect URI). Create a Self Client, open **Generate Code**, paste
the scope, pick a duration, and it gives you the code directly. Then skip to step 3.

**Server-based Application.** Set the redirect URI to exactly what is in the environment's
`redirectUri` (`http://localhost:3000/api/integrations/callback`) — an extra trailing slash is
a mismatch. Then use request `00 OAuth › 1`.

### 2. Import and select an environment

Import the collection and all three environments. **Select one in the top-right picker** —
nothing works until you do, because `{{apiBase}}` is only defined in the environments.

Fill in `clientId` and `clientSecret`.

### 3. Get a refresh token

Run `00 OAuth › 2 · Exchange grant token → refresh token` with the code in `grantToken`.

The grant token lives about **3 minutes and works once**. If you see
`{"error":"invalid_code"}` at HTTP 200, it expired — generate another.

The response's `refresh_token` is the durable one. It is saved to the environment
automatically, and it is what goes into `IntegrationConfig.refreshToken` for that provider.

### 4. Get the organization id

Run `01 Organization › Organizations (documented v3 path)`. It saves `organizationId` for you.

Every API call appends `organization_id` (`base.ts:266`), and **Zoho answers a wrong one with
an empty list rather than an error** — which reads exactly like "there is no data".

From here every request authenticates itself.

---

## Scopes

Set `scope` on the authorize request to match the provider:

| Provider | Scope |
|---|---|
| Zoho Books | `ZohoBooks.fullaccess.all` |
| Zoho Inventory | `ZohoInventory.fullaccess.all` |
| Zakya POS | `ZakyaAPI.fullaccess.all` |

Read-only, if you only want to look:

```
ZohoBooks.bills.READ,ZohoBooks.invoices.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ
```

The app already lives with a consequence of narrow scoping: the Inventory token has no bills
scope, so bills are pulled through Books instead
(`src/app/api/zoho/trigger-pull/route.ts:373`).

---

## How the auth works

Collection auth sends `Authorization: Zoho-oauthtoken {{accessToken}}` on every request.
Zoho's scheme is **not** `Bearer` — sending `Bearer` gets a 401 that looks like an expired
token.

A collection pre-request script refreshes the access token whenever it is missing or within
two minutes of expiring. It mirrors `IntegrationClient.refreshAccessToken`, including the part
that catches everyone:

> **Zoho rejects a refresh with HTTP 200 and `{"error": "..."}` in the body.**
> `res.ok` is `true`. This is why `base.ts:212` checks `data.error` rather than the status,
> and why the Postman script does the same.

You never paste a token anywhere. Open the console (`Ctrl+Alt+C`) to watch it happen.

---

## Reading the console

Every response is checked against the TypeScript interfaces in `src/lib/integrations/base.ts`
and reported:

| Line | Meaning |
|---|---|
| `[shape] first row has N fields: ...` | everything Zoho actually sent |
| `[ok] every field base.ts requires ... is present` | the import will work |
| `[BREAKS APP] missing required fields: ...` | those become `undefined` in the importer |
| `[unused] Zoho also sends N fields the app ignores` | **data you already receive and discard** |
| `[page] {"has_more_page":true}` | `listAll*` will fetch another page |
| `[rate] remaining: N` | how close you are to a 429 |

`[unused]` is the line to read when deciding what to store next. It is the difference between
"we would need to ask Zoho for that" and "we have been throwing it away".

The field lists come from `IntegrationItem`, `IntegrationBill`, `IntegrationInvoice` and
`IntegrationCustomerPayment`. Required means non-optional in TypeScript.

---

## Three things worth running first

**`03 Bills › Get bill (with line items)`** — the list response has no tax breakdown, and
`VendorBill` stores a single `amount`. This shows where `tax_percentage`, `hsn_or_sac`,
`tax_total` and `sub_total` actually live, which is what a per-line ITC schema would need.

**`01 Organization › Organizations (the path the app actually builds)`** — `BooksClient.getOrganizations`
passes `"/../organizations"`, which normalises to `.../books/organizations`, dropping `v3`.
Compare its status against the documented path above it. Both 200 means the `..` is fine; a
404 here against a 200 there means the setup call is broken and the Settings org lookup fails
silently.

**`02 Items › List items`** — the biggest `[unused]` list, and the quickest read on how much
of the catalog you are already receiving.

---

## Gotchas, collected

| Symptom | Cause |
|---|---|
| `invalid_client`, credentials look right | Client created on `.com`, not `.in` |
| `invalid_code` at HTTP 200 | Grant token expired (~3 min) or already used |
| No `refresh_token` in the exchange response | Missing `access_type=offline`, or a repeat authorize without `prompt=consent` |
| No `refresh_token` on a *refresh* | Normal — a refresh returns only a new access token |
| Empty list, no error | Wrong or missing `organization_id` |
| `last_modified_time` ignored | The `+` in `+0530` was not encoded as `%2B` (`base.ts:436`) |
| `Unexpected token '<'` | HTML error page, not JSON — what `readJson` exists to name |
| 401 on a call that worked a minute ago | Access token expired; the pre-request script handles it |
| 429 | Per-org, per-minute. `apiCall` honours `Retry-After`, else backs off 5/10/20s, 3 tries |

---

## Safety

The credentials are live. **Every POST and PUT in this collection writes to your real Zoho
organization** — each one says so in its description. The GETs are safe to run freely.

`00 OAuth › 4 · Revoke refresh token` breaks the integration for that provider until you redo
the exchange and update `IntegrationConfig`. It is there to demonstrate the app's
`401 → refresh → reconnect` path, not for routine use.

Secrets live in the environment files, which store `clientSecret`, `refreshToken`,
`accessToken` and `grantToken` as Postman **secret** type. The committed files have those
values empty. Keep them that way — do not commit a filled-in environment.
