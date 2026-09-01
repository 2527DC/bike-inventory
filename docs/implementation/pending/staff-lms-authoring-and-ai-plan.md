# Staff LMS — the authoring screens are wired to routes that do not exist

Status: pending — **Part A is a bug fix and is unblocked.** Parts B and C carry open questions
in §7; Part D (AI) needs a decision before any code.
Branch: **`fix/lms-authoring`** — create it with exactly this name.
Prepared 31 Aug 2026. Every path below was checked against the tree.

---

## 1. The reported symptoms, and what they actually are

> *"Failed to load user (400)" on /services/counter, and I can't create courses — I think we
> don't have the action and related permission for it.*

**The permissions are not the problem.** `staff_lms_learning` already carries
`view / create / edit / delete / approve`, ADMIN holds all of them, and
`POST /api/staff-lms/learning/courses` is implemented and properly guarded:

```ts
export const POST = guarded("staff_lms_learning", "create", "staff-lms:courses", async (...) => {
  const data = lmsCourseSchema.parse(await readBody(req));
  const created = await prisma.lmsCourse.create({ data });
```

Course creation works. **Nothing can reach it.** Three separate defects, none of them RBAC.

### 1.1 `/api/auth/me` does not exist — this is the 400

Three screens fetch it: `services/counter`, `services/mechanic`, `services/assembly`.

`src/app/api/auth/` contains only `[...nextauth]/` and `mobile-login/`. So `/api/auth/me`
falls through to the NextAuth **catch-all**, which does not recognise `me` as an action and
answers **400** — exactly the number in the error. It is not an auth failure, and no
permission change will fix it.

### 1.2 Seven of the eight LMS admin API paths are wrong

The admin screens were ported from the standalone app; their API paths were never updated to
this codebase's `learning/` and `manage/` structure.

| The screen calls | Exists? | The real route |
|---|---|---|
| `/api/staff-lms/courses` | ✗ | `/api/staff-lms/learning/courses` |
| `/api/staff-lms/videos` | ✗ | `/api/staff-lms/learning/videos` |
| `/api/staff-lms/announcements` | ✗ | `/api/staff-lms/manage/announcements` |
| `/api/staff-lms/daily-tips` | ✗ | `/api/staff-lms/manage/tips` |
| `/api/staff-lms/scenarios` | ✗ | **nothing** — no route at all |
| `/api/staff-lms/settings` | ✗ | **nothing** |
| `/api/staff-lms/admin` | ✗ | **nothing** |
| `/api/staff-lms/products` | ✓ | correct |

So every authoring screen 404s on load and on save. There are **38 LMS API routes** and the
authoring UI reaches one of them.

### 1.3 The admin screens are in no module, so nothing links to them

`/staff-lms/admin` and its ten children have no row in `prisma/rbac-catalog.ts`. The sidebar
renders `getAccess().modules`, so they are reachable only by typing the URL — the same class
of problem as `/more/label-designer` and `/brand-stock/upload`.

### 1.4 A fourth thing, found while reading: the LMS has its own auth

`src/lib/auth.ts:127` exports a **second** `getCurrentUser`, unrelated to the one in
`auth-helpers.ts`, and the LMS pages import that one:

```ts
const role = u.role || (roleKey === "ADMIN" || roleKey === "STAFF_LMS_ADMIN" ? "admin" : "staff");
```

That is a **role-name comparison**, which CLAUDE.md bans outright, and it reads `roleKey` off
the **session token** rather than the database. Two consequences:

- The LMS decides "admin vs staff" from a token claim, not from a permission. An admin who
  grants `staff_lms.approve` changes nothing.
- Since the token's `roleKey` is now written only at sign-in (the per-request refresh was
  removed in `perf/single-auth-query-v2`), a user promoted mid-session stays `staff` in the
  LMS until they sign out and back in. **This corrects a claim made in that plan** — it said
  nothing authorises on the token's role; this does.

---

## 2. Part A — make the existing authoring work (no new features)

