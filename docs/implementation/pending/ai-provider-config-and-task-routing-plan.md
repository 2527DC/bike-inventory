# AI provider config, task routing and spend visibility

Status: pending
Branch: **`feat/ai-provider-config`** — create it with exactly this name, off `main`.

**Companion document:** `docs/ai-usage-audit.md` — the inventory of every AI call, its
findings (F1–F11) and its own question log. This plan **depends on** that audit and does not
repeat it. Where the two overlap, the audit is the record of *what is wrong today*; this
plan is the record of *how the configuration layer should be built*.

---

## 1. What this changes, in one paragraph

Today the provider is `ANTHROPIC_API_KEY` in `.env`, and the model is a hardcoded string in
three files. There is no record of what any call costs. After this plan: the key and the
per-task model live in the database, an admin picks them from `/settings/ai`, every call
goes through one wrapper that logs its token usage, and switching a single task to a
different provider for a month is a dropdown — not a deploy.

**The driving requirement** (owner, 31 Aug 2026): *"I may use one provider for one month and
another the next, to compare usage and billing from analytics."* That requirement is what
makes the routing table and the usage log necessary. Without the log, the comparison the
whole feature exists to enable cannot be made.

---

## 2. Decision: the database is the source of truth. Nothing is written to `.env` at runtime.

Writing the saved config back out to `.env` or a generated config file was considered and
**rejected**. Three reasons, any one of which is disqualifying:

1. **Node reads `process.env` once per process.** Writing the file does not reload it. "Change
   the provider from the UI" would silently mean "change it, then restart the server" — which
   defeats the entire purpose of moving it out of the environment.
2. **The filesystem is read-only and ephemeral on a serverless or container deploy.** The
   write either throws or lands on one instance and not the others, and the instances drift.
3. **No audit trail, and a live leak path.** `.env` sits beside a git repo. A row carries
   `updatedById` and `updatedAt`; a file carries nothing, and a mistake commits a key.

### 2.1 "Don't hit the database on every AI call" is optimising the wrong thing

| | Typical |
|---|---|
| Prisma point-read on a primary key | ~1–3 ms |
| One Haiku call with an image attached | ~2,000–6,000 ms |

The config read is **under 0.1%** of the request it precedes. It is not worth designing
around. Cache it anyway — but because it removes a moving part, not because it is slow.

### 2.2 Caching — copy `src/lib/storage/index.ts` exactly

This problem is already solved in this repo, twice, in two different ways. The right move is
to copy the closer one rather than invent a third.

**`src/lib/storage/index.ts:27-33`** — a 30-second module-level TTL *plus* explicit
invalidation on write:

```ts
const CACHE_MS = 30_000;
let cached: { at: number; provider: StorageProvider | null } | null = null;
export function invalidateStorageCache(): void { cached = null; }
```

`invalidateStorageCache()` is called after every write (`settings/storage/route.ts:112`,
`activate/route.ts:67`). The TTL and the invalidation are **both** present on purpose: the
invalidation makes the change instant on the instance that served the save, and the TTL
catches every other instance within 30 seconds. Neither alone is sufficient.

It also **caches negative results** (`index.ts:102`, `:114`) so a broken config does not
hammer the database on every attempt. Worth copying.

**The counter-precedent, and why it does not win here.** `src/lib/integrations/index.ts:41-43`
deliberately uses request-scoped `React.cache()` instead, because a cross-request cache would
keep a **revoked** Zoho token alive after an admin pressed Disconnect.

That argument has force for an AI key too. The resolution: **cache the task routing (30 s
TTL), but treat `enabled: false` as a kill switch that must not be cached for long.** Since
both live on the same row, the practical answer is to keep the TTL short — 30 s, matching
storage — and accept a half-minute worst case on a disable. If instant revocation is wanted,
the fallback is `React.cache()` and a database read per request, which §2.1 shows costs
nothing meaningful. **See Q7.**

This is deliberately **not** `React.cache()` by default — that is per-request memoisation and
would read the database on every request.

---

## 3. Where the API key lives — the repo has already decided this twice

