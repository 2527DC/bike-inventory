// Generates docs/postman/zoho-integration.postman_collection.json + 3 environments.
// Source of truth: src/lib/integrations/{endpoints,base,books,zakya,inventory}.ts
const fs = require("fs");
const path = require("path");

const OUT = path.join(process.cwd(), "docs", "postman");

// ─── Shared scripts ──────────────────────────────────────────────────────────

const PRE_REQUEST = `
// Auto-refresh the Zoho access token before every call.
// Mirrors IntegrationClient.refreshAccessToken in src/lib/integrations/base.ts.
//
// The one non-obvious thing: Zoho answers a REJECTED refresh with HTTP 200 and
// {"error":"invalid_client"} in the body. Status alone is not enough, which is exactly why
// base.ts checks \`data.error\` rather than \`res.ok\`.

const ACCOUNTS = "https://accounts.zoho.in/oauth/v2/token";
const SKEW_MS = 120000; // refresh 2 min early rather than racing the expiry

function getVar(k) {
  return pm.environment.get(k) || pm.collectionVariables.get(k) || "";
}
function setVar(k, v) {
  if (pm.environment.name) pm.environment.set(k, v);
  else pm.collectionVariables.set(k, v);
}

const isOAuthCall = pm.request.url.toString().indexOf("accounts.zoho.in") !== -1;
const token = getVar("accessToken");
const expiresAt = Number(getVar("accessTokenExpiresAt") || 0);
const stillFresh = token && Date.now() < expiresAt - SKEW_MS;

if (isOAuthCall) {
  console.log("[auth] OAuth call — skipping auto-refresh");
} else if (stillFresh) {
  const left = Math.round((expiresAt - Date.now()) / 1000);
  console.log("[auth] token valid for another " + left + "s");
} else {
  const clientId = getVar("clientId");
  const clientSecret = getVar("clientSecret");
  const refreshToken = getVar("refreshToken");

  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      "[auth] missing clientId / clientSecret / refreshToken. " +
      "Select an environment, fill those three, then run '00 OAuth > 2 Exchange grant token'."
    );
  } else {
    console.log("[auth] token missing or expired — refreshing");
    pm.sendRequest({
      url: ACCOUNTS,
      method: "POST",
      header: { "Content-Type": "application/x-www-form-urlencoded" },
      body: {
        mode: "urlencoded",
        urlencoded: [
          { key: "refresh_token", value: refreshToken },
          { key: "client_id", value: clientId },
          { key: "client_secret", value: clientSecret },
          { key: "grant_type", value: "refresh_token" }
        ]
      }
    }, function (err, res) {
      if (err) { console.error("[auth] transport error: " + err); return; }

      let body;
      try { body = res.json(); }
      catch (e) {
        console.error("[auth] refresh returned non-JSON (HTTP " + res.code + "). " +
                      "Usually an HTML error page — check the accounts domain is .in not .com.");
        return;
      }

      // 200 + {"error": ...} is a REJECTION. See base.ts.
      if (body.error || !body.access_token) {
        console.error("[auth] refresh rejected: " + (body.error || "no access_token in response"));
        console.error("[auth] invalid_client = wrong id/secret · invalid_code = refresh token " +
                      "revoked or from a different Zoho DC");
        return;
      }

      setVar("accessToken", body.access_token);
      setVar("accessTokenExpiresAt", String(Date.now() + (body.expires_in || 3600) * 1000));
      console.log("[auth] refreshed — valid " + (body.expires_in || 3600) + "s");
    });
  }
}
`.trim();