1. **Add `GET /api/auth/me`**, or point the three service screens at `/api/my-permissions`,
   which already returns `{ user, role, permissions, modules }` behind `requireAuth`.
   Prefer the second: one fewer endpoint, and it is already the "who am I" route.
   Those screens also use raw `fetch` + `res.json()`, which CLAUDE.md bans — convert them to
   `apiFetch` in the same pass.
2. **Correct the eight admin paths** in §1.2. Five are a rename; three name routes that were
   never built and must either be built or have their screens removed (§7 Q1).
3. **Add the modules** so the authoring screens are reachable: one `staff_lms_admin`
   sub-module under `staff_lms`, guarded on `staff_lms_learning.create`. Seed before guarding
   anything on it — `userCan` answers false for an unknown key, ADMIN included.
4. **Replace the role-name check** in `src/lib/auth.ts` with a permission check, and delete
   the duplicate `getCurrentUser` so there is one identity function in the codebase.

Part A ships no new capability. It makes what already exists usable.

---

## 3. What a course actually consists of — the data you asked about

Four levels, each a table, cascading on delete:

```
LmsCourse          title, description, isActive
  └ LmsCourseLevel   title, description, sortOrder, weekNumber, brandFocus
      └ LmsLesson      title, description, sortOrder, youtubeUrl,
                       keyPointers (JSON array), checklist (JSON array), xpReward (default 30)
          └ LmsLessonQuestion  question, options (JSON), correctIndex, explanation, sortOrder
```

So one lesson = a YouTube link, a list of key points, a checklist, an XP value, and its
questions. `weekNumber` and `brandFocus` on the level are how a course becomes a weekly
programme for a specific brand.

Around that sit 17 more tables, all already migrated: `LmsQuiz` / `LmsQuizQuestion` /
`LmsQuizAttempt`, `LmsWeeklyTest` / `LmsWeeklyTestQuestion`, `LmsVideo` / `LmsVideoCategory`,
`LmsProduct` (product learning), `LmsScenario` (practice), `LmsAchievement` /
`LmsUserAchievement`, `LmsProgress`, `LmsLessonProgress`, `LmsActivityLog`,
`LmsAnnouncement`, `LmsDailyTip`.

**The schema is complete. The authoring UI is what is missing** — and mostly it exists too,
just disconnected.

---

## 4. Part B — product learning authoring

`/staff-lms/product-learning` and `/api/staff-lms/products` both work, and
`staff_lms_products` carries full CRUD. What is absent is the create/edit screen: today
`LmsProduct` rows can only be made by a seed.

Model this on `/more/categories`: list, create, inline edit, delete-with-refusal. No new
API is needed beyond the verbs `/api/staff-lms/products` is missing.

---

## 5. Part C — practice and scenarios

`LmsScenario` exists; `/api/staff-lms/scenarios` does not. The practice screen has no source
of scenarios other than a seed. Building the route + an authoring screen is the same shape as
Part B and can follow it.

---

## 6. Part D — AI generation, and the vector-database question

You asked about a vector DB and AI for the LMS. Here is my honest read, in the order the
decisions matter.

### 6.1 You almost certainly do not need a vector database

Vector search earns its complexity when you have a large corpus and need *semantic* retrieval
— "find me passages about X" across thousands of documents. Your corpus is a few hundred
products and a handful of courses, and every lookup you have described is by **name, brand or
category**, which is exact-match territory.

Postgres already does this well: `pg_trgm` for fuzzy name matching and `tsvector` for
full-text, both on the database you already run. **Start there.** If retrieval quality
genuinely fails, `pgvector` is a Supabase extension — still no new service, no new bill, no
second copy of your data to keep in sync. A dedicated vector database (Pinecone, Weaviate,
Qdrant) is a third datastore to operate and would be hard to justify at this size.

**One thing to know before planning embeddings at all: Anthropic's API does not provide an
embeddings endpoint.** Claude generates text; it does not vectorise it. Any vector approach
means a second provider for the embedding model, which is another key, another bill and
another dependency — and it is a real argument for exhausting Postgres first.

