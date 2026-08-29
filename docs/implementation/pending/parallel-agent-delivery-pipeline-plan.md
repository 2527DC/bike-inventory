# Parallel multi-agent delivery pipeline — plan

Status: pending

Prepared 29 Aug 2026. Machinery only — this plan builds the pipeline, it implements none of
the other pending plans. Nothing here is to be executed until explicitly asked.

---

## 1. The problem

There are 8 pending implementation plans and one working tree. They ship one at a time, each
blocked behind a 106-second build and a human approving every `git` and `npm` command.

The goal is throughput: several plans in flight at once, each on its own branch, each built and
reviewed independently, ending in a report naming which branches to push and in what order — so
PRs are opened on GitHub and merged without guessing at conflicts.

## 2. What actually constrains parallelism here

Measured on this machine, not assumed. These numbers drive every decision below.

| Constraint | Measurement | Consequence |
|---|---|---|
| CPU / RAM | 4 cores, 8 GB RAM, 2 GB free | two concurrent `next build` runs will swap or OOM |
| Build time | 106s, Next uses 3 workers | the build is the bottleneck, and it cannot be parallelised here |
| Agent concurrency | capped at `cores - 2` = **2** | batch size 2 is the sweet spot; extras queue |
| git/npm gate | `.claude/hooks/ask-git-npm.js` forces `ask` by regex | a background agent stalls on a prompt nobody is watching |
| Database | one Postgres instance | two agents running `db push` at once corrupt each other |
| `node_modules` | **932 MB**, 574 packages, gitignored | a fresh worktree cannot build without it |
| `.env` | **not in git at all** (`.gitignore:33` is a blanket `.env*`), no `.env.example` | a fresh worktree has no credentials |

### The decisions taken

- Agents may run **`npm run build`** and nothing else.
- **Parallel editing, serial building.**
- Reviewers report severity; a human decides. Nothing auto-blocks.
- Agents never touch the database. Every `db:push` / `db:generate` / `db:seed:rbac` stays manual.

---

## 3. Step 0 — Make the build database-free *(prerequisite)*

Everything downstream is simpler once `npm run build` stops needing Postgres.

Three pages are server components that query Prisma and read no session, cookie or header. With
no per-request input, Next.js prerenders them at build time, so the build opens a database
connection:

| File | Query |
|---|---|
| `src/app/(dashboard)/staff-lms/playbooks/page.tsx` | `prisma.lmsScenario.findMany` |
| `src/app/(dashboard)/staff-lms/product-learning/page.tsx` | `prisma.lmsProduct.findMany` |
| `src/app/(dashboard)/staff-lms/products/page.tsx` | `prisma.lmsProduct.findMany` |

Add one line to each:

```ts
export const dynamic = "force-dynamic";
```

**200 files under `src/app` already declare this** — these three are the exception, not the rule.

Then in `.github/workflows/typecheck.yml`: **delete** the placeholder `DATABASE_URL` from the
Build job rather than adding a Postgres service container, and drop the `branches: [main]`
trigger filter so stacked PRs run too.

### Why this beats adding a database to CI

1. **It fixes a live bug.** A prerendered page bakes its data at build time, so a playbook or
   product added by a Staff LMS Admin does not appear until the next deploy.
   `/staff-lms/products/[id]` is already dynamic while the list linking to it is frozen — a new
   product is reachable by URL but invisible in the list.
2. **CI gets simpler, not more complex.** No service container, no `prisma db push` step, no
   placeholder credentials.
3. **Local builds stop needing Postgres**, which is what makes per-worktree builds viable at all.
4. **The cost is negligible** — internal learning screens with small tables, rendered per request
   like the other 200 pages.

CLAUDE.md documents the static choice as deliberate and says to change it "only if asked". This
plan is the ask, and the staleness bug is the reason.

> **Supersedes** Option A in `ci-build-database-dependency-plan.md` §5. That document's §5 must be
> rewritten to record Option B as chosen, and why.

> **Separate finding, not part of this plan:** `product-learning/page.tsx` and `products/page.tsx`
> are byte-identical — same component name, same query, same serialization, same `./product-list`
> import. Two routes rendering one screen.

---

## 4. Step 1 — One narrow exemption to the git/npm gate

`.claude/settings.json` has only an `ask` list — no `allow`, no `deny`. A permission rule alone
will **not** work: `ask-git-npm.js` returns `permissionDecision: "ask"` from a regex match, and a
hook decision wins. The exemption has to live in the hook.

In `.claude/hooks/ask-git-npm.js`, after the `GATED` test and before it emits `ask`:

```js
// Exactly one exemption: the verification build. An agent must be able to prove its own work
// compiles without stopping to ask. Anchored and whole-string, so `npm run build && git push`
// does NOT slip through — the GATED regex still catches the `git push` half.
const BUILD_ONLY = /^\s*npm run build\s*$/;
if (BUILD_ONLY.test(cmd)) return;
```

And the matching permission, so the prompt does not reappear from `settings.json`:

```json
"permissions": {
  "allow": ["Bash(npm run build)"],
  "ask": [ ...unchanged... ]
}
```

Record the carve-out in `AGENTS.md` under *"git and npm commands: ALWAYS ask first"* — the rule
now has exactly one exception and the file stating the rule should say so.

Everything else stays gated: every `db:push`, `db:generate`, `db:seed:rbac`, `git commit`,
`git push`. The `schema-reviewer` PostToolUse hook still fires on every `prisma/schema.prisma`
edit, including inside worktrees.

---

## 5. Step 2 — Worktree provisioning

A fresh worktree is missing exactly three things:

| Missing | Why | Fix |
|---|---|---|
| `node_modules` | 932 MB, gitignored (`.gitignore:5`) | Windows directory junction to the main tree |
| `.env` | not tracked, no template exists | copy from the main tree |
| `.next` | build output | regenerated by the build |

New file `scripts/new-worktree.sh` — plain shell, invokes no npm, so it is not gated:

```bash
#!/usr/bin/env bash
# Usage: scripts/new-worktree.sh <branch-name> <plan-slug>
# Creates ../bch-wt-<slug> on a new branch, junctioned to the main node_modules.
set -euo pipefail
BRANCH="$1"; SLUG="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT="$ROOT/../bch-wt-$SLUG"

git -C "$ROOT" worktree add -b "$BRANCH" "$WT" main
cp "$ROOT/.env" "$WT/.env"
# Junction, not a copy: 932 MB x N worktrees is waste, and no pending plan changes package.json.
cmd //c mklink /J "$(cygpath -w "$WT/node_modules")" "$(cygpath -w "$ROOT/node_modules")"
echo "worktree ready: $WT  (branch $BRANCH)"
```

### The junction is safe only while two conditions hold

A shared `node_modules` means a shared `node_modules/.prisma/client`, which `prisma generate`
rewrites on every build. **Re-check both before every run:**

1. **Builds stay serial.** Parallel builds would have two `prisma generate` runs writing the same
   directory. If builds ever go parallel, junctions must become real per-worktree installs.
2. **No plan in the batch changes `package.json`.** None of the 8 currently do. A plan that adds a
   dependency needs its own `npm ci` in its own worktree.

The `git worktree add` line is gated and will prompt. That is intended — worktrees are created
deliberately by a person, not by an agent.

---

## 6. Step 3 — The agent roster

Six definitions in `.claude/agents/`, following the existing `schema-reviewer.md` pattern: thin
frontmatter, and instructions that **read the relevant `docs/agents/*.md` board doc rather than
restating it**. The board is the source of truth; duplicating it guarantees drift.

### Implementers — they edit, and they may build

| File | `tools` | Reads first |
|---|---|---|
| `frontend-implementer.md` | Read, Edit, Write, Grep, Glob, Bash | `docs/agents/frontend-engineer.md` |
| `backend-implementer.md` | Read, Edit, Write, Grep, Glob, Bash | `docs/agents/backend-engineer.md` + `database-architect.md` |

Each is given the plan file path, its worktree path and its branch name, and told explicitly:
**the only shell command you may run is `npm run build`. Never `git`, never `prisma`, never
`db:push`. Never commit.**

### Reviewers — read-only, one lens each

| File | `tools` | Lens |
|---|---|---|
| `frontend-reviewer.md` | Read, Grep, Glob | `docs/agents/frontend-engineer.md` red flags |
| `backend-reviewer.md` | Read, Grep, Glob | `docs/agents/backend-engineer.md` red flags |
| `integration-reviewer.md` | Read, Grep, Glob | cross-cutting CLAUDE.md invariants |

The board docs are advisory principle lists with **no pass/fail rule**, so each reviewer
definition must carry the severity contract itself. Reuse the format `schema-reviewer.md` already
uses, so every review in this repo reads the same way:

```
## Blocking
## Worth fixing
## Questions for the user
```

`integration-reviewer.md` covers the architecture rules no per-file lens catches, taken straight
from CLAUDE.md: no role-name comparisons, no permissions in the JWT, no `prisma/rbac-catalog.ts`
import from `src/`, public routes still public, no cron or `setInterval`, no `console.log`, no
bare `catch {}`, no `res.json()` on a third-party response, no `fetch().then(r => r.json())` in
the browser.

### Reporter

`release-captain.md` — read-only; tools Read, Grep, Glob, Bash. Given the branch list, it runs
`git diff --name-only main...<branch>` per branch, intersects the file sets, and reports:

- push order, and which branches are independent
- for each overlapping pair, the exact conflicting paths
- a merge sequence that minimises rebases
- the `git push -u origin <branch>` lines **as text for a human to run**

It never runs `git push` and never touches `main`. `gh` is **not installed** on this machine, so
PRs are opened in the web UI at `github.com/2527DC/bike-inventory`; the report links each branch to
its compare URL.

---

## 7. Step 4 — The workflow script

`.claude/workflows/ship-plans.js`, invoked with `args` = a list of plan descriptors. The shape
that matters: **implement in parallel, build in series, review in parallel.**

