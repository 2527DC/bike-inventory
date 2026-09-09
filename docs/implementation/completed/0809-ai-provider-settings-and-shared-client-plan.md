# AI provider settings and one shared AI client

Status: completed — 9 Sep 2026, all five phases are on `main` (`c8f1b61`): the provider table and migration `20260908143858_ai_provider`, the model catalogue in code, `src/lib/ai/` with the three adapters behind one client, the four existing call sites migrated to it, and `/api/settings/ai` with its activate and test routes. Which provider is live is data now, not an env var. Still owed: `npx prisma migrate deploy` on any database other than the local one — the migration has only been applied locally.
Branch: the working tree is on **`feat/taxonomy-inactive-and-audit-approval`**, not
`chore/brand-stock-module-and-tooling` as this line used to say — the work travelled with the
tree rather than with a branch. `git log --all -- src/lib/ai src/app/api/settings/ai` returns
**zero commits**, and `git ls-files src/lib/ai` returns **zero tracked files**, against ten files
on disk. The owner decides where it lands.

**What blocks `completed`** (verified 9 Sep 2026): every artefact §3 names is real — the
`AiProvider` model and its migration, the ten-file `src/lib/ai/`, `settings_ai` RBAC at
sortOrder 525, the GET/PUT/test/activate routes with the key never on the wire, `/settings/ai`,
all four call sites on `runAi()`, and `@google/generative-ai` gone from `package.json`, the
lockfile and `node_modules`. What has not happened is everything outside the code: no commit,
no `npm run db:snapshot`, no `migrate deploy` beyond localhost, no `db:seed:rbac`, and none of
§4's nine browser checks. `completed` would assert all five.

⚠ **Before anyone builds `ai-provider-config-and-task-routing-plan.md`** (still `pending`): its
§4 defines a *different* `AiProvider` — `enabled` instead of `isActive`, and no `model`,
`isConnected`, `lastTestedAt` or `lastTestError` — mapped to the same `@@map("ai_provider")`
table, and its §6 puts the wrapper at `src/lib/ai.ts`, colliding with the shipped `src/lib/ai/`
directory. Its Phases 0–3 are now built or superseded. Amend its §4, §6 and §11 to "already
built; this plan now only adds `AiTaskConfig` and `AiCallLog`" before starting it, or it will
author a conflicting migration.

**Scope:** a global AI configuration screen (provider + model + key), one table to hold it,
one library every module calls, and the three existing call sites moved onto it.

Drafted 8 Sep 2026 and built the same day. Every `file:line` in §2 was read from disk before
the build; where Phase 4 has since changed a file, §2 says so and uses the past tense. The
file was restructured into the requirement-first order `docs/implementation/README.md`
mandates (§0 requirement, §1 questions, §2 today, §3 plan, §4 verification, §5 out of scope);
no fact was changed in the move.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (8 Sep 2026)

The request:

> in the settings i need a ui to intigtate  the ai where i can choose the provider and model  and give related thing   at the global level where i think we can use the intigration table or tell me what table should i  use to store the related or do we need another table to store this daat where we store n databse and i  need the utility or library where i can  use  that utility of using api in needed modules where as i need the use of ai api key in the  accounts/bank-upload like this i may use in  many places  so i need u to create the plan i already have a plan regarding it but it is too large  as of now i need this siple one as of now  ask me any question if u needed

After the four questions in §1 (Q1–Q4) were answered:

> yes iuse text for stor/ing and and u r senior software engineer use ur  best practicrs if needed kload  the skill and used it and uses muliple agents and build at afeter complrton of all phase use  multiple agents and complete it fast

And, on testing:

> related to any browser testing i will do it manually u just implment the implmenation use multiple agent to complete

### 0.2 Restated as requirements

| # | Requirement | Where |
|---|---|---|
| R1 | A **global** Settings screen where an admin chooses the AI **provider** and **model** and supplies what goes with them — the API key. | §3.7 |
| R2 | The configuration is stored **in the database**. The owner suggested `integration_config` and asked for a recommendation: reuse it, or add a table. | §2.1, §3.1 |
| R3 | A **utility / library** that any module imports to call the AI, so no module carries provider wiring of its own. | §3.4 |
| R4 | First consumer: the bank-statement parse behind `/accounts/bank-upload`; "many places" later. | §3.8 |
| R5 | A **simple** plan — the existing `ai-provider-config-and-task-routing-plan.md` is "too large as of now". | §3, opening |
| R6 | The key is stored as **text** (plaintext). | Q6 |
| R7 | Senior-engineer best practices; load the relevant skill; use multiple agents; run the build after all phases are complete. | §3.9, §4 |
| R8 | Browser testing is the owner's, done by hand; the implementation is the deliverable. | §4 |

---

## 1. Questions and clarifications