// Field maps lifted from the TypeScript interfaces in base.ts. Required = non-optional there,
// so a missing one genuinely breaks the app.
const TEST_SCRIPT = `
// Reports what Zoho actually returned, and checks it against the shapes the app relies on.
// The field lists below are the interfaces in src/lib/integrations/base.ts.

const REQUIRED = {
  items:            ["item_id", "sku", "name"],
  bills:            ["bill_id", "bill_number", "vendor_name", "vendor_id", "date", "due_date", "total", "balance", "status"],
  invoices:         ["invoice_id", "invoice_number", "customer_name", "date", "total", "balance", "status"],
  customerpayments: ["payment_id", "date", "amount", "payment_mode", "customer_name", "reference_number", "account_name"]
};
const OPTIONAL = {
  items:            ["status", "brand", "manufacturer", "purchase_rate", "rate", "tax_percentage",
                     "hsn_or_sac", "stock_on_hand", "product_type", "item_type", "category_name",
                     "category_id", "group_name"],
  bills:            [],
  invoices:         ["customer_id", "phone", "due_date"],
  customerpayments: []
};
const ID_FIELD = {
  items: ["item_id", "itemId"],
  bills: ["bill_id", "billId"],
  invoices: ["invoice_id", "invoiceId"],
  contacts: ["contact_id", "contactId"],
  customerpayments: ["payment_id", "paymentId"],
  organizations: ["organization_id", "organizationId"]
};

function setVar(k, v) {
  if (pm.environment.name) pm.environment.set(k, v);
  else pm.collectionVariables.set(k, v);
}

console.log("[http] " + pm.response.code + " " + pm.response.status + " in " + pm.response.responseTime + "ms");

const limit = pm.response.headers.get("X-Rate-Limit-Remaining");
if (limit) console.log("[rate] remaining: " + limit);

let body = null;
try { body = pm.response.json(); } catch (e) {
  console.error("[shape] response is not JSON — content-type " + pm.response.headers.get("Content-Type"));
}

pm.test("HTTP 200", function () { pm.response.to.have.status(200); });

if (body) {
  // Zoho puts its own status in the body: code 0 means success even when HTTP is 200.
  if (typeof body.code !== "undefined" && body.code !== 0) {
    console.error("[zoho] code " + body.code + ": " + body.message);
  }
  pm.test("Zoho code is 0", function () {
    pm.expect(body.code === undefined || body.code === 0, "body.code=" + body.code + " " + (body.message || "")).to.be.true;
  });

  console.log("[shape] top-level keys: " + Object.keys(body).join(", "));
  if (body.page_context) {
    console.log("[page] " + JSON.stringify(body.page_context));
    if (body.page_context.has_more_page) {
      console.log("[page] more pages exist — the app's listAll* methods loop until this is false");
    }
  }

  const listKey = Object.keys(body).find(function (k) { return Array.isArray(body[k]); });

  if (listKey) {
    const rows = body[listKey];
    console.log("[shape] " + listKey + ": " + rows.length + " rows");

    if (rows.length) {
      const row = rows[0];
      const present = Object.keys(row).sort();
      console.log("[shape] first row has " + present.length + " fields: " + present.join(", "));

      const req = REQUIRED[listKey] || [];
      const missing = req.filter(function (f) { return !(f in row); });
      if (missing.length) {
        console.error("[BREAKS APP] " + listKey + " is missing required fields: " + missing.join(", "));
      } else if (req.length) {
        console.log("[ok] every field base.ts requires for " + listKey + " is present");
      }
      pm.test("required fields present for " + listKey, function () {
        pm.expect(missing, "missing: " + missing.join(", ")).to.be.empty;
      });

      const known = req.concat(OPTIONAL[listKey] || []);
      if (known.length) {
        const extra = present.filter(function (f) { return known.indexOf(f) === -1; });
        if (extra.length) {
          console.log("[unused] Zoho also sends " + extra.length + " fields the app ignores:");
          console.log("         " + extra.join(", "));
        }
      }

      const idSpec = ID_FIELD[listKey];
      if (idSpec && row[idSpec[0]]) {
        setVar(idSpec[1], row[idSpec[0]]);
        console.log("[var] " + idSpec[1] + " = " + row[idSpec[0]] + "  (later requests will use it)");
      }
    } else {
      console.log("[shape] empty list — widen the date range or check organization_id");
    }
  } else {
    // Single-object response: /bills/{id}, /invoices/{id}, /items/{id}
    const objKey = Object.keys(body).find(function (k) {
      return body[k] && typeof body[k] === "object" && !Array.isArray(body[k]) && k !== "page_context";
    });
    if (objKey) {
      const obj = body[objKey];
      console.log("[shape] " + objKey + " has " + Object.keys(obj).length + " fields: " + Object.keys(obj).sort().join(", "));
      if (Array.isArray(obj.line_items)) {
        console.log("[shape] line_items: " + obj.line_items.length + " rows");
        if (obj.line_items.length) {
          console.log("[shape] line_item fields: " + Object.keys(obj.line_items[0]).sort().join(", "));
          console.log("[note] the app reads name, sku, item_id, quantity, rate, item_total (LineItem in base.ts)");
        }
      }
    }
  }
}
`.trim();

// ─── Request builder ─────────────────────────────────────────────────────────

const ORG = { key: "organization_id", value: "{{organizationId}}" };

function req(o) {
  const query = (o.query || []).concat(o.noOrg ? [] : [ORG]);
  const base = o.absoluteUrl || "{{apiBase}}" + o.path;
  const qs = query
    .filter(function (q) { return !q.disabled; })
    .map(function (q) { return q.key + "=" + q.value; })
    .join("&");
  const raw = qs ? base + "?" + qs : base;

  const r = {
    name: o.name,
    request: {
      method: o.method,
      header: o.header || [],
      url: { raw: raw, query: query },
      description: o.description
    },
    response: []
  };
  if (o.auth) r.request.auth = o.auth;
  if (o.body) {
    r.request.body = { mode: "raw", raw: JSON.stringify(o.body, null, 2), options: { raw: { language: "json" } } };
    r.request.header = r.request.header.concat([{ key: "Content-Type", value: "application/json" }]);
  }
  if (o.urlencoded) {
    r.request.body = { mode: "urlencoded", urlencoded: o.urlencoded };
    r.request.header = r.request.header.concat([{ key: "Content-Type", value: "application/x-www-form-urlencoded" }]);
  }
  if (o.test) {
    r.event = [{ listen: "test", script: { type: "text/javascript", exec: o.test.split("\n") } }];
  }
  return r;
}

function folder(name, description, items) {
  return { name: name, description: description, item: items };
}

// ─── 00 OAuth ────────────────────────────────────────────────────────────────

const oauthSaveTokens = `
let body; try { body = pm.response.json(); } catch (e) { body = {}; }
function setVar(k, v) { if (pm.environment.name) pm.environment.set(k, v); else pm.collectionVariables.set(k, v); }

console.log("[http] " + pm.response.code + " — body keys: " + Object.keys(body).join(", "));

// Zoho returns HTTP 200 with {"error": "..."} when it rejects you.
if (body.error) {
  console.error("[auth] REJECTED: " + body.error);
  console.error("  invalid_code     grant token expired (they last ~3 min) or already used once");
  console.error("  invalid_client   client id/secret wrong, or created in a different Zoho DC");
  console.error("  invalid_redirect_uri  must match the console EXACTLY, trailing slash included");
}
pm.test("no error in body", function () { pm.expect(body.error, String(body.error)).to.be.undefined; });

if (body.refresh_token) {
  setVar("refreshToken", body.refresh_token);
  console.log("[var] refreshToken saved — this is the long-lived one. Copy it into IntegrationConfig.refreshToken.");
}
if (body.access_token) {
  setVar("accessToken", body.access_token);
  setVar("accessTokenExpiresAt", String(Date.now() + (body.expires_in || 3600) * 1000));
  console.log("[var] accessToken saved, expires in " + (body.expires_in || 3600) + "s");
}
if (body.api_domain) console.log("[info] api_domain = " + body.api_domain + "  (must match {{apiBase}}'s host)");
`.trim();