### 6.2 Where AI genuinely pays here: generating the content

The tedious part of an LMS is not retrieval, it is writing 200 quiz questions. That is a
strong fit, and this project already has `@anthropic-ai/sdk` (^0.90.0) installed and calling
Claude in `payments/parse-screenshot`.

Concretely: given a product row (name, brand, specs, price) or a lesson's key points, ask
Claude for N questions with options, `correctIndex` and an explanation — exactly
`LmsLessonQuestion`'s shape — and stage them for a human to approve before they go live.
**Never auto-publish.** The review step is what makes this safe, and it mirrors the pattern
this codebase already uses for the Zoho import.

Three API features make this cheap, and they matter more than the model choice:

| Lever | Why it applies here |
|---|---|
| **Structured outputs** (`output_config.format`) | The response *is* the question rows — no parsing, no repair loop |
| **Prompt caching** | Generating questions for 200 products repeats the same instructions every time; the cached prefix costs ~10% |
| **Batch API** | Bulk generation is not latency-sensitive. 50% off, and a catalogue-wide run is exactly the shape it is built for |

**Model:** `claude-opus-5` ($5/$25 per MTok) is the default and what I would use for content
a person will be taught from. Rough order of magnitude: 200 products at ~1K in / ~1.5K out is
about $8 at list, and closer to $4 through the Batch API — a one-off cost, not a running one.
`claude-haiku-4-5` ($1/$5) exists if that ever turns out to matter, but the difference here is
a few dollars against content quality that staff will be examined on. Note the existing call
in `parse-screenshot` pins `claude-haiku-4-5-20251001` and hand-rolls `fetch` against
`api.anthropic.com` rather than using the installed SDK — worth aligning while here.

### 6.3 What I would not build

- **A chatbot over the course content.** It answers questions the lessons already answer, and
  it is the feature most likely to be used twice and then forgotten.
- **Auto-grading free-text answers.** `LmsLessonQuestion` is multiple choice with a
  `correctIndex`; grading is an array index, and no model is needed.

---

## 7. Open questions

**Q1 — `/staff-lms/admin/scenarios`, `/settings` and `/research` call routes that were never
built. Build them, or delete the screens?** They are unreachable today either way. Deleting
is honest; building is three more routes. **Default: delete, and reopen if the screen is
wanted.**

**Q2 — should the LMS admin be one module or several?** One `staff_lms_admin` sub-module is
simplest; per-area modules (courses, videos, announcements) allow finer grants but add four
more permissions each to manage. **Default: one.**

**Q3 — who may author?** Today the LMS infers admin from a role key. Once that becomes a
permission, is authoring `staff_lms_learning.create` (a content grant) or should it be its
own module? **Default: `staff_lms_learning.create`, which already exists and is already
granted.**

**Q4 — AI generation: opt-in per lesson, or a bulk catalogue run?** Per-lesson is easier to
review and easier to stop; bulk is what makes the Batch API's 50% worthwhile.
**Default: per-lesson first**, bulk once the review flow is proven.

---

## 8. Verification

- `/services/counter`, `/services/mechanic` and `/services/assembly` load with no "Failed to
  load user".
- Every admin screen's fetch returns 200 — check the network tab, not just the absence of a
  visible error, since several of these screens swallow failures.
- Create a course, add a level, add a lesson with two questions, and see it appear at
  `/staff-lms/learning` as a learner.
- A user holding `staff_lms_learning.view` but **not** `create` sees the learner view and is
  refused by the API on save. Testing as ADMIN proves nothing — ADMIN holds everything.
- `npm run build` passes.

## 9. Board of Agents

- `docs/agents/frontend-engineer.md` — the authoring screens, and its own "standard fetch
  pattern" is the banned `fetch().then(r => r.json())`; fix the doc while here
- `docs/agents/backend-engineer.md` — the missing routes, the guard shape, `readBody`/`guarded`
- `docs/agents/database-architect.md` — 21 LMS tables already exist; this plan adds none