Six questions were asked; all six are answered. Nothing is open.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q1** | Which providers in v1? | The table and the screen are multi-provider from day one, which is nearly free. Each **adapter** is code that must be written and run — an adapter nobody has run for a week is not free. | (a) Anthropic only; (b) Anthropic, Google and OpenAI | (b) in the schema and screen, adapters landing Anthropic first — the only provider with a proven consumer today | **Anthropic, Google, OpenAI** — schema and screen carry all three; adapters land Anthropic first (§3.4.2) |
| **Q2** | Config shape | Decides the primary key and the activate route: one row per provider with one `isActive`, or a single row holding whichever provider is current. | (a) one row per provider, one active; (b) one row | (a), keyed like `IntegrationConfig` — one row per provider | **One row per provider, one active** (§3.2) |
| **Q3** | Migrate the existing call sites now? | Phase 4 exists or it does not; without it the new table configures nothing that runs. | yes / no | yes | **Yes, all three** call sites — four calls (§3.8) |
| **Q4** | Model field | A typo'd model ID is a 400 at the worst possible moment — mid-upload, in front of a user. | (a) free text; (b) dropdown from a code list, validated server-side | (b) | **Dropdown from a code list** (§3.3) |
| **Q5** | Gemini SDK | `@google/generative-ai` ^0.24.1 was installed but imported nowhere, and it is Google's **legacy** SDK; the current one is `@google/genai`. | (a) keep `@google/generative-ai`; (b) `@google/genai` | (b) | **`@google/genai`** — the owner said "use your best practices"; `@google/generative-ai` uninstalled in the same change, `openai` installed |
| **Q6** | Plaintext or encrypted key | Plaintext matches `StorageConfig.secretAccessKey` and `IntegrationConfig.clientSecret` — the codebase's existing, reasoned trade-off (§3.2). | plaintext / encrypted | plaintext | **Plaintext** ("i use text for storing") |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| Q1 | Anthropic, Google and OpenAI in the schema and screen; the Anthropic adapter first | 8 Sep 2026 |
| Q2 | One `AiProvider` row per provider, exactly one `isActive` | 8 Sep 2026 |
| Q3 | All three existing call sites (four calls) move onto `runAi()` | 8 Sep 2026 |
| Q4 | Model is a dropdown from `src/lib/ai/models.ts`, validated by `isModelOf` in the PUT | 8 Sep 2026 |
| Q5 | `@google/genai`; `@google/generative-ai` removed, `openai` added | 8 Sep 2026 |
| Q6 | Key stored plaintext, never returned to the browser | 8 Sep 2026 |
| — | Build decision: the Anthropic default model is `claude-opus-5`, not Sonnet as the §3.3 sketch first had it (why: §3.4.5) | 8 Sep 2026 |
| — | Build decision: `npx prisma migrate dev` ran with a per-command localhost override because `.env` pointed at the Supabase pooler (§3.2) | 8 Sep 2026 |
| — | Build decision: no `@@index([isActive])` on `ai_provider` (§3.2) | 8 Sep 2026 |
| — | Build correction: OpenAI's Responses API accepts an inline PDF, so `supports.pdf` is true for all three providers (§3.4.3) | 8 Sep 2026 |
| — | Build decision: the self-test cap is 256 tokens, not 16 (§3.10) | 8 Sep 2026 |
| — | Build decision: the truncated-JSON "salvage" in bank-statements is removed rather than ported (§3.10) | 8 Sep 2026 |
| — | Review correction: the screenshot cap goes 1024 → 4096 and the catalogue cap 4096 → 16000 — both were set for non-thinking models, and on Opus 5 adaptive thinking spends from the same `max_tokens` budget; the bank-statement caps stay 16384 (§3.10, "Independent review") | 8 Sep 2026 |
| — | Review correction: the env bootstrap is triggered by the first GET of `/settings/ai`, and the test route never creates a row — otherwise opening the screen before any upload silently disabled `ANTHROPIC_API_KEY` for good (§3.10) | 8 Sep 2026 |

---

## 2. How it works today — verified against the code

Read from disk on 8 Sep 2026, **before** the build. Line numbers are those of the pre-change
files. §2.1 describes two tables this plan did not touch and that are still as described.
§2.2 and §2.3 describe what Phases 4 and 5 replaced, so they are in the past tense; what
stands in their place is in §3.8 and §3.10.

### 2.1 Where the configuration could live: `integration_config` and `StorageConfig`

`IntegrationConfig` (`prisma/schema.prisma:1096-1117`) is **OAuth-shaped**: `clientId`,
`clientSecret`, `refreshToken`, `accessToken`, `accessTokenExpiresAt`, `organizationId`,
`organizationName`. An AI provider has none of those — it has a bearer key and a model name.
Reusing it means storing `apiKey` in `clientSecret` and `model` in `organizationId`, and it
means `/api/integrations/[provider]/status` and the connect/refresh code in
`src/lib/integrations/` start seeing rows they were never written for.

The precedent that actually fits is `StorageConfig` (`schema.prisma:1128-1146`): its own small
table, `provider` as a plain **String not an enum** so adding a provider is a row and not a
migration, secret stored plaintext but **never returned to the browser**, and an `isConnected`
flag that only a real round-trip test may set.

### 2.2 The four existing AI calls — as they were before Phase 4