`prisma/schema.prisma:985-987` says, of `StorageConfig`:

> Secrets are stored in plaintext, matching `ZohoConfig.clientSecret` above. That is a
> deliberate, accepted trade-off, not an oversight: anyone with database read access holds
> the AWS keys. The API never returns `secretAccessKey` to the browser — it masks it.

`IntegrationConfig` (`schema.prisma:962-977`) stores `clientSecret` and `refreshToken` the
same way. **Two existing precedents, one of them explicitly reasoned about in a comment.**

So the default for this plan is **plaintext in the database, masked at the API boundary** —
consistent with the rest of the codebase, and requiring no new environment variable.

Encrypting with AES-256-GCM is the stronger option, but it is a **deviation** that would
leave this one table encrypted while the AWS keys and the Zoho refresh token beside it are
not, and it introduces a new required secret (`CONFIG_ENCRYPTION_KEY`) that must be present
at boot or every AI call fails. Raising the bar for one table and not the others buys
little. **See Q2 — this is the owner's call, and it is the only decision that changes §4.**

Non-negotiable either way: **the plaintext key never reaches the browser.**

### 3.1 Two masking precedents — pick the integrations one

| | Approach | Where |
|---|---|---|
| **Storage** | Returns `••••` + last 4, plus a `hasSecret` boolean | `settings/storage/route.ts:34-43`, applied `:57-58` |
| **Integrations** | Never returns the secret in any form; only `hasClientSecret: boolean` | `integrations/[provider]/status/route.ts:38, 69-77` |

There is **no shared masking helper in this repo** — storage defines `mask()` inline and it is
the only implementation.

**Recommendation: follow the integrations contract** (`hasApiKey: boolean`, secret never
serialised). An AI API key has no partial-recognition value the way an AWS key ID does, so the
last four characters buy nothing and every character not sent is one that cannot leak into a
log, a browser cache, or a screenshot.

### 3.2 The round-trip rule — the bug both precedents exist to avoid

If the write path treats "the field I received" as "the value to store", then opening the page
and pressing Save **wipes the key**, because the form was seeded with a mask.

Both existing routes guard against this, differently:

- Storage (`route.ts:89-91`): a value still starting with `••••` means *unchanged*; empty
  string means *clear*; anything else *replaces*.
- Integrations (`[provider]/route.ts:58`): `clientSecret?.trim() || existing?.clientSecret || null`
  — absent or empty means *keep existing*.

Following §3.1, this plan uses the integrations rule: **absent or empty means keep; a
non-empty value replaces; clearing is a separate explicit action.** This must be covered by a
manual check in §14 — it is invisible to `npm run build` and it destroys a working
integration.

---

## 4. Schema

Three models. `AiProvider` mirrors `IntegrationConfig`'s shape (provider-keyed, one row per
provider); `AiTaskConfig` is the routing table; `AiCallLog` is the spend record.

```prisma
// One row per provider we hold a key for. Provider is a plain String, not an enum,
// matching StorageConfig.provider: adding a provider should be a row, not a migration.
model AiProvider {
  key         String   @id                 // "anthropic" | "google" | ...
  apiKey      String?  @db.Text            // see §3 — plaintext, masked by the API
  enabled     Boolean  @default(false)
  updatedById String?
  updatedAt   DateTime @updatedAt

  @@map("ai_provider")
}

// One row per task key declared in src/lib/ai/tasks.ts. Rows are seeded from that
// catalogue; an admin edits them but cannot create or delete them. See §5.
model AiTaskConfig {
  taskKey     String   @id                 // "ledger.pdf_extract"
  providerKey String                       // -> AiProvider.key
  model       String                       // "claude-sonnet-5"
  maxTokens   Int
  effort      String?                      // null unless the model supports it — §5.2
  enabled     Boolean  @default(true)
  updatedById String?
  updatedAt   DateTime @updatedAt

  @@map("ai_task_config")
}

// One row per AI call. This table is the point of the feature: without it the
// month-over-month provider comparison cannot be made.
model AiCallLog {
  id                  String   @id @default(cuid())
  taskKey             String
  providerKey         String
  model               String
  inputTokens         Int      @default(0)
  outputTokens        Int      @default(0)
  cacheReadTokens     Int      @default(0)
  cacheCreationTokens Int      @default(0)
  stopReason          String?
  latencyMs           Int
  estimatedCostUsd    Decimal  @db.Decimal(10, 6)
  ok                  Boolean
  errorKind           String?                 // "rate_limit" | "max_tokens" | "parse" | ...
  userId              String?
  createdAt           DateTime @default(now())

  @@index([taskKey, createdAt])
  @@index([createdAt])
  @@map("ai_call_log")
}
```

