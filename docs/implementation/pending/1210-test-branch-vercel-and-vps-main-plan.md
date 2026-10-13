# A `test` branch deploys to Vercel (the test stage); `main` deploys to the VPS (production), by hand only

Status: in-progress — Phase A built 13 Oct 2026 on `test`; Phase B (Vercel switch, PR `test` → `main`) follows with the owner's approval.
Branch: **`test`** — cut from `origin/main` (`1bb6c5a`) on 13 Oct 2026, at the owner's instruction. Reaches `main` by a PR from `test`.

Every `file:line` below was read from disk on 12 Oct 2026. The Vercel and GitHub facts were read
the same day with `vercel api` and `gh api`. Both were reads only; nothing was changed.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (12 Oct 2026)

> i need u to create a test  branch where the versel must use the test branch for deployment where not the main branch  where tets branch with versel for test related domain and  the production means the main branch wher  the manula triggere fo deployemnt ot teh vps is made

### 0.2 Restated as requirements

1. **R1** — A long-lived **`test`** branch exists on GitHub.
2. **R2** — **Vercel deploys from `test`**, and no longer from `main`.
3. **R3** — The Vercel deployment of `test` is served on the **test domain**.
4. **R4** — **Production is `main`.** The VPS is deployed from `main` only, and only when a
   person triggers it by hand.

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Recommended | Answer |
|---|---|---|---|---|---|---|
| Q1 | R3 | Which domain serves the test site? | Whether a domain or DNS record is added | (a) keep `bike-inventory-delta.vercel.app` (b) a new `*.vercel.app` name (c) a custom subdomain | (a) | **(a)** |
| Q2 | R4 | How strictly is the VPS locked to `main`? | A check in the workflow vs moving secrets | (a) a check in the workflow that fails on any branch except `main` (b) (a) plus a GitHub Environment allowed only for `main`, with the four VPS secrets moved into it | (a) | **(a)** — the gap is accepted (§2.3) |
| Q3 | — | How does work move between branches? | What CLAUDE.md tells the next session to do | (a) feature → PR into `test` → check on Vercel → PR `test` → `main` → manual VPS deploy (b) separate PRs into both (c) `main` first, `test` follows | (a) | **(a)** |
| Q4 | — | Is `test` PR-only like `main`? | Whether the local git hook gains a deny rule | (a) yes (b) no, direct pushes allowed | (a) | **(b)** — `test` can be pushed to directly |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 12 Oct 2026 | Q1 | Keep `bike-inventory-delta.vercel.app`. |
| 12 Oct 2026 | Q2 | A check in the workflow only. No GitHub Environment, no secrets moved. |
| 12 Oct 2026 | Q3 | feature → `test` → `main`. |
| 12 Oct 2026 | Q4 | `test` is **not** protected. Direct pushes from local are allowed. |
| 13 Oct 2026 | — | *"commit and push it to the test respected branch"*. Phase A is built on `test` itself rather than on a chore branch. It reaches `main` by a PR from `test` into `main`, which is the Q3 flow. |

Defaults taken without asking. Each can be reversed:

- **Vercel's Production Branch becomes `test`**, rather than `test` being built as a Preview.
  Every Vercel env var is on the Production target, and `NEXT_PUBLIC_SUPABASE_*` exist **only**
  there (§2.1). The domain follows Production. Switching the branch moves both with nothing to copy.
- **The GitHub default branch stays `main`.** The "Run workflow" dropdown opens on the default
  branch, so a VPS run starts on the one branch the check allows. The downside: a new PR opens
  against `main` by default, so feature PRs need `--base test`.
- ~~`test` is cut from `main` after this PR merges.~~ Superseded 13 Oct 2026 (§1.1). `test` is
  cut from `origin/main` now and carries Phase A as its first commit.

---

## 2. How it works today — verified

### 2.1 Vercel (project `testing-bch-ops`, team `2527dcs-projects`)