const NO_AUTH = { type: "noauth" };

const oauth = folder("00 OAuth", [
  "Do this once per provider. Each of ZOHO_BOOKS / ZAKYA_POS / ZOHO_INVENTORY is a separate",
  "IntegrationConfig row with its OWN client id, secret and refresh token — that is why there",
  "is one Postman environment per provider rather than one shared set of credentials.",
  "",
  "Everything here is on accounts.zoho.in (India DC). A client created on .com will fail with",
  "invalid_client no matter how correct the credentials look."
].join("\n"), [
  req({
    name: "1 · Authorize — copy this URL into a browser",
    method: "GET",
    absoluteUrl: "https://accounts.zoho.in/oauth/v2/auth",
    noOrg: true,
    auth: NO_AUTH,
    query: [
      { key: "scope", value: "ZohoBooks.fullaccess.all" },
      { key: "client_id", value: "{{clientId}}" },
      { key: "response_type", value: "code" },
      { key: "access_type", value: "offline" },
      { key: "redirect_uri", value: "{{redirectUri}}" },
      { key: "prompt", value: "consent" }
    ],
    description: [
      "**Do not press Send** — this returns a login page. Copy the resolved URL from the URL bar",
      "and open it in a browser.",
      "",
      "After you approve, Zoho redirects to `redirect_uri?code=1000.xxxx`. That `code` is the",
      "**grant token** and it expires in about 3 minutes and works exactly once. Paste it into",
      "request 2 immediately.",
      "",
      "`access_type=offline` is what makes Zoho return a refresh_token. Without it you get an",
      "access token only and the app cannot reconnect itself.",
      "`prompt=consent` forces the refresh token to be reissued — Zoho silently omits it on a",
      "repeat authorization otherwise, which looks like a broken response.",
      "",
      "**Scopes per provider** — set `scope` to match the environment you selected:",
      "",
      "| Provider | scope |",
      "|---|---|",
      "| Zoho Books | `ZohoBooks.fullaccess.all` |",
      "| Zoho Inventory | `ZohoInventory.fullaccess.all` |",
      "| Zakya POS | `ZakyaAPI.fullaccess.all` |",
      "",
      "Narrower scopes work too and are better for a read-only look:",
      "`ZohoBooks.bills.READ,ZohoBooks.invoices.READ,ZohoBooks.settings.READ,ZohoBooks.contacts.READ`",
      "",
      "Note the app's own comment at `src/app/api/zoho/trigger-pull/route.ts:373` — the Inventory",
      "token lacks the bills scope, so bills are pulled through Books. If you scope Inventory",
      "narrowly, expect the same.",
      "",
      "**Faster alternative — Self Client.** In the Zoho API console create a *Self Client*,",
      "open the Generate Code tab, enter the scope, and it hands you a grant token with no",
      "redirect_uri at all. Skip straight to request 2."
    ].join("\n")
  }),
  req({
    name: "2 · Exchange grant token → refresh token",
    method: "POST",
    absoluteUrl: "https://accounts.zoho.in/oauth/v2/token",
    noOrg: true,
    auth: NO_AUTH,
    urlencoded: [
      { key: "code", value: "{{grantToken}}", description: "the code= from the redirect. ~3 min life, single use." },
      { key: "client_id", value: "{{clientId}}" },
      { key: "client_secret", value: "{{clientSecret}}" },
      { key: "grant_type", value: "authorization_code" },
      { key: "redirect_uri", value: "{{redirectUri}}", description: "omit for a Self Client grant" }
    ],
    test: oauthSaveTokens,
    description: [
      "Same call as `exchangeGrantToken` in `src/lib/integrations/base.ts:467`.",
      "",
      "Saves `refreshToken` and `accessToken` into the active environment. **The refresh token is",
      "the valuable one** — it does not expire, and it is what goes into",
      "`IntegrationConfig.refreshToken` for this provider.",
      "",
      "If the response is `{\"error\":\"invalid_code\"}` at HTTP 200, the grant token expired.",
      "Generate a new one; they really do only last a few minutes."
    ].join("\n")
  }),
  req({
    name: "3 · Refresh access token (manual)",
    method: "POST",
    absoluteUrl: "https://accounts.zoho.in/oauth/v2/token",
    noOrg: true,
    auth: NO_AUTH,
    urlencoded: [
      { key: "refresh_token", value: "{{refreshToken}}" },
      { key: "client_id", value: "{{clientId}}" },
      { key: "client_secret", value: "{{clientSecret}}" },
      { key: "grant_type", value: "refresh_token" }
    ],
    test: oauthSaveTokens,
    description: [
      "You should never need this — the collection pre-request script does it automatically when",
      "the token is missing or within 2 minutes of expiring.",
      "",
      "Run it by hand to watch the exchange, or to confirm a refresh token still works after a",
      "reconnect. Note the response has **no** `refresh_token` field: a refresh returns only a new",
      "access token. That is normal, not a truncated response."
    ].join("\n")
  }),
  req({
    name: "4 · Revoke refresh token",
    method: "POST",
    absoluteUrl: "https://accounts.zoho.in/oauth/v2/token/revoke",
    noOrg: true,
    auth: NO_AUTH,
    urlencoded: [{ key: "token", value: "{{refreshToken}}" }],
    description: [
      "Invalidates the refresh token. Use it when a credential leaks, or to prove that the app's",
      "`401 → refresh once → fail with 'Please reconnect'` path behaves as designed",
      "(`base.ts:286-300`).",
      "",
      "**This breaks the live integration for this provider** until you redo requests 1 and 2 and",
      "put the new refresh token into IntegrationConfig. Do not run it against production",
      "credentials casually."
    ].join("\n")
  })
]);