`AiCallLog` has **no relation to `User`** and no cascade — it is an append-only spend record
that must outlive a deleted user. `userId` is a bare string, deliberately.

> **Schema note:** this adds three tables and no changes to existing ones. Per CLAUDE.md the
> schema-reviewer agent should be run on the migration before it is applied, and per
> AGENTS.md the `prisma` commands are gated and will be proposed one at a time.

---

## 5. The task catalogue lives in code, not in the database

This mirrors the RBAC design exactly. `prisma/rbac-catalog.ts` is **seed input**, never
imported from `src/`; permissions are configured in the database but *declared* in code.
Task keys work the same way, for the same reason: if an admin could create a task key,
nothing would read it, and if they could delete one, the code depending on it would break.

```ts
// src/lib/ai/tasks.ts — the declaration. Seed input for AiTaskConfig.
export const AI_TASKS = {
  "brand_stock.catalogue_parse": {
    label: "Brand catalogue (PDF / photo) → product rows",
    defaultModel: "claude-sonnet-5",
    defaultMaxTokens: 16000,
  },
  "payments.screenshot_scan": {
    label: "Payment screenshot → amount / mode / UTR",
    defaultModel: "claude-haiku-4-5",
    defaultMaxTokens: 1024,
  },
  "bank.statement_parse": {
    label: "Bank statement → transaction rows",
    defaultModel: "claude-haiku-4-5",
    defaultMaxTokens: 16000,
  },
  "bank.vendor_resolve": {
    label: "Transaction narration → vendor + expense category",
    defaultModel: "claude-haiku-4-5",
    defaultMaxTokens: 16000,
  },
} as const;

export type AiTaskKey = keyof typeof AI_TASKS;
```

A fifth key, `ledger.pdf_extract`, is **not** listed: the ledger PDF statement import is
still unbuilt (`pending/ledger-merge-plan.md`). It is added when that work lands — adding a
task is one entry here plus a seed row, which is the point of the design.

### 5.1 Call sites never name a model

```ts
const items = await runAiTask("brand_stock.catalogue_parse", { content, schema });
```

After Phase 2 there is **no model string anywhere in `src/app/` or in `pdf-parser.ts`**. A
grep for `claude-` outside `src/lib/ai/` returning a hit is a regression.

### 5.2 `effort` is not universal — validate it against the model

`output_config.effort` is supported on Opus 4.5+, Sonnet 5 and Opus 5. It is **not supported
on Haiku 4.5 and returns a 400.** Three of the four default tasks above run on Haiku.

So `effort` is nullable in the schema, and the `/settings/ai` form must disable the field
when the selected model does not accept it. Shipping this unvalidated means the first admin
who picks Haiku-with-effort breaks a working screen.

---

## 6. `src/lib/ai.ts` — the wrapper

One file, and the prerequisite for everything after it. It closes four audit findings at
once (F4, F6, F7, F9) simply by being the only path to a model.

Responsibilities, in order:

1. Resolve the task → `AiTaskConfig` → `AiProvider` (through the §2.2 cache).
2. Refuse clearly if the task is disabled or the provider holds no key — `log.error` plus a
   message naming the task, not a generic "AI API key not configured".
3. Call the provider adapter. **SDK only** — the two hand-rolled `fetch` calls to
   `api.anthropic.com` go away, taking their second retry policy and second error shape.