```js
export const meta = {
  name: 'ship-plans',
  description: 'Implement N plans on N branches, build each serially, review, report merge order',
  phases: [{ title: 'Implement' }, { title: 'Build' }, { title: 'Review' }, { title: 'Report' }],
}

// args: [{slug, planPath, branch, worktree, lane: 'frontend'|'backend'}, ...]
phase('Implement')
await parallel(args.map(p => () =>
  agent(`Implement ${p.planPath} in worktree ${p.worktree}. Read the plan fully first. ` +
        `Do NOT run git or database commands. Report files changed.`,
        {label: `impl:${p.slug}`, phase: 'Implement',
         agentType: p.lane === 'frontend' ? 'frontend-implementer' : 'backend-implementer',
         schema: IMPL_SCHEMA})))

// SERIAL on purpose — 8 GB RAM will not survive two concurrent `next build` runs.
phase('Build')
const buildResults = []
for (const p of args) {
  buildResults.push(await agent(`cd ${p.worktree} && npm run build. Report pass/fail + errors.`,
    {label: `build:${p.slug}`, phase: 'Build', schema: BUILD_SCHEMA}))
}

phase('Review')
const reviews = await parallel(args.flatMap(p =>
  ['frontend-reviewer', 'backend-reviewer', 'integration-reviewer'].map(t => () =>
    agent(`Review the changes in ${p.worktree} against branch main.`,
      {label: `${t}:${p.slug}`, phase: 'Review', agentType: t, schema: REVIEW_SCHEMA}))))

phase('Report')
return await agent(`Produce the merge-order report for: ${args.map(p => p.branch).join(', ')}`,
  {agentType: 'release-captain', phase: 'Report', schema: REPORT_SCHEMA})
```

`parallel()` rather than `pipeline()` is deliberate: the build stage is a genuine barrier (one at a
time), and the release captain needs every branch's file set at once to compute intersections.

---

## 8. Which plans may share a batch

**6 of the 8 pending plans change `prisma/schema.prisma`.** They cannot share a batch, because
they share one Postgres and one `db push`.

| Rule | Detail |
|---|---|
| At most **one** schema-touching plan per batch | app-logic-removal, ledger-merge, pdi-module, sequence-race-fix, store-hierarchy, zoho-config |
| `store-hierarchy-and-team` runs **alone** | restructures 7 existing models, needs `db push --accept-data-loss` |
| `pdi-module` waits for `sequence-race-fix` | it needs that plan's `nextSequence()` helper (its own Q17) |
| `ci-build-database-dependency` pairs with anything | touches only `.github/workflows/` |
| `service-module-mobile-readiness` pairs with anything | backend hardening, no schema |

A safe first batch: **`ci-build-database-dependency` + `app-logic-and-problems-removal`** — zero
files in common, one schema change between them.

---

## 9. Merge procedure

Unchanged from current practice; the captain only supplies the order.

1. Run each `git push -u origin <branch>` the report lists.
2. Open PRs into `main` in the GitHub web UI.
3. Independent branches merge in any order.
4. Overlapping branches merge in the captain's stated order. If the second conflicts,
   `git rebase main` locally, resolve, push the branch again.
5. **Nothing is ever pushed to `main` directly.**

> Housekeeping: `.git/config` declares two remotes, `origin` and `origin2`, pointing at the *same*
> URL (`github.com/2527DC/bike-inventory.git`). Harmless but confusing — worth deleting `origin2`.

---

## 10. Verification

In order. Each is cheap and proves one link in the chain.

1. **Step 0:** stop Postgres, run `npm run build`. It must pass. That single result is the whole
   justification for the CI change.
2. **Step 1:** ask an agent to run `npm run build` — no prompt. Ask it to run `git status` — prompt
   appears. Ask it to run `npm run db:push` — prompt appears.
3. **Step 2:** create one throwaway worktree, `cd` into it, `npm run build`. It must pass with no
   `npm ci`, proving the junction and copied `.env` are sufficient. Then `git worktree remove` it.
4. **Step 3:** invoke one reviewer by hand against the current diff. Confirm it returns the
   three-section severity format and edits nothing.
5. **Step 4:** run the workflow with a **single** plan first. Confirm the phases appear in
   `/workflows` and the captain's report names the right branch.
6. Only then run a two-plan batch.

## 11. What this plan does not do

- It implements none of the 8 pending plans.
- It does not touch `main`, push anything, or open a PR.
- It does not give agents database access. Every `db:push` / `db:seed:rbac` stays manual.
- It does not make builds parallel. To change that, junctioned `node_modules` must first become
  per-worktree installs — re-read §5 before touching it.

## 12. Open questions

1. **Step 0 is a real behaviour change** — three pages move from build-time to per-request
   rendering. Confirm that is wanted before it is applied, since CLAUDE.md records the static
   choice as deliberate.
2. **The duplicate Staff LMS page** (`product-learning` vs `products`) — collapse to one route, or
   leave both?
3. **Batch size.** Concurrency caps at 2 on this machine. Accept 2, or run singles until the
   pipeline has proved itself once?