// ─── 01 Setup / organizations ────────────────────────────────────────────────

const setup = folder("01 Organization", [
  "Every API call carries `organization_id`. Get it here first — a wrong or missing one is the",
  "single most common cause of an empty list that should have rows."
].join("\n"), [
  req({
    name: "Organizations (documented v3 path)",
    method: "GET",
    path: "/organizations",
    noOrg: true,
    test: [
      "let b; try { b = pm.response.json(); } catch (e) { b = {}; }",
      "if (b.organizations && b.organizations.length) {",
      "  b.organizations.forEach(function (o) {",
      "    console.log('[org] ' + o.organization_id + '  ' + o.name + '  ' + (o.currency_code || '') + '  ' + (o.is_default_org ? '(default)' : ''));",
      "  });",
      "  const first = b.organizations[0];",
      "  if (pm.environment.name) pm.environment.set('organizationId', first.organization_id);",
      "  else pm.collectionVariables.set('organizationId', first.organization_id);",
      "  console.log('[var] organizationId = ' + first.organization_id);",
      "} else { console.error('[org] no organizations — the token may lack the settings scope'); }"
    ].join("\n"),
    description: [
      "`GET {{apiBase}}/organizations` — the path Zoho documents.",
      "",
      "Saves the first organization_id into the environment, so every other request in this",
      "collection works straight after. If you have more than one org, read the console output and",
      "set `organizationId` by hand.",
      "",
      "Run this **before** anything else: `organization_id` is appended to every call by",
      "`apiCall` (`base.ts:266`), and Zoho answers a wrong one with an empty list rather than an",
      "error, which reads exactly like 'no data'."
    ].join("\n")
  }),
  req({
    name: "Organizations (the path the app actually builds)",
    method: "GET",
    absoluteUrl: "https://www.zohoapis.in/books/v3/../organizations",
    noOrg: true,
    description: [
      "**Worth running once, to settle a question in the code.**",
      "",
      "`BooksClient.getOrganizations` (`books.ts:209`) passes the endpoint `\"/../organizations\"`,",
      "and `apiCall` concatenates it onto `https://www.zohoapis.in/books/v3`. The registry entry",
      "calls the `..` deliberate: *\"organizations sits above the books/v3 segment\"*.",
      "",
      "URL normalisation resolves that to `https://www.zohoapis.in/books/organizations` —",
      "**without** `v3`. Compare this request's status against the one above:",
      "",
      "- both 200 → the `..` form is fine, nothing to do",
      "- this one 404 while the other is 200 → the app's setup call is broken, and the org-id",
      "  lookup on the Settings screen silently fails",
      "",
      "Postman may normalise the `..` before sending, exactly as fetch does. If so you are seeing",
      "the same request the app sends, which is the point."
    ].join("\n")
  })
]);

// ─── 02 Items ────────────────────────────────────────────────────────────────

