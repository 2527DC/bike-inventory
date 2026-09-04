---
name: db-designer
description: Database schema design and review for this app's PostgreSQL + Prisma schema. Use when designing a new model, changing an existing one, choosing a column type, adding a relation or index, judging whether a table earns its place, deciding whether two tables should be merged, or auditing the whole schema for dead tables, wrong money types and missing indexes. Triggers on - schema, model, table, column, migration, index, foreign key, relation, normalize, denormalize, dead table, redundant table, data type, Decimal, Float, cascade, prisma.
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
---

# DB Designer

Schema work on `prisma/schema.prisma` — PostgreSQL on Supabase, Prisma Migrate
(`prisma/migrations/`, applied to production by `migrate deploy` from the Vercel build).
`db push` is banned — CLAUDE.md, "Database changes go through Prisma Migrate".

**Think, don't pattern-match.** A schema is a set of claims about a business. Your job is
to check the claims against how the business actually runs, not to apply a checklist of
generic best practices. "Add soft deletes and multi-tenancy" is not advice here.

## Pick a mode, then read only what that mode needs

| Mode | Trigger | Read |
|---|---|---|
| **design** | new model, new feature needs storage | `references/design.md` |
| **review** | a change to an existing model | `references/review.md` |
| **audit** | "is this table needed", "check my schema", whole-schema sweep | `references/audit.md` |
| any | always, before answering | `references/bch-context.md` |

Do not read all four. Read `bch-context.md` plus the one mode file.

## Ground truth, in priority order

1. **`prisma/schema.prisma`** — the only thing that is definitely true.
2. **`docs/schema-review.md`** — the last full audit (24 Aug 2026, 75 models). Deep and
   worth reading, but **partly stale**: the schema now has 92 models, and its items 2 and 8
   are already done. Never repeat a finding from it without re-checking it against the
   schema first. Verify, then cite.
3. **`docs/dead-code.md`** — reachability audit. Same staleness caveat.
4. **`docs/agents/database-architect.md`** — CLAUDE.md names it the authority for schema
   work. Follow it, with one exception noted below.

### Where the existing docs are wrong

`docs/agents/database-architect.md` used to instruct agents to keep using `Float` for money
"to maintain the pattern". That directly contradicts `docs/schema-review.md` §4, which
demonstrates the corruption on this project's own Postgres. **Money is `Decimal(12, 2)`.
Never recommend `Float` for a currency column.** If you find that instruction still present
anywhere, say so.

## The rules that are not negotiable here

**Money is `Decimal(12, 2)`.** 83 `Float` columns exist today and are a known defect
(`docs/schema-review.md` §4, item 5 on its work list). Never add an 84th. When you touch a
money column for any other reason, say that it should change type — but do not change it as
a drive-by, because every arithmetic site in TypeScript has to change with it.

**Every foreign key gets an index.** 52 of 117 FKs had none at the last audit. Prisma does
not create them for you. A new relation without `@@index([thatFkColumn])` is incomplete.

**Nullable means genuinely optional at creation.** If the value always exists when the row
is written, it is NOT NULL. A nullable column is a promise that the application will check
it, and applications forget.

**`onDelete` is always explicit.** Prefer `Restrict` where a cascade would silently destroy
something a human would want to be warned about — `Module.parentId` is `Restrict` precisely
because a cascade there revokes role grants with no audit trail.

**A unique counter column is written inside `prisma.$transaction()`.** `TokenCounter` mints
`BCH-0001`; a read-then-write hands two jobs the same token.

**Access control is data, not code** (see CLAUDE.md). A new feature model usually needs a
module in `prisma/rbac-catalog.ts` and a `requireFeature` guard — never a role name in a
condition, never a permission column on a table.

**No scheduled anything.** This app has no cron and no timers. Do not design a table whose
correctness depends on something sweeping it periodically.

## How to ask

Ask **only the 2–3 questions whose answers change the schema.** Anything you can determine
by reading the code, determine by reading the code — do not ask the user to do your
grepping. If the user asks for a draft, produce it and list your assumptions instead of
blocking.

A question that changes the schema: "can one payment settle several bills?" A question that
does not: "should I add createdAt?" (yes, always).

## How to report

Lead with the answer. Then the evidence. No preamble, no restating the request.

```
## <Answer in one line>

<the reasoning, with file:line evidence>

### Blocking
- <finding> — `file:line` — <what breaks, concretely>

### Worth fixing
- <finding> — `file:line`

### Questions
- <question that genuinely changes the schema>

### Commands needed
migration needed: yes/no (name it; say if the SQL needs hand-editing for a rename, backfill or NOT NULL) · re-seed RBAC: yes/no · TypeScript call sites to update: <n>
```

Never manufacture findings. "Nothing wrong here" in one line is a good outcome. Never say a
change is safe without having grepped for every reader of the thing you changed.

## Before you claim you are done

- [ ] Read the actual schema, not just a doc about it
- [ ] Grepped every call site of anything renamed, removed or retyped
- [ ] Every new FK has an index
- [ ] Every money column is `Decimal`
- [ ] `onDelete` explicit on every new relation
- [ ] Said plainly whether a migration is needed, and whether its SQL must be hand-edited
- [ ] Said whether the previous deployment survives the migration (additive) or it must be split across two releases

**Never run `prisma migrate dev`, `prisma db push`, `prisma generate`, `npm` or `git` yourself.** `npm` and `git`
are gated by an ask-rule (AGENTS.md), and `prisma generate` fails with `EPERM` while the dev
server holds the query engine. Print the command and let the user run it.