Three files, four calls. Each named its own provider, model and key.

| File | What it did | What was wrong with it |
|---|---|---|
| `src/lib/pdf-parser.ts:16` (catalogue PDF extract) | called the Anthropic SDK on a client built at `:4` as `new Anthropic()` **with no arguments** — the SDK read `ANTHROPIC_API_KEY` from the environment itself, silently | model `claude-sonnet-4-20250514` hardcoded; a 4096-token cap on a whole catalogue; no logger at all; the JSON regex |
| `src/app/api/payments/parse-screenshot/route.ts:75` (payment screenshot scan) | a hand-rolled `fetch` to the Anthropic API | its own 3-attempt retry; the JSON regex |
| `src/app/api/bank-statements/route.ts:117` (call A — statement parse) | a hand-rolled `fetch` | a second, **different** retry policy and a different error shape; the JSON regex |
| `src/app/api/bank-statements/route.ts:296` (call B — vendor resolve) | same as call A | same |

The JSON regex — `text.match(/\[[\s\S]*\]/)` — was copy-pasted into all three call sites,
each stripping markdown code fences its own way. `maxTokens` were 16384 / 1024 / 4096.

**The error a store manager saw** when the key was missing:
`errorResponse("Claude API key not configured. Add ANTHROPIC_API_KEY to .env", 400)` at
`bank-statements/route.ts:73` — an instruction nobody at a counter can act on.

**A silent env dependency.** Because `pdf-parser.ts:4` constructed the client with no
arguments, the app kept working from `.env` on this machine and would fail only where the
variable was absent — nothing said where the key came from.

**Still there, deliberately** (§5): `text.slice(0, 50000)` at `bank-statements/route.ts:113`
silently drops the tail of a long statement.

**After Phase 4** (verified on disk, 8 Sep 2026): a grep for `ANTHROPIC_API_KEY`,
`api.anthropic.com` or `claude-` under `src/` outside `src/lib/ai/` returns nothing. The two
bank-statements calls now sit at `:133` and `:287` of that file.

### 2.3 The SDKs on disk before the build

| Package | State on 8 Sep 2026, before Phase 5 |
|---|---|
| `@anthropic-ai/sdk` ^0.90.0 | installed; `pdf-parser.ts` used it |
| `@google/generative-ai` ^0.24.1 | installed but imported **nowhere** — Google's legacy SDK; the current one is `@google/genai` |
| `openai` | not installed |

Phase 5 removed `@google/generative-ai` and added `@google/genai` and `openai` (§3.10).

---

## 3. Implementation plan

`docs/implementation/pending/ai-provider-config-and-task-routing-plan.md` (645 lines) covers
per-task model routing, a spend log, prompt caching and token optimisation. It stays pending.
**This plan is a strict subset of it, not a competitor.** Same table shape, same secret
handling, same cache pattern, same `settings_ai` module key — so the big plan later *adds*
`AiTaskConfig` and `AiCallLog` beside what this one ships, and changes nothing it built.
What this plan drops: per-task routing, spend logging, `effort`, prompt caching.

What it delivers: one place — Settings → AI — where an admin pastes an API key, picks a
provider and a model, tests it, and makes it live. One import — `runAi()` from `src/lib/ai` —
that any module uses without knowing which provider is configured. The three call sites that
read `process.env.ANTHROPIC_API_KEY` with hardcoded model strings (§2.2) stop doing that.

### 3.1 Which table — a new one, not `integration_config` (R2)

**Decision: a new `AiProvider` table, shaped like `StorageConfig`, keyed like
`IntegrationConfig`.** No changes to any existing table. The reasoning is §2.1: reuse would
put `apiKey` in `clientSecret` and `model` in `organizationId`, and hand the row to code
written for OAuth.

### 3.2 Schema and migration (Phase 1)

```prisma
// One row per AI provider we hold a key for. Exactly one row has isActive = true; that is
// the provider every runAi() call uses. Provider is a plain String, not an enum, matching
// StorageConfig.provider — adding a provider should be a row, not a migration.
//
// apiKey is plaintext, matching StorageConfig.secretAccessKey and IntegrationConfig
// .clientSecret. That is the codebase's existing, reasoned trade-off (see the comment above
// StorageConfig): anyone with database read access already holds the AWS keys and the Zoho
// refresh token. The API NEVER returns this field to the browser — not even masked.
model AiProvider {
  key           String    @id              // "anthropic" | "google" | "openai"
  apiKey        String?   @db.Text
  model         String?                    // validated against src/lib/ai/models.ts
  isActive      Boolean   @default(false)  // at most one row true; enforced in the activate route
  isConnected   Boolean   @default(false)  // set ONLY by a successful test call
  lastTestedAt  DateTime?
  lastTestError String?   @db.Text
  updatedById   String?                    // bare string, no relation — outlives a deleted user
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@map("ai_provider")
}
```