4. **Check `stop_reason`.** If `max_tokens`, throw a named error. This is F2 and F3: today a
   truncated response is silently salvaged and stored, or blamed on the document.
5. Record usage in `AiCallLog` and `log.info` the identifiers.
6. `log.debug` the outbound request — **counts and sizes only**, never the payload, never the
   key. Per CLAUDE.md.

```ts
import { createLogger } from "@/lib/logger";
const log = createLogger("ai:run");
```

Every `catch` logs before it rethrows. There is no bare `catch {}` in this file.

### 6.1 The provider interface — build the seam, implement one adapter

```ts
interface AiAdapter {
  complete(req: AiRequest): Promise<{
    text: string;
    usage: { input: number; output: number; cacheRead: number; cacheCreation: number };
    stopReason: string | null;
  }>;
}
```

**Only the Anthropic adapter is implemented in this plan.** The schema is multi-provider from
day one because that is nearly free; a second adapter is written the day a second provider is
actually going to run for a month, not speculatively. `@google/generative-ai` is currently
installed and imported nowhere (audit F11) — that is exactly the outcome to avoid repeating.

### 6.2 An honest caveat on the comparison

A month on another provider does not measure that provider fairly. The prompts will be tuned
to Claude's structured outputs and prompt caching, and neither transfers unchanged. The
result measures *"Claude-shaped prompts on another model"*. Budget for prompt rework before
drawing a conclusion from the analytics screen, or the comparison will mislead.

### 6.3 Migrating off `ANTHROPIC_API_KEY` — use the storage bootstrap pattern

`src/lib/pdf-parser.ts:4` is `new Anthropic()` with **no arguments** — the SDK reads
`ANTHROPIC_API_KEY` from the environment itself. Once the key comes from the database the
client must be constructed with an explicit `apiKey`, or the app will keep silently working
from `.env` on a machine that has it and fail only in the environment that does not.

`src/lib/storage/index.ts:42-77` already solves the transition cleanly: the environment
variable is a **bootstrap-only fallback, consulted only when no database row exists** — *"once
a row exists the database always wins."*

Copy it. `ANTHROPIC_API_KEY` seeds the `anthropic` row on first run and is never read again.
Nothing breaks on deploy, the `.env` line can be deleted at leisure, and there is no window
where the app has no key.

### 6.4 "Not configured" is a typed outcome, not a generic error

Storage defines `StorageNotConfiguredError` (`index.ts:97, 104, 119`) which callers turn into
a 501 pointing at Settings → Storage.

Do the same: `AiNotConfiguredError`, carrying the task key, surfaced as a message naming the
task and linking to `/settings/ai`. This replaces the current
`errorResponse("AI API key not configured", 400)` at
`payments/parse-screenshot/route.ts:30` — which tells the user nothing about which of four
tasks failed or where to fix it.

---

## 7. Migrating the four call sites

Per the audit §9. Each becomes a `runAiTask` call and loses its model string, its retry
handling and its JSON-scraping regex.

| File | Task key | Also fixes |
|---|---|---|
| `src/lib/pdf-parser.ts:16` | `brand_stock.catalogue_parse` | F3 (4096 cap), F7 (no logger), F10 (regex) |
| `src/app/api/payments/parse-screenshot/route.ts:75` | `payments.screenshot_scan` | F4, F7, F10 |
| `src/app/api/bank-statements/route.ts:117` (call A) | `bank.statement_parse` | F4, F8, F10 |
| `src/app/api/bank-statements/route.ts:296` (call B) | `bank.vendor_resolve` | F4, F6, F10 |

**`bank-statements/route.ts` is a checkpoint, not a routine edit.** It writes to
`BankStatement` and `BankTransaction`, and a mistake corrupts reconciliation history. Its
diff is reviewed with the owner before it is applied, per the audit §8.3.

F1 — the `text.slice(0, 50000)` that silently drops the tail of a long statement — is **not
fixed by this plan**. It is a data-loss bug in the audit's Phase 1 and is blocked on that
document's Q1/Q2. See §11.

---

## 8. RBAC and the settings screen