- `vercel.json:5-10` — `git.deploymentEnabled` is `{ "**": false, "main": true }`. Only `main`
  builds. This was set by plan 2809 (`2809-profile-page-push-enrolment-and-vercel-production-only-plan.md`
  §3 Part A).
- `vercel api /v9/projects/testing-bch-ops`: `link.productionBranch` = **`main`**.
- `vercel api /v9/projects/testing-bch-ops/domains`: one domain, **`bike-inventory-delta.vercel.app`**,
  `gitBranch: null`. It follows whichever deployment is Production.
- `vercel api /v10/projects/testing-bch-ops/env` (names and targets only):
  - production + preview: `NEXTAUTH_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `R2_*`,
    `CRON_SECRET`, `LOG_LEVEL`, `NEXT_PUBLIC_LOG_LEVEL`
  - production only: `NEXT_PUBLIC_SUPABASE_UR`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - preview only: `DIRECT_URL`
- `scripts/vercel-build.mjs:35-38` — `prisma generate → next build`. It applies no migrations.
  This plan does not change that.

### 2.2 VPS (`.github/workflows/deploy-vps.yml`)

- `:114-115` — `on: workflow_dispatch:` with no inputs. It is manual already. **R4's "manual
  trigger" part is already true.**
- `:5-7` — "pick the branch ▸ Run. The branch chosen in that dropdown is what gets built and
  shipped." `:147-148` checks out that ref. **Nothing checks which branch it is.** Any branch can
  be deployed to production.
- `:8-10` — the comment calls Vercel "the testing/staging deploy" and says "a push triggers
  Vercel". That stays true after this change, but for `test` instead of `main`.
- Jobs chain `build → migrate → deploy` with `needs:` (`:233`, `:484`). A failure in `build`
  therefore stops the database and the server from being touched.
- `gh run list`: the last 5 runs (3 to 7 Oct) were all from `main`.

### 2.3 The gap Q2 accepts

`workflow_dispatch` runs the workflow file **as it exists on the chosen branch**. The new check
protects `main`, `test` and every branch cut after this merges. A branch cut **before** it still
carries the old file without the check, and could still be picked and deployed. Examples are
`feat/2509-vendor-issue-restore` (PR #65) and this session's
`fix/1210-push-integrations-same-db-check` (PR #76). Q2 (b) would close this gap. It was
declined.

### 2.4 CI and the local git hook

- `.github/workflows/typecheck.yml:22-24` — `on: pull_request` with **no branch filter**. A PR
  into `test` already runs Type check and Build. Only the comment at `:3-4` says "targeting main".
- A **direct push** to `test` (Q4) runs no GitHub CI. Vercel's own build is the only check.
- `.claude/hooks/ask-git-npm.js:100, 130` — denies only `main`/`master`. `test` is unaffected,
  which is what Q4 asks for. No change.

### 2.5 GitHub

- Default branch `main`. **No branch protection** on any branch. **No `test` branch** yet.
- Open PRs: #76 and #65, both based on `main`.

---

## 3. Implementation plan

### Phase A — code, committed on `test`

| # | File | Change | Req |
|---|---|---|---|
| A1 | `vercel.json` | `"main": true` → `"test": true`. `"**": false` stays, so `main` and every other branch stop building. | R2 |
| A2 | `.github/workflows/deploy-vps.yml` | A new **first step of the `build` job**, "Refuse any branch but main": if `$GITHUB_REF` is not `refs/heads/main`, it prints `::error::` with the branch name and the reason, then exits 1. Because of the `needs:` chain, migrate and deploy never start. A failed step was chosen over a job-level `if:` because a skipped run looks green in the Actions list. | R4 |
| A3 | same file, header `:3-10` | Rewrite "pick the branch" to say the run is from `main` only. Note that Vercel deploys `test`. Record the §2.3 gap in one line. | R4 |
| A4 | `.github/workflows/typecheck.yml:3-4` | Comment: PRs "targeting main **or test**". No behaviour change; the trigger already covers both. | — |
| A5 | `CLAUDE.md` | A short **"Branches and deployments"** section under *Architecture you must not break*: `test` → Vercel (`bike-inventory-delta.vercel.app`, test DB); `main` → VPS, manual, from `main` only; work flows feature → `test` → PR → `main`; feature PRs use `gh pr create --base test`; `test` may be pushed to directly, `main` never. | R1–R4 |

No application code, schema, migration, or RBAC catalog change. No `src/` file is touched, so the
logging rule has nothing new to cover. The workflow check reports through `::error::`, which is
how the rest of `deploy-vps.yml` reports. Board of agents: none of the eight covers deployment
configuration, so none applies.

### Phase B — outward-facing steps, each run only with the owner's approval at that moment

| # | Step | How | Req |
|---|---|---|---|
Order changed 13 Oct 2026 (§1.1): `test` is pushed first, carrying Phase A.

| # | Step | How | Req |
|---|---|---|---|
| B1 | Commit Phase A on `test` and push `test`. | `git commit`, then `git push -u origin test` (approval prompts). `-u` also moves the branch's upstream off `origin/main`, which `git checkout -b test origin/main` had set. | R1 |
| B2 | Switch Vercel's **Production Branch** `main` → `test`. | Claude tries `vercel api` (`PATCH /v9/projects/testing-bch-ops`). If the API does not accept the field, the owner uses the dashboard: Project → Settings → Environments → Production → Branch Tracking → `test` → Save. | R2, R3 |
| B3 | Confirm the setting. | `vercel api /v9/projects/testing-bch-ops` → `productionBranch: "test"`. | R2 |
| B4 | A PR from `test` into `main`; the owner merges it. From then on `main` builds nothing on Vercel. | `gh pr create --base main --head test` (approval prompt). | R2, R4 |

**The push in B1 builds one Preview.** Vercel's Production is still `main` when `test` arrives,
and `test`'s `vercel.json` allows it, so Vercel builds `test` once as a **Preview**. It is
harmless, but the owner deleted every Preview on 28 Sep, so Claude offers to remove it.

**Until B4 merges, `main` still builds on Vercel.** `main`'s own `vercel.json` says
`"main": true`. After B2, a merge into `main` before B4 would build `main` as a Preview.

**No forced redeploy.** `test` equals `main` plus Phase A, which changes no app code. The live
test site already runs the same app. The first Production build from `test` happens on the next
push to it after B2.

---

## 4. Verification

1. `npm run build` passes on the branch. The workflow YAML parses locally.
2. **R2:** after B2–B4, push a commit to `test`. Vercel shows a **Production** deployment from
   `test`. Push a commit to `main` (the next merged PR) and Vercel builds nothing.
3. **R3:** open `https://bike-inventory-delta.vercel.app` and sign in. The deployment it serves
   is the one from `test`, shown in the Vercel dashboard header.
4. **R4:** Actions → Deploy to VPS → Run workflow, branch `test`. The build job fails at the
   first step with "VPS deploys run from main only". Migrate and deploy show as never run, and
   the server is untouched. Running it from `main` behaves exactly as before. That is a real
   production deploy, so do it only when one is wanted.

---

## 5. Out of scope

- **A GitHub Environment holding the VPS secrets** (Q2 b). The §2.3 gap stays open.
- **GitHub branch protection** for `main` or `test`. There is none today, and the merge button
  works even with red CI (`typecheck.yml:13-16`).
- **CI on direct pushes to `test`.** CI runs on PRs only. A direct push is checked by Vercel's
  build alone.
- **Retargeting the open PRs #76 and #65** to `test`. That is the owner's call, per PR.
- **Migrations on the test database.** Vercel still applies none (`scripts/vercel-build.mjs`).
  A migration merged to `test` must still be applied to the test DB by hand.
- **Editing plan 2809's text.** Its R1 ("Production deployment (from `main`)") is superseded by
  this plan for the branch name only. The "Vercel builds Production only" part still holds.