const items = folder("02 Items — the product catalog", [
  "Registry keys: `items.list` (all providers), `items.get`, `items.create`, `items.update`",
  "(Books), `items.create.inventory` (Inventory).",
  "",
  "Owned by `listItems` / `listAllItems` in base.ts and `BooksClient` / `InventoryClient`."
].join("\n"), [
  req({
    name: "List items",
    method: "GET",
    path: "/items",
    query: [
      { key: "page", value: "1" },
      { key: "per_page", value: "25" },
      { key: "status", value: "active" }
    ],
    description: [
      "Feeds the product pull. `listAllItems` loops pages until `page_context.has_more_page` is",
      "false — watch that value in the console.",
      "",
      "The test script compares each row against `IntegrationItem` (`base.ts:41`) and prints:",
      "- any **required** field missing (`item_id`, `sku`, `name`) — those break the import",
      "- every field Zoho sends that the app currently ignores — candidates for new columns",
      "",
      "`per_page` maxes out at 200 on Zoho. Raising it past that is silently clamped."
    ].join("\n")
  }),
  req({
    name: "List items — changed since a date",
    method: "GET",
    path: "/items",
    query: [
      { key: "last_modified_time", value: "2026-08-01T00%3A00%3A00%2B0530" },
      { key: "per_page", value: "50" }
    ],
    description: [
      "The incremental pull. Cheaper than walking the whole catalog.",
      "",
      "**The `+` in the timezone offset must be percent-encoded as `%2B`.** Sent raw, Zoho reads",
      "it as a space and ignores the whole filter — which looks exactly like `last_modified_time`",
      "doing nothing. `base.ts:436` carries the same warning and uses `encodeURIComponent`. The",
      "value here is pre-encoded; leave it that way.",
      "",
      "The app asks for `per_page=200` (the Zoho maximum). 50 here just keeps the console readable."
    ].join("\n")
  }),
  req({
    name: "Get item",
    method: "GET",
    path: "/items/{{itemId}}",
    description: [
      "`items.get` — *\"Category, HSN and tax for one item — absent from the list response\"*.",
      "",
      "`{{itemId}}` is filled in automatically by the List items request above. Run that first.",
      "",
      "This is the call that answers your GST question: compare `hsn_or_sac`, `tax_percentage`,",
      "`tax_id` and `tax_name` here against what the list response carried. Anything only present",
      "here is a per-item fetch the importer has to make."
    ].join("\n")
  }),
  req({
    name: "Create item — Zoho Books (JSONString wrapper)",
    method: "POST",
    path: "/items",
    body: {
      JSONString: JSON.stringify({
        name: "TEST — delete me",
        sku: "TEST-SKU-001",
        rate: 12000,
        purchase_rate: 9000,
        hsn_or_sac: "87120010",
        item_type: "inventory",
        product_type: "goods"
      })
    },
    description: [
      "`BooksClient.createItem` (`books.ts:13`). **Books wraps the payload in a `JSONString`",
      "field whose value is a JSON *string*** — not an object. Sending the object directly is",
      "rejected.",
      "",
      "Compare with the Inventory version below: same path, different envelope. The registry",
      "flags this explicitly as *\"a real difference between the two Zoho products, not an",
      "inconsistency to fix\"*.",
      "",
      "**This writes to your real Zoho org.** Delete the test item afterwards."
    ].join("\n")
  }),
  req({
    name: "Create item — Zoho Inventory (bare object)",
    method: "POST",
    path: "/items",
    body: {
      name: "TEST — delete me",
      sku: "TEST-SKU-002",
      purchase_rate: 9000,
      rate: 12000,
      item_type: "inventory",
      product_type: "goods"
    },
    description: [
      "`InventoryClient.createItem` (`inventory.ts:45`) — the object goes in the body directly,",
      "with no `JSONString` wrapper.",
      "",
      "Select the **Zoho Inventory** environment before sending. Under the Books environment this",
      "will fail, and that failure is the demonstration.",
      "",
      "**This writes to your real Zoho org.**"
    ].join("\n")
  }),
  req({
    name: "Update item (price push-back)",
    method: "PUT",
    path: "/items/{{itemId}}",
    body: { JSONString: JSON.stringify({ rate: 12500 }) },
    description: [
      "`BooksClient.updateItem` — what the price-check screen calls to push a corrected price",
      "back into Zoho.",
      "",
      "This endpoint used to be called from a route handler directly, bypassing the client. That",
      "is why `apiCall` is now `protected` (`base.ts:254`).",
      "",
      "**This writes to your real Zoho org.** Point `{{itemId}}` at a test item."
    ].join("\n")
  })
]);

// ─── 03 Bills ────────────────────────────────────────────────────────────────

const bills = folder("03 Bills — vendor purchases", [
  "Registry keys: `bills.list`, `bills.get` (all providers), `bills.create` (Books).",
  "Feeds the inbound and accounting imports, and the `VendorBill` table."
].join("\n"), [
  req({
    name: "List bills — date window",
    method: "GET",
    path: "/bills",
    query: [
      { key: "page", value: "1" },
      { key: "per_page", value: "25" },
      { key: "date_start", value: "2026-08-01" },
      { key: "date_end", value: "2026-09-01" }
    ],
    description: [
      "The Bulk Fetch tab on `/deliveries` and the bill import both come through here.",
      "",
      "The test script checks all nine fields `IntegrationBill` declares required. Two to look at",
      "closely for your own schema work:",
      "",
      "- **`total` and `balance` arrive as JSON numbers**, i.e. IEEE doubles. That is the origin",
      "  of the float money problem — the value is already inexact before it reaches Prisma.",
      "  Read them as strings if you move `VendorBill.amount` to `Decimal`.",
      "- **there is no tax breakdown in the list response.** `VendorBill` stores a single",
      "  `amount` with no subtotal/tax split, which is why per-line ITC is not possible today.",
      "  Check the single-bill response below for where the tax actually lives."
    ].join("\n")
  }),
  req({
    name: "List bills — search by text",
    method: "GET",
    path: "/bills",
    query: [
      { key: "search_text", value: "" },
      { key: "per_page", value: "25" }
    ],
    description: [
      "Free-text search across bill number and vendor name. Put a real bill number in",
      "`search_text` before sending.",
      "",
      "Zoho ANDs `search_text` with `date_start`/`date_end` when both are present — a search that",
      "returns nothing is often a date window problem, not a missing bill."
    ].join("\n")
  }),
  req({
    name: "Get bill (with line items)",
    method: "GET",
    path: "/bills/{{billId}}",
    description: [
      "`bills.get` — *\"Line items for one bill — the list response does not carry them\"*.",
      "",
      "`{{billId}}` is set by the list request above.",
      "",
      "**This is the response to study for the GST question.** The console prints every line-item",
      "field. Look for `tax_percentage`, `tax_id`, `hsn_or_sac`, `item_total`, and the bill-level",
      "`tax_total` / `sub_total`. Those are the fields a `VendorBillItem` table would need if you",
      "ever want per-line input tax credit.",
      "",
      "The app reads only `name`, `sku`, `item_id`, `quantity`, `rate`, `item_total` (`LineItem`,",
      "`base.ts:126`) — everything else Zoho sends here is currently discarded."
    ].join("\n")
  }),
  req({
    name: "Create bill (Books)",
    method: "POST",
    path: "/bills",
    body: {
      JSONString: JSON.stringify({
        vendor_id: "{{contactId}}",
        bill_number: "TEST-BILL-001",
        date: "2026-09-01",
        due_date: "2026-10-01",
        line_items: [{ name: "Test line", rate: 1000, quantity: 1 }]
      })
    },
    description: [
      "`BooksClient.createBill`. One of the two Zoho writes revived in the Part B refactor.",
      "",
      "Needs a real `vendor_id` — run **05 Contacts › List vendors** first to populate",
      "`{{contactId}}`.",
      "",
      "**This writes to your real Zoho org.**"
    ].join("\n")
  })
]);