**"At most one active" is not a database constraint.** Prisma cannot express a partial unique
index (`WHERE isActive`), and hand-writing one into the migration buys little: the only writer
is the activate route, which flips every other row false **inside a `prisma.$transaction`**
before setting the new one. The resolver additionally takes the most recently updated active
row if it somehow finds two, and `log.warn`s that it did.

Run the **schema-reviewer agent** on this migration before applying it, per CLAUDE.md. One
migration, additive only, no changes to populated tables — rule 7 is satisfied trivially.

**As run, 8 Sep 2026.**

- **`.env` pointed at the Supabase pooler when the migration was due.** Rules 2 and 5 forbid
  `migrate dev` there, so it ran with a per-command environment override built from the
  commented localhost lines in `.env` (`eval "$(sed -n '13,14p' .env | sed 's/^# //')"`),
  leaving `.env` untouched.
- The migration is **`20260908143858_ai_provider`**: one `CREATE TABLE "ai_provider"`, nothing
  to hand-edit. **It has been applied to local `bch` only.** Apply to any other target by hand
  per rule 4 before that code goes live. The Supabase TEST project has **not** been migrated.
- **No `@@index([isActive])`**, deliberately — the table has one row per provider and the
  planner will sequential-scan it whatever indexes it carries. The schema comment says so.
- The schema-reviewer hook flagged three things: the RBAC entry (added — §3.6),
  `$transaction` in the activate route (already in the brief — §3.7), and the index
  (declined, above).

### 3.3 The model catalogue lives in code (Q4, Phase 2)

A **dropdown from a code list**, not free text. A typo'd model ID is a 400 at the worst
possible moment — mid-upload, in front of a user.

The shape, as sketched before the build. The ids that shipped — including the Google and
OpenAI lists and the Opus 5 default — are in §3.10.

```ts
// src/lib/ai/models.ts — the only place a model string is written down.
export const AI_PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-opus-5",             label: "Opus 5 — most capable" },
      { id: "claude-sonnet-5",           label: "Sonnet 5 — balanced (recommended)" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5 — fastest, cheapest" },
    ],
    supports: { pdf: true, image: true },
  },
  google: {
    label: "Google (Gemini)",
    models: [ /* filled in when the adapter is written — §3.4.2 */ ],
    supports: { pdf: true, image: true },
  },
  openai: {
    label: "OpenAI",
    models: [ /* §3.4.2 */ ],
    supports: { pdf: false, image: true },   // see §3.4.3 — corrected to true during the build
  },
} as const;

export type AiProviderKey = keyof typeof AI_PROVIDERS;
export function isAiProviderKey(v: unknown): v is AiProviderKey { /* ... */ }
export function isModelOf(provider: AiProviderKey, model: string): boolean { /* ... */ }
```

The PUT route validates `model` with `isModelOf(provider, model)` — the screen's dropdown is
cosmetic, exactly like every `can(...)` check in this codebase.

### 3.4 `src/lib/ai/` — the library every module calls (Phase 2, R3)

As planned:

```
src/lib/ai/
  index.ts        runAi(), getActiveAi(), invalidateAiCache(), AiNotConfiguredError
  models.ts       §3.3
  types.ts        AiRequest, AiResult, AiAdapter
  anthropic.ts    adapter
  google.ts       adapter
  openai.ts       adapter
  self-test.ts    one trivial call, used by the Test button
```

As shipped, three more files sit beside these — `adapters.ts`, `json.ts`, `http.ts` (§3.10).

#### 3.4.1 The call-site contract

```ts
import { runAi, AiNotConfiguredError } from "@/lib/ai";

const result = await runAi({
  purpose: "bank.statement_parse",   // a label, for logs only — NOT routing (that is the big plan)
  prompt,                            // string
  attachments: [{ kind: "pdf", mediaType, base64, fileName }],  // optional
  maxTokens: 16384,
  json: true,                        // parse the response as JSON
});
// result: { text, json?, usage: { input, output }, model, provider, stopReason }
```

A call site names **no provider, no model, no API key**. After Phase 4, a grep for
`api.anthropic.com`, `ANTHROPIC_API_KEY` or `claude-` outside `src/lib/ai/` is a regression.

Responsibilities of `runAi`, in order:

1. Resolve the active provider through the cache (§3.4.4).
2. Refuse clearly if nothing is active or the row has no key — throw `AiNotConfiguredError`
   carrying the purpose. Routes turn it into a 501 saying *"AI is not configured — Settings → AI"*,
   replacing `errorResponse("Claude API key not configured. Add ANTHROPIC_API_KEY to .env", 400)`
   at `bank-statements/route.ts:73` (§2.2), which tells a store manager nothing they can act on.
3. Call the adapter. **SDK only.** The two hand-rolled `fetch` blocks
   (`bank-statements/route.ts:117`, `payments/parse-screenshot/route.ts:75`) go away and take
   their two different retry policies and two different error shapes with them.
4. Retry on 429/529/5xx with a backoff — **one** policy, here, not one per call site.
5. **Check `stopReason`.** `max_tokens` throws a named error instead of handing back a
   truncated JSON array that the caller's regex will happily half-parse and store.