A new module in `prisma/rbac-catalog.ts`, following `settings_storage` (`:504-521`) exactly.
Note the naming convention is `settings_*`, not a bare noun:

```ts
{
  key: "settings_ai",
  label: "AI",
  icon: "Sparkles",
  route: "/settings/ai",
  description: "AI provider keys, per-task model routing and spend",
  group: "Admin",          // MUST equal the parent's group
  sortOrder: 523,          // settings_storage 521, zoho 522
  actions: ["view", "edit", "approve"],
  parentKey: "settings",
}
```

Two constraints the catalog comments call out, both of which the seeder enforces:

- **A child's `group` must equal its parent's** (`rbac-catalog.ts:587-588`) or the sidebar
  renders the section twice.
- **The tree is exactly two levels.** A grandchild is rejected by `prisma/seed-rbac.ts:48` and
  would render nowhere.

### 8.1 Three actions, mirroring storage's split

`settings_storage` separates reading config (`view`), editing credentials and running the
connection test (`edit`), and **switching the live provider** (`approve`) — and
`activate/route.ts:36-53` re-runs the test and *refuses to switch on failure*.

That split is worth copying exactly, because it is the same risk:

| Action | Grants |
|---|---|
| `view` | See the routing table and the spend dashboard |
| `edit` | Save a key, run the test call, change `maxTokens`/`effort` |
| `approve` | **Point a task at a different provider or model** |

Provider is not writable through the plain save route — it moves only through an activate
route that first makes one real call on the new configuration and refuses the switch if it
fails. This is precisely the monthly-provider-switch flow from §1, and it means a mistyped key
cannot take four AI features offline.

No role names appear anywhere. The guard is `requireFeature("settings_ai", "edit")` with
exactly two arguments and no fallback-roles parameter, per CLAUDE.md. Every route pairs it
with `if (error instanceof AuthError) return errorResponse(error.message, error.status)`,
matching the storage routes.

**The API re-checks.** The frontend `can(...)` only disables the control; the route is the gate.

### 8.2 Screen — `/settings/ai`

A client component, gated cosmetically with `usePermissions` / `can("settings_ai", …)` exactly
as `settings/storage/page.tsx:39-40` does, and registered in the settings index `ENTRIES`
array at `settings/page.tsx:29-34` so it is filtered by permission like its siblings.

Three sections:

1. **Providers** — one card per provider. A write-only key input (per §3.1 the field is empty
   with a *"a key is saved"* placeholder driven by `hasApiKey`; the value is never sent to the
   browser), an enable toggle, and a **Test** button that makes one trivial call and reports
   the result — the self-test pattern from `settings/storage/test/route.ts`.
2. **Task routing** — a row per task from `AI_TASKS`: label, provider dropdown, model
   dropdown, max tokens, effort (disabled where unsupported, §5.2), enabled toggle.
3. **Spend** — §9.

---

## 9. Spend visibility — the part that makes the requirement achievable

Audit F9 records that `response.usage` is never read, so **real spend today is unknown.**
Every cost figure in the audit is an estimate derived from prompt sizes.

`AiCallLog` fixes that at the source: one insert per call, on four low-volume call sites.
The dashboard on `/settings/ai` then answers, per month:

- total spend, split by task and by model
- calls, and the failure rate, per task
- **cache hit ratio** — `cacheReadTokens / (input + cacheRead)`, which is the single number
  that says whether §10.2 is working
- how many calls stopped on `max_tokens` — the early warning for F2/F3 recurring

Cost is computed in the wrapper from a rate table keyed by model, stored on the row at write
time. Rates are recorded per row rather than looked up later so that a published price change
does not silently rewrite last month's history.

Current published rates (per million tokens), for the table:

| Model | Input | Output |
|---|---|---|
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-sonnet-5` | $2.00 | $10.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

Cache reads bill at roughly 0.1× the input rate; cache writes at roughly 1.25×.

---

## 10. Token optimisation, ranked by return

### 10.1 Fix the model strings (one line each, strictly better)

| File | From | To | Effect |
|---|---|---|---|
| `pdf-parser.ts:16` | `claude-sonnet-4-20250514` | `claude-sonnet-5` | $3/$15 → **$2/$10**, *and* better at tables |
| 3 sites | `claude-haiku-4-5-20251001` | `claude-haiku-4-5` | Current IDs carry no date suffix |

Sonnet 5 is cheaper **and** more accurate than the model it replaces. There is no argument
for keeping Sonnet 4. After Phase 2 these are seed values, not code.

### 10.2 Prompt caching — the largest single win

Bank call B re-sends the **entire vendor list plus every pending bill** on every upload,
uncached. Putting that stable block first with `cache_control: { type: "ephemeral" }` bills
the repeat at roughly **0.1×**.

Caching is a **prefix match** — the stable catalogue must come first and the volatile
transaction list after it. If the two are interleaved, nothing caches and the change is
worthless. Verify with `usage.cache_read_input_tokens`; a persistent zero means a silent
invalidator, and §9's cache-hit-ratio tile is there to make that visible.

### 10.3 Deterministic-first (audit §7.2) — the cheapest token is one never sent

Exact-amount matching, UTR matching, duplicate detection and round-amount flagging are SQL
and `if` statements. Only the genuinely fuzzy leftovers — narration → vendor, narration →
expense category — go to a model. This is the pattern `brand-stock-matcher.ts` already uses
successfully: exact mappings first, fuzzy second.

**This is a larger change than the rest of this plan and is blocked on the audit's Q5/Q6.**
It is listed here because it dominates the cost, not because this plan implements it.

### 10.4 Structured outputs

`output_config.format` makes the response schema-valid by construction. It deletes all four
`text.match(/\[[\s\S]*\]/)` regexes **and** the partial-JSON salvage branch that causes F2,
and it trims output tokens by removing the prose wrapper. Note it is incompatible with
citations, which nothing here uses.

### 10.5 Downscale images before encoding

Image tokens ≈ `(width × height) / 750`. A 4000 px phone photo of a payment confirmation
costs several times what a 1568 px one does, at identical accuracy — 1568 px on the longest
edge is the point above which there is no further gain. Applies to
`payments.screenshot_scan` and to photo uploads on `brand_stock.catalogue_parse`.

### 10.6 Considered and rejected for now

- **Batch API** (50% off) — both user-facing flows have a person waiting on the result.
  Not applicable until something runs unattended, and per CLAUDE.md nothing here may be a
  scheduled job.
- **A cheaper-model cascade** — one model means one cache namespace; a cascade forfeits cache
  reuse across its models. Measure §10.2 first.

---

## 11. Order

| Phase | Work | Blocked by |
|---|---|---|
| **0** | `src/lib/ai.ts` + `src/lib/ai/tasks.ts` — wrapper, adapter, logging. No schema yet; reads the env key still. Closes F4, F6, F7. | Q1 |
| **1** | Schema: the three models, migration, seed from `AI_TASKS` | **Q2**, schema-reviewer |
| **2** | Migrate the four call sites. Model strings leave application code (§10.1 lands here). | Owner sign-off on the `bank-statements` diff |
| **3** | `settings_ai` module + `/settings/ai` — providers, routing, spend | — |
| **4** | Optimisation: caching (§10.2), structured outputs (§10.4), image downscale (§10.5) | — |

### 11.1 This plan should probably not go first

The audit's **Phase 1 (F1, F2, F3)** is live silent data loss: bank statements truncated at
50,000 characters, partial JSON stored as complete, and a catalogue over ~70 items told the
document is at fault. Those corrupt the accounting and purchasing modules **today**.

This plan is architecture. It makes the next year cheaper and measurable; it does not stop
anything currently going wrong. **Recommendation: F1/F2/F3 first, this second** — with the
exception of §10.1, the model-string fix, which is two lines and can ride along with
anything.

See Q1.

---

## 12. What this plan deliberately does not do

- **No second provider adapter.** §6.1.
- **No cron, no `setInterval`, no scheduled route.** CLAUDE.md forbids it; the spend
  dashboard loads on mount and refreshes when a person asks, like every other screen.
- **No permissions in the JWT.** `settings_ai` is read per request like every other grant.
- **No AI writing to the ledger, setting a price, or acting without a human.** Unchanged from
  the audit's §7.5.
- **No fix for F1.** §7.
- **No removal of `@google/generative-ai`.** Audit Q14 puts it with the other dead packages.

---

## 13. Questions

### Blocking

**Q1. Does this plan run before or after the audit's Phase 1 (F1/F2/F3)?**
*Recommendation:* after — §11.1. Data loss outranks architecture.
*Blocks:* the whole ordering.

**Q2. Plaintext API key in the database, or AES-256-GCM with a new `CONFIG_ENCRYPTION_KEY`?**
*Recommendation:* **plaintext + masking**, matching `StorageConfig` and `IntegrationConfig`
(§3). Encrypting one table while the AWS keys and the Zoho refresh token beside it stay
plain buys little and adds a boot-critical secret.
*Blocks:* §4, and the shape of the write route in §8.1.

### Non-blocking

**Q3. Should a disabled task fall back to code, or fail?**
*Default:* fail loudly with a message naming the task. A silent fallback to a worse path is
how F3 became a misleading error message in the first place.

**Q4. How long is `AiCallLog` kept?**
*Default:* forever. Four low-volume call sites; it will not grow to a size worth pruning, and
there is no cron to prune it with.

**Q5. Should `/settings/ai` expose a free-text model field, or a fixed dropdown?**
*Default:* dropdown from a code list. A typo'd model ID is a 400 at the worst moment, and the
`effort` validation in §5.2 needs to know the model's capabilities anyway.

**Q6. Per-task `maxDuration`?**
`bank-statements` currently declares none while making two calls (F8).
*Default:* set it per route by hand, not from the database — it is a build-time export in
Next.js and cannot be read from a row.

**Q7. 30-second TTL cache, or a database read per request?**
§2.2. The TTL matches `storage`; the per-request read matches `integrations`, which chose it
so a revoked credential dies immediately.
*Default:* 30 s TTL + invalidate-on-write. A half-minute delay on disabling a task is
acceptable; if it is not, the per-request read costs ~2 ms against a ~3,000 ms call.

### Answer log

| Q | Question | Answer | Decided on |
|---|---|---|---|
| Q1 | Order vs. audit Phase 1 | | |
| Q2 | Plaintext or encrypted key | | |
| Q3 | Disabled task: fall back or fail | | |
| Q4 | `AiCallLog` retention | | |
| Q5 | Model field: dropdown or free text | | |
| Q6 | Per-task `maxDuration` | | |
| Q7 | TTL cache or per-request read | | |

---

## 14. Verification

Per AGENTS.md, after every phase:

```
npm run build
```

Note the build needs a reachable database (CLAUDE.md) — start Postgres first — and
`prisma generate` fails with `EPERM` while the dev server holds the query engine, so the
server is stopped before the Phase 1 migration.

Manual passes, none of which the build can substitute for:

| Check | Phase |
|---|---|
| Upload a brand PDF; confirm items parse and one `AiCallLog` row appears with sane token counts | 2 |
| Scan a payment screenshot; confirm the form pre-fills as before | 2 |
| Open `/settings/ai` as a **non-admin** — the only test that proves the guard | 3 |
| Confirm the network response for the config GET contains **no key**, in any form | 3 |
| **Save the form without touching the key field, then run a call.** §3.2 — this is the round-trip bug, and a green build will not catch it | 3 |
| Switch one task's model, wait 30 s, confirm the next call logs the new model | 3 |
| Activate a provider with a deliberately wrong key; confirm the switch is **refused**, not applied | 3 |
| Pick Haiku with an effort value; confirm the form prevents it rather than the API 400ing | 3 |
| After §10.2, confirm `cacheReadTokens` is non-zero on the second identical upload | 4 |

The last row is the acceptance test for prompt caching. A zero there means the prefix is
being invalidated and the change delivered nothing.