// ─── 04 Invoices ─────────────────────────────────────────────────────────────

const invoices = folder("04 Invoices — sales", [
  "Registry keys: `invoices.list`, `invoices.get` (all), `invoices.search`, `invoices.create`",
  "(Books). Drives delivery matching, receivables, and the workshop counter lookup."
].join("\n"), [
  req({
    name: "List invoices — date window",
    method: "GET",
    path: "/invoices",
    query: [
      { key: "page", value: "1" },
      { key: "per_page", value: "25" },
      { key: "date_start", value: "2026-08-01" },
      { key: "date_end", value: "2026-09-01" }
    ],
    description: [
      "Feeds delivery matching and receivables.",
      "",
      "`IntegrationInvoice` marks `phone` and `customer_id` **optional** — watch the console to",
      "see whether your org actually returns them on the list call. If `phone` is absent here,",
      "matching an invoice to a `Customer` row (whose identity IS the phone) needs the",
      "single-invoice fetch or a contact lookup."
    ].join("\n")
  }),
  req({
    name: "Search invoices — by phone",
    method: "GET",
    path: "/invoices",
    query: [
      { key: "phone", value: "9999999999" },
      { key: "per_page", value: "10" },
      { key: "sort_column", value: "date" },
      { key: "sort_order", value: "D" }
    ],
    description: [
      "`invoices.search` — the workshop counter lookup (`BooksClient.searchInvoices`).",
      "",
      "**Books only.** This was one of the three calls that used to reach `apiCall` directly from",
      "the workshop layer before the escape hatches were closed.",
      "",
      "Put a real customer phone in. Zoho matches `phone` against the contact's number, so a",
      "customer whose invoice was raised without a phone on the contact will not be found — the",
      "same failure your `Customer.phone` uniqueness is designed around."
    ].join("\n")
  }),
  req({
    name: "Search invoices — by invoice number",
    method: "GET",
    path: "/invoices",
    query: [
      { key: "invoice_number", value: "INV-000001" },
      { key: "per_page", value: "10" }
    ],
    description: [
      "Same registry key, different parameter. Exact match, not a prefix search.",
      "",
      "There is a real bug in this app's history here: `inv.invoice_number` was typed `any`, and",
      "`.startsWith()` on it only failed once the `any` was removed (`base.ts:96`). Worth",
      "confirming what type Zoho actually sends — a numeric-looking invoice number may arrive as",
      "a number, not a string."
    ].join("\n")
  }),
  req({
    name: "Get invoice (full detail)",
    method: "GET",
    path: "/invoices/{{invoiceId}}",
    description: [
      "`invoices.get`. Richer than the list shape, which is why `IntegrationInvoiceDetail`",
      "(`base.ts:99`) is a separate interface with an index signature.",
      "",
      "The console prints the full field list plus `line_items`. Compare against the named fields",
      "the app reads: `salesperson_name`, `contact_persons[].phone`, `billing_address`,",
      "`shipping_address`, `line_items`.",
      "",
      "Anything printed that is not in that list is data you are already receiving and not using."
    ].join("\n")
  }),
  req({
    name: "Create invoice (Books)",
    method: "POST",
    path: "/invoices",
    body: {
      JSONString: JSON.stringify({
        customer_id: "{{contactId}}",
        date: "2026-09-01",
        line_items: [{ name: "Test line", rate: 1000, quantity: 1 }]
      })
    },
    description: [
      "`BooksClient.createInvoice` — raise an invoice in Zoho from a sale recorded here. The",
      "second of the two writes revived in Part B.",
      "",
      "**This writes to your real Zoho org**, and an invoice may not be deletable once it has a",
      "number. Use a sandbox org if you have one."
    ].join("\n")
  })
]);

// ─── 05 Contacts ─────────────────────────────────────────────────────────────

const contacts = folder("05 Contacts — vendors and customers (Books only)", [
  "Registry keys: `contacts.list`, `contacts.search`, `contacts.create`. **Books only** — the",
  "registry marks these BOOKS_ONLY and the other two providers do not answer them.",
  "",
  "Every `Vendor` imported from Zoho comes from here."
].join("\n"), [
  req({
    name: "List vendors",
    method: "GET",
    path: "/contacts",
    query: [
      { key: "contact_type", value: "vendor" },
      { key: "page", value: "1" },
      { key: "per_page", value: "25" }
    ],
    description: [
      "The vendor pull. Sets `{{contactId}}` for the create-bill and create-invoice requests.",
      "",
      "Fields to check against your `Vendor` table: `gst_no` → `gstin`, `cf_*` custom fields,",
      "`payment_terms` → `paymentTermDays`, `credit_limit` → `creditLimit`.",
      "",
      "`paymentTermDays` and the cash-discount fields (`cdTermsDays`, `cdPercentage`) are the",
      "ones that decide CD eligibility. If Zoho carries `payment_terms` and the app is not",
      "reading it, that is a live divergence — the console prints the unused fields."
    ].join("\n")
  }),
  req({
    name: "Search contacts",
    method: "GET",
    path: "/contacts",
    query: [
      { key: "search_text", value: "" },
      { key: "contact_type", value: "vendor" },
      { key: "per_page", value: "10" }
    ],
    description: [
      "`contacts.search` — *\"Find an existing contact before creating a duplicate\"*.",
      "",
      "This is the app's duplicate guard, and it is a search, not a constraint. Two vendors whose",
      "names differ by a space will both be created. Compare with `Vendor.name @unique` in the",
      "schema — the database is stricter than Zoho is."
    ].join("\n")
  }),
  req({
    name: "Create contact (vendor)",
    method: "POST",
    path: "/contacts",
    body: {
      JSONString: JSON.stringify({
        contact_name: "TEST VENDOR — delete me",
        contact_type: "vendor",
        gst_no: "29ABCDE1234F1Z5",
        email: "test@example.com"
      })
    },
    description: [
      "`BooksClient.createContact` (`books.ts:79`). Note the `JSONString` wrapper again, and that",
      "the app maps `vendor.gstin` → `gst_no`.",
      "",
      "**This writes to your real Zoho org.**"
    ].join("\n")
  })
]);