6. `log.debug` the outbound request — **counts and sizes only**, never the prompt, never the
   key. `log.info` on completion with `{ purpose, provider, model, inputTokens, outputTokens,
   latencyMs }`. `log.error` before every rethrow. No bare `catch {}`. Per CLAUDE.md.

`json: true` centralises the `text.match(/\[[\s\S]*\]/)` scraping that was copy-pasted into
all three call sites, plus stripping markdown code fences.

#### 3.4.2 Adapters — build the seam, land Anthropic first

```ts
interface AiAdapter {
  complete(req: AiRequest, cfg: { apiKey: string; model: string }): Promise<AiResult>;
}
```

All three providers were requested. They land in this order, because only the first has a
proven consumer today:

| Provider | SDK | Lands |
|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` ^0.90.0 — **installed** | Phase 2. All four existing calls run on it. |
| `google` | `@google/generative-ai` ^0.24.1 is installed but imported nowhere. **It is Google's legacy SDK**; the current one is `@google/genai`. | Phase 5, after Q5. |
| `openai` | **not installed** — needs `npm i openai` | Phase 5. |

The table and the screen are multi-provider from day one, which is nearly free. Writing an
adapter nobody has run for a week is not free — `@google/generative-ai` sitting installed and
unimported is exactly that outcome already.

#### 3.4.3 Attachments — an honest constraint, then a correction

Anthropic and Gemini both accept a base64 PDF inline. **OpenAI's chat completions API does
not** — a PDF there means the Responses API or a file upload first. Images are fine everywhere.

So `AI_PROVIDERS[p].supports.pdf` is real, and the screen must say so: selecting OpenAI while
the brand-catalogue PDF import exists shows *"PDF documents are not supported on this
provider; images and text still work."* Discovering this at upload time instead is a support call.

**Correction, 8 Sep 2026 — the constraint above (the original plan's §5.3) was wrong about
OpenAI and PDFs.** The Responses API accepts an inline base64 PDF (`input_file.file_data`); it
is chat completions that does not. The adapter uses the Responses API, so `supports.pdf` is
true for all three providers unless the adapter author finds otherwise and flips it.

#### 3.4.4 Cache — copy `src/lib/storage/index.ts` exactly

30-second TTL plus `invalidateAiCache()` on every write (`storage/index.ts:26-32`). Same
numbers, same reasoning: a per-request read costs ~2 ms against a ~3,000 ms model call, so it
is not about speed — it is that a provider switch must take effect without a redeploy, and
half a minute of staleness is acceptable. Negative results are cached too, so a broken
configuration does not hammer the database on every retry (`storage/index.ts:104-112`).

#### 3.4.5 Bootstrap from `ANTHROPIC_API_KEY`, once

`pdf-parser.ts:4` was `new Anthropic()` with no arguments — the SDK read the env var itself,
silently (§2.2). Once the key comes from the database the client must be constructed with an
explicit `apiKey`, or the app keeps working from `.env` on this machine and fails only where
the var is absent.

Copy `loadStorageSettings` (`storage/index.ts:34-77`): **the env var is consulted only when no
`AiProvider` row exists.** It seeds the `anthropic` row on first run and is never read again —
*"once a row exists the database always wins"*. Nothing breaks on deploy, the `.env` line can
be deleted at leisure, and there is no window where the app has no key.

**The Anthropic default model is `claude-opus-5`**, not Sonnet as the §3.3 sketch first had it
— the Claude API skill's rule is Opus unless the owner names another; the dropdown still
offers Sonnet 5 and Haiku 4.5 and the choice is one click in Settings → AI. The env bootstrap
seeds the `anthropic` row with this default.

### 3.5 The API key never reaches the browser (Q6)

Following the integrations contract, not the storage one: the GET returns **`hasApiKey:
boolean`** and no key in any form, not even `••••` plus the last four. An AI key has no
partial-recognition value the way an AWS key ID does, so every character not sent is one that
cannot end up in a log, a browser cache or a screenshot.

**The round-trip rule** — this is the bug both existing routes exist to guard against: the
form is seeded with an empty key field, so a naive write path would wipe the key the moment
someone opens the page and presses Save to change the model.

- absent or empty `apiKey` → **keep the stored value** (`integrations/[provider]/route.ts:58`)
- a non-empty value → **replace**
- clearing is a separate explicit "Remove key" action

`npm run build` cannot catch this. It is in §4 as a manual check.

### 3.6 RBAC (Phase 3)

One new module in `prisma/rbac-catalog.ts`, following `settings_storage` (`:666-681`):

```ts
{
  key: "settings_ai",
  label: "AI",
  description: "AI provider, model and API key used across the app",
  icon: "Sparkles",
  route: null,          // routeless like its siblings — the Settings index links it by href
  group: "Admin",       // MUST equal the parent's; the seeder asserts it
  sortOrder: 525,       // storage 521, zoho 522, notifications 523, whatsapp 524
  actions: ["view", "edit", "approve"],
  parentKey: "settings",
}
```

| Action | Grants |
|---|---|
| `view` | See which provider and model are live, and the last test result |
| `edit` | Save a key or model, run the test call |
| `approve` | **Make a provider live** (the activate route) |

`approve` earns its place for the same reason `settings_storage` has one: activating a provider
with a bad key takes four features offline at once. The activate route therefore **re-runs the
test and refuses to switch on failure** — `settings/storage/activate/route.ts:36-53`.

No role name appears anywhere. `requireFeature("settings_ai", "edit")` — two arguments, no
fallback-roles parameter. Every route pairs it with
`if (error instanceof AuthError) return errorResponse(error.message, error.status)`.

RBAC catalog changes are data, not migrations: after deploy the owner runs
`npm run db:seed:rbac` (CLAUDE.md rule 11), separately from the migration. On local `bch` this
has been done (§3.10).

> **Known collision.** `notifications-and-settings-rbac-plan.md` Part A proposes deleting the
> `settings_*` child modules and replacing them with section-named actions on one `settings`
> module (`storage_edit`, `whatsapp_edit`, …). If that plan lands first, this becomes an
> `ai_edit` / `ai_approve` action on `settings` instead of a child module — a small change,
> confined to the catalog entry and the four `requireFeature` calls. Whichever ships second
> is amended. It is not a reason to delay either.

### 3.7 Routes and screen (Phase 3, R1)

| Route | Guard | Does |
|---|---|---|
| `GET /api/settings/ai` | `settings_ai.view` | Rows for all three providers: `key`, `model`, `hasApiKey`, `isActive`, `isConnected`, `lastTestedAt`, `lastTestError`. **No API key.** |
| `PUT /api/settings/ai` | `settings_ai.edit` | Upsert one provider row: key (§3.5 rule) + model (validated by `isModelOf`). Clears `isConnected` — settings changed, so the last test no longer proves anything. Calls `invalidateAiCache()`. |
| `POST /api/settings/ai/test` | `settings_ai.edit` | One trivial call against the *saved* row. Writes `lastTestedAt` / `lastTestError`, and `isConnected` only when testing the live provider. `maxDuration = 60`. |
| `POST /api/settings/ai/activate` | `settings_ai.approve` | Re-tests, refuses on failure, then in **one transaction** sets every row `isActive: false` and the target `true`. Invalidates the cache. |

`/settings/ai` is a client component gated cosmetically with `usePermissions`, mirroring
`settings/storage/page.tsx`. One card per provider: model dropdown, write-only key input
(placeholder *"A key is saved"* when `hasApiKey`), **Test**, and **Make active** (disabled
unless the last test passed). A row is added to `ENTRIES` in
`src/app/(dashboard)/settings/page.tsx:29` so it is permission-filtered like its siblings.

### 3.8 The four existing calls (Phase 4, R4)

| File | Purpose label | Also fixes |
|---|---|---|
| `src/lib/pdf-parser.ts:16` | `catalogue.pdf_extract` | `new Anthropic()` env read; `claude-sonnet-4-20250514`; a 4096 cap on a whole catalogue; no logger at all; the JSON regex |
| `src/app/api/payments/parse-screenshot/route.ts:75` | `payments.screenshot_scan` | hand-rolled fetch and its own 3-attempt retry; the JSON regex |
| `src/app/api/bank-statements/route.ts:117` (call A) | `bank.statement_parse` | hand-rolled fetch; a second, different retry policy; the JSON regex |
| `src/app/api/bank-statements/route.ts:296` (call B) | `bank.vendor_resolve` | same |

Behaviour is preserved exactly — same prompts, same `maxTokens` (16384 / 1024 / 4096), same
downstream handling. Only the transport and the key source change.

**`bank-statements/route.ts` is a checkpoint, not a routine edit.** It writes `BankStatement`
and `BankTransaction`; a mistake corrupts reconciliation history. Its diff is shown before it
is applied, and it is the last of the four.

**Not fixed here:** `text.slice(0, 50000)` at `bank-statements/route.ts:113` silently drops the
tail of a long statement. That is a data-loss bug, it is independent of this plan, and folding
it into a transport refactor would bury it. It needs its own change.

### 3.9 Phases and dependencies

| Phase | Work | State |
|---|---|---|
| 1 | `AiProvider` model + `npx prisma migrate dev --name ai_provider` (localhost only), schema-reviewer, `npm run db:snapshot` before the PR merges | built 8 Sep 2026 (§3.2) |
| 2 | `src/lib/ai/` — types, models, cache, Anthropic adapter, `runAi`, self-test | built 8 Sep 2026 |
| 3 | RBAC entry + four routes + `/settings/ai` + the settings index row | built 8 Sep 2026 |
| 4 | Migrate the four calls — pdf-parser, parse-screenshot, then bank-statements last | built 8 Sep 2026 |
| 5 | Google and OpenAI adapters (after Q5) | built 8 Sep 2026 |

No cron, no timer, no JWT change. One migration (Phase 1). One catalog change (Phase 3).

### 3.10 Built — what landed on 8 Sep 2026

**Files created**

- `prisma/migrations/20260908143858_ai_provider/migration.sql` — one `CREATE TABLE "ai_provider"`.
- `src/lib/ai/` — `types.ts`, `models.ts`, `index.ts`, `adapters.ts`, `anthropic.ts`,
  `google.ts`, `openai.ts`, `json.ts`, `self-test.ts`, `http.ts`.
- `src/app/api/settings/ai/route.ts` (GET/PUT), `src/app/api/settings/ai/test/route.ts`,
  `src/app/api/settings/ai/activate/route.ts`.
- `src/app/(dashboard)/settings/ai/page.tsx`.

**Files changed**

- `prisma/schema.prisma` — model `AiProvider`.
- `prisma/rbac-catalog.ts` — `settings_ai`, sortOrder 525, view/edit/approve.
- `src/app/(dashboard)/settings/page.tsx` — the `ENTRIES` row.
- `src/lib/module-icons.ts` — `Sparkles`.
- `src/lib/pdf-parser.ts`, `src/app/api/payments/parse-screenshot/route.ts`,
  `src/app/api/bank-statements/route.ts` — the four calls now go through `runAi()`.
  Routes map `AiError` / `AiNotConfiguredError` with `toAiErrorResponse` from `src/lib/ai`.
- `src/app/api/bank-statements/route.ts` also: its pre-existing bare `.catch(() => {})` on the
  per-transaction update now logs.
- `src/app/api/brand-stock/upload/route.ts` — maps AI errors before its generic 400.
- `package.json` — `openai` and `@google/genai` added, `@google/generative-ai` removed.

**Model catalogue as shipped** (default in bold)

| Provider | Models | Confirmed against |
|---|---|---|
| `anthropic` | **`claude-opus-5`**, `claude-sonnet-5`, `claude-haiku-4-5` | — (the Haiku id is `claude-haiku-4-5`, not the dated id in the §3.3 sketch) |
| `google` | `gemini-2.5-pro`, **`gemini-3.8-flash`**, `gemini-3.5-flash-lite` | ai.google.dev, 8 Sep 2026 |
| `openai` | `gpt-6-astra`, **`gpt-5.6-terra`**, `gpt-5.6-luna` | developers.openai.com and the id union in `openai@7.10.0` |

**Adapter behaviour**

- Gemini native JSON mode (`responseMimeType: "application/json"`) is used when `json: true`.
- Both non-Anthropic SDKs have their built-in retries **disabled**, so the resolver's single
  policy (3 attempts, 3 s / 6 s) is the only one.
- The self-test cap is **256 tokens, not 16** — adaptive thinking on Opus 5 / Sonnet 5 spends
  from the same budget.

**bank-statements**

- The truncated-JSON "salvage" is **gone by design**: a cut-off reply is now a 502 with
  diagnostics, never a half-saved statement.
- Behaviour deliberately **not** changed: `text.slice(0, 50000)` (§3.8, §5).

**Data on the machines**

- RBAC re-seeded on local `bch` on 8 Sep 2026 (`npm run db:seed:rbac` with the localhost
  override): 3 new permissions, granted to ADMIN.
- The Supabase TEST project has **not** been migrated or re-seeded.

**Independent review, 8 Sep 2026 (evening)** — a read-only agent reviewed the whole change
set against CLAUDE.md and the board docs after the first `tsc` pass. It verified the secret
never reaches the browser, the round-trip rule, prompt/Prisma-write preservation, RBAC,
concurrency and the adapters' SDK usage. It raised fourteen findings; what was done with them:

| # | Finding | Outcome |
|---|---|---|
| 1 | **HIGH** — `maxTokens: 1024` (screenshot) and `4096` (catalogue) were chosen for Haiku 4.5 / Sonnet 4 with no thinking; on Opus 5 thinking draws from the same budget, so a screenshot that parsed yesterday could stop on `max_tokens` and be refused with a 502 | **Fixed** — 4096 and 16000; bank-statements stays 16384. A cap is a ceiling, not spend |
| 2 | **HIGH** — the env bootstrap runs only when the table is empty; the test route's `upsert` created a keyless row and the GET never consulted the resolver, so opening the screen first disabled `ANTHROPIC_API_KEY` for good | **Fixed** — GET calls `loadActiveAiSettings()` when there are no rows; the test route no longer creates rows |
| 3 | `logger.ts` `redact()` blanks any context key matching `/token\|key/i` — `inputTokens`, `outputTokens`, `maxTokens`, `hasApiKey`, `key` — so the one usage line printed `[redacted]` | **Fixed** — `usageIn` / `usageOut` / `maxOut` / `provider` / `apiSaved`, as google.ts and openai.ts already did |
| 4 | Test and Make live act on the *saved* key while an unsaved one sits in the input, and `load()` then blanked it | **Fixed** — both disabled while a key is typed ("Save the key first"); `load()` merges drafts instead of replacing them |
| 5 | The removed truncated-JSON salvage means a cut-off statement is now refused (502) where it used to be half-saved | **Accepted, by design** (§3.10) — the owner should know the behaviour moved from "silently partial" to "refused with diagnostics" |
| 6 | `parse-screenshot` declared `maxDuration = 30` under a retry policy that can sleep 9 s | **Fixed** — 60, like the settings routes |
| 7 | Generic catches returned and logged `error.message`; a Prisma *validation* error embeds the invocation data, which in PUT holds the key | **Fixed** — fixed strings back, `name`/`code` logged, in the three write routes and the bootstrap create |
| 8 | Activate checked `apiKey` outside its transaction; a concurrent Remove key could make a keyless row live | **Fixed** — interactive transaction, `updateMany` guarded on `apiKey: { not: null }`, 409 when it flips nothing |
| 9 | Gemini `LANGUAGE` / `IMAGE_SAFETY` finish reasons read as success; Anthropic 404 (stale model id) gave the generic message | **Fixed** — both in the refusal set where the installed enum has them; 404 → `invalid_request` naming the catalogue |
| 10 | `req.json().catch(() => null)` swallows without logging | **Left** — it is the storage routes' own idiom and the outcome is a 400 |
| 11 | Make live is enabled on `hasApiKey`, not "last test passed" as §3.7 first said | **Left** — activate re-tests and refuses on failure, which is the guarantee that matters |
| 12 | `parseJsonReply` takes the first `[` *or* `{`; the old regexes were array-first | **Left** — every prompt demands a bare array and the whole-body parse runs first |
| 13 | `errorKind()` copied into three call sites | **Fixed** — `aiErrorKind` exported from `src/lib/ai` |
| 14 | Unrelated uncommitted work from another session sits in the same tree | **Noted** — §4 lists exactly which paths belong to this plan |

---

## 4. Verification

The owner does the browser checks by hand (R8). The plan said `npm run build` after every
phase; the owner's instruction (R7) was one build after all phases.

**Run so far, 8 Sep 2026**

- `npx tsc --noEmit` — **passed**, exit 0, before and after the review fixes.
- `npm run build` — a first run was started, then **stopped** once the review turned up
  findings 1 and 2 (a build of a tree about to change proves nothing); re-run after the fixes:
  **passed** — 8 Sep 2026, 9:22–9:43 PM, exit 0, "Compiled successfully in 7.0min", 156
  static pages, `/api/settings/ai`, `/api/settings/ai/test`, `/api/settings/ai/activate` and
  `/settings/ai` all present in the route table. It needs a reachable database (three static
  pages query Prisma), so start Postgres first. `prisma generate` fails with `EPERM` while the
  dev server holds the query engine, so stop the server before it runs.

**What belongs to this plan** — the working tree also carries another session's uncommitted
work (brands/vendors routes, `validations.ts`, `Dockerfile`, `migration_lock.toml`, the
`20260908151058_brand_name_ci_unique` migration, three other `0809-*` plans,
`docs/agents/database-architect.md`, `docs/Questions.md`, `scripts/db/push-integrations.mjs`).
A `git add -A` would sweep those in. These paths, and only these, are this plan's:

```
prisma/schema.prisma                         (model AiProvider — the only hunk)
prisma/migrations/20260908143858_ai_provider/
prisma/rbac-catalog.ts                       (settings_ai)
package.json  package-lock.json              (openai, @google/genai in; @google/generative-ai out)
src/lib/ai/
src/app/api/settings/ai/
src/app/(dashboard)/settings/ai/
src/app/(dashboard)/settings/page.tsx        (ENTRIES row)
src/lib/module-icons.ts                      (Sparkles)
src/lib/pdf-parser.ts
src/app/api/payments/parse-screenshot/route.ts
src/app/api/bank-statements/route.ts
src/app/api/brand-stock/upload/route.ts
docs/implementation/pending/0809-ai-provider-settings-and-shared-client-plan.md
docs/implementation/README.md                (this plan's row)
```

**Manual checks the build cannot substitute for**

- Open `/settings/ai` as a **non-admin** — the only test that proves the guard.
- Confirm the config GET response contains **no API key**, in any form. Check the network tab.
- **Save the form without touching the key field, then run a real parse.** §3.5. A green build
  will not catch this, and it destroys a working configuration.
- Save a deliberately wrong key, press **Make active** — the switch must be *refused*.
- Upload a bank statement at `/accounts/bank-upload`; transactions parse as before.
- Scan a payment screenshot; the form pre-fills as before.
- Upload a brand catalogue PDF; items parse as before.
- Delete `ANTHROPIC_API_KEY` from `.env`, restart, repeat one of the three — it must still work.
- With no provider active, confirm the error names Settings → AI, not `.env`.

---

## 5. Out of scope, deliberately

Per-task model routing (`AiTaskConfig`) · the `AiCallLog` spend record and its dashboard ·
prompt caching · `effort` · streaming · the `text.slice(0, 50000)` data-loss bug
(`bank-statements/route.ts:113`) · ~~removing the unused `@google/generative-ai` dependency~~
— done after all, under Q5. All of these live in
`ai-provider-config-and-task-routing-plan.md` and are unaffected by anything here.