// ─── 06 Customer payments ────────────────────────────────────────────────────

const payments = folder("06 Customer payments", "Registry key: `customerpayments.list` (all providers). Feeds receivables reconciliation.", [
  req({
    name: "List customer payments",
    method: "GET",
    path: "/customerpayments",
    query: [
      { key: "page", value: "1" },
      { key: "per_page", value: "25" },
      { key: "date_start", value: "2026-08-01" },
      { key: "date_end", value: "2026-09-01" }
    ],
    description: [
      "`IntegrationCustomerPayment` (`base.ts:81`) declares **all seven** fields required —",
      "including `reference_number` and `account_name`, which Zoho leaves as empty strings on a",
      "cash payment. Watch whether they come back as `\"\"` or are absent entirely: the test",
      "script distinguishes them, and `\"\"` vs missing is the difference between a working import",
      "and an undefined reaching Prisma.",
      "",
      "`amount` is a JSON number here too — the same float exposure as bills."
    ].join("\n")
  })
]);

// ─── 09 Diagnostics ──────────────────────────────────────────────────────────

const diagnostics = folder("09 Diagnostics", [
  "Reproduce the failure modes `apiCall` handles, so you can recognise them in the app's logs."
].join("\n"), [
  req({
    name: "401 — what an expired token looks like",
    method: "GET",
    path: "/items",
    query: [{ key: "per_page", value: "1" }],
    header: [{ key: "Authorization", value: "Zoho-oauthtoken 1000.deadbeefdeadbeefdeadbeefdeadbeef" }],
    auth: NO_AUTH,
    test: [
      "console.log('[http] ' + pm.response.code + ' ' + pm.response.status);",
      "let b; try { b = pm.response.json(); console.log('[body] ' + JSON.stringify(b)); }",
      "catch (e) { console.log('[body] non-JSON: ' + pm.response.text().slice(0, 200)); }",
      "console.log('[note] base.ts:286 catches this, refreshes once, and retries. A second 401');",
      "console.log('       throws \"authentication failed. Please reconnect.\"');"
    ].join("\n"),
    description: [
      "Deliberately sends a junk token with the collection auth disabled, so you can see the exact",
      "401 body Zoho returns.",
      "",
      "This is the response `apiCall` reacts to at `base.ts:286` — refresh once, retry once, then",
      "give up with a reconnect message. Safe to run; it changes nothing."
    ].join("\n")
  }),
  req({
    name: "Rate limit headers",
    method: "GET",
    path: "/items",
    query: [{ key: "per_page", value: "1" }],
    test: [
      "console.log('[http] ' + pm.response.code + ' in ' + pm.response.responseTime + 'ms');",
      "['X-Rate-Limit-Limit','X-Rate-Limit-Remaining','X-Rate-Limit-Reset','Retry-After'].forEach(function (h) {",
      "  const v = pm.response.headers.get(h);",
      "  if (v) console.log('[rate] ' + h + ': ' + v);",
      "});",
      "console.log('[note] on 429 base.ts:308 honours Retry-After, else backs off 5s/10s/20s, 3 tries max');"
    ].join("\n"),
    description: [
      "A minimal call whose only job is to print the rate-limit headers.",
      "",
      "Zoho's limit is per organization per minute, so a bulk pull competing with the live app",
      "will hit it. `apiCall` honours `Retry-After` when present and otherwise backs off",
      "exponentially, giving up after 3 attempts (`base.ts:308`)."
    ].join("\n")
  })
]);

// ─── Collection ──────────────────────────────────────────────────────────────

const collection = {
  info: {
    _postman_id: "bch-zoho-integration",
    name: "BCH — Zoho / Zakya integration",
    description: [
      "Every Zoho endpoint this application touches, generated from the endpoint registry at",
      "`src/lib/integrations/endpoints.ts`. Auth is handled for you.",
      "",
      "## Set up in three steps",
      "",
      "1. **Import an environment.** There are three, one per provider — they differ only in",
      "   `apiBase` and which credentials they hold:",
      "   - `zoho-books.postman_environment.json` → `https://www.zohoapis.in/books/v3`",
      "   - `zakya.postman_environment.json` → `https://api.zakya.in/inventory/v1`",
      "   - `zoho-inventory.postman_environment.json` → `https://www.zohoapis.in/inventory/v1`",
      "",
      "   Select one in the top-right picker. **Nothing works until you do** — `{{apiBase}}` is",
      "   only defined in the environments.",
      "",
      "2. **Fill `clientId`, `clientSecret`** in that environment, then run `00 OAuth › 1` and",
      "   `00 OAuth › 2`. That stores a `refreshToken`.",
      "",
      "3. **Run `01 Organization › Organizations`.** It saves `organizationId` automatically.",
      "",
      "From then on every request authenticates itself.",
      "",
      "## How the auth works",
      "",
      "Collection-level auth sends `Authorization: Zoho-oauthtoken {{accessToken}}` on every",
      "request — Zoho's scheme, **not** `Bearer`.",
      "",
      "A collection pre-request script refreshes `accessToken` whenever it is missing or within",
      "two minutes of expiring, using `refreshToken`. It mirrors",
      "`IntegrationClient.refreshAccessToken` in `src/lib/integrations/base.ts`, including the",
      "one thing that catches everybody: **Zoho rejects a refresh with HTTP 200 and an `error`",
      "key in the body**, so status alone is not enough.",
      "",
      "You never paste a token anywhere. Open the Postman Console (`Ctrl+Alt+C`) to watch it.",
      "",
      "## Reading the console output",
      "",
      "Every response is inspected against the TypeScript interfaces in `base.ts` and reported:",
      "",
      "| Line | Meaning |",
      "|---|---|",
      "| `[shape] first row has N fields: ...` | everything Zoho actually sent |",
      "| `[ok] every field base.ts requires ... is present` | the import will work |",
      "| `[BREAKS APP] missing required fields: ...` | the import will produce undefined |",
      "| `[unused] Zoho also sends N fields the app ignores` | **data you already receive and discard** |",
      "| `[page] {has_more_page: true}` | `listAll*` will loop again |",
      "| `[rate] remaining: N` | how close you are to a 429 |",
      "",
      "The `[unused]` line is the one to read if you are deciding what to store next.",
      "",
      "## Before you press Send",
      "",
      "These credentials are **live**. Every POST and PUT in this collection writes to your real",
      "Zoho organization — they are marked in their descriptions. The GETs are safe.",
      "",
      "Everything is on the **India** data centre (`accounts.zoho.in`, `zohoapis.in`). A client",
      "created on `.com` fails with `invalid_client` regardless of how right the values look."
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  auth: {
    type: "apikey",
    apikey: [
      { key: "key", value: "Authorization", type: "string" },
      { key: "value", value: "Zoho-oauthtoken {{accessToken}}", type: "string" },
      { key: "in", value: "header", type: "string" }
    ]
  },
  event: [
    { listen: "prerequest", script: { type: "text/javascript", exec: PRE_REQUEST.split("\n") } },
    { listen: "test", script: { type: "text/javascript", exec: TEST_SCRIPT.split("\n") } }
  ],
  variable: [
    { key: "grantToken", value: "", type: "string" },
    { key: "redirectUri", value: "http://localhost:3000/api/integrations/callback", type: "string" },
    { key: "accessToken", value: "", type: "string" },
    { key: "accessTokenExpiresAt", value: "0", type: "string" },
    { key: "itemId", value: "", type: "string" },
    { key: "billId", value: "", type: "string" },
    { key: "invoiceId", value: "", type: "string" },
    { key: "contactId", value: "", type: "string" },
    { key: "paymentId", value: "", type: "string" }
  ],
  item: [oauth, setup, items, bills, invoices, contacts, payments, diagnostics]
};

// ─── Environments ────────────────────────────────────────────────────────────

function env(id, name, apiBase, note) {
  return {
    id: id,
    name: name,
    values: [
      { key: "providerLabel", value: name, type: "default", enabled: true },
      { key: "provider", value: id.toUpperCase().replace(/-/g, "_"), type: "default", enabled: true },
      { key: "apiBase", value: apiBase, type: "default", enabled: true },
      { key: "organizationId", value: "", type: "default", enabled: true },
      { key: "clientId", value: "", type: "default", enabled: true },
      { key: "clientSecret", value: "", type: "secret", enabled: true },
      { key: "refreshToken", value: "", type: "secret", enabled: true },
      { key: "accessToken", value: "", type: "secret", enabled: true },
      { key: "accessTokenExpiresAt", value: "0", type: "default", enabled: true },
      { key: "grantToken", value: "", type: "secret", enabled: true },
      { key: "redirectUri", value: "http://localhost:3000/api/integrations/callback", type: "default", enabled: true },
      { key: "_note", value: note, type: "default", enabled: false }
    ],
    _postman_variable_scope: "environment"
  };
}

const envs = [
  ["zoho-books", "Zoho Books", "https://www.zohoapis.in/books/v3",
   "scope ZohoBooks.fullaccess.all — the only provider that answers contacts.* and the create endpoints"],
  ["zakya-pos", "Zakya POS", "https://api.zakya.in/inventory/v1",
   "scope ZakyaAPI.fullaccess.all — note the host is api.zakya.in, not zohoapis.in"],
  ["zoho-inventory", "Zoho Inventory", "https://www.zohoapis.in/inventory/v1",
   "scope ZohoInventory.fullaccess.all — its token lacks the bills scope; the app pulls bills via Books"]
];

// ─── Write ───────────────────────────────────────────────────────────────────

fs.writeFileSync(path.join(OUT, "zoho-integration.postman_collection.json"),
                 JSON.stringify(collection, null, 2));
console.log("wrote zoho-integration.postman_collection.json");

envs.forEach(function (e) {
  const file = e[0] + ".postman_environment.json";
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(env(e[0], e[1], e[2], e[3]), null, 2));
  console.log("wrote " + file);
});

// Sanity report
let n = 0;
collection.item.forEach(function (f) { n += f.item.length; });
console.log("folders: " + collection.item.length + "  requests: " + n);
