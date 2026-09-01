# Review mode — a change to an existing model

There is already a read-only subagent for this: `.claude/agents/schema-reviewer.md`, which
reviews a **diff** to `prisma/schema.prisma`. Use it for a diff review. Use this file when
you are the one making the change, or when the change is bigger than a diff — a retype, a
rename, a table split or merge.

## Get the real diff first

```bash
git diff -- prisma/schema.prisma
git diff HEAD -- prisma/schema.prisma      # if the first is empty
git diff --cached -- prisma/schema.prisma
```

Review the diff, not the whole file. If you cannot get one, say so plainly and review only
the models you were told about. (git is gated by an ask-rule — propose the command, do not
assume you may run it.)

## Blast radius — this is the actual work

A schema change is only as safe as your search for its readers. For every field renamed,
removed or retyped:

```bash
grep -rn "fieldName" src/ scripts/ prisma/
grep -rn "modelName" src/types/ src/lib/validations.ts
grep -rn "queryRaw\|executeRaw" src/          # raw SQL the type system cannot protect
```

Check all five layers, not just the first:

1. **Prisma calls** — `prisma.<model>` and `tx.<model>`
2. **Zod schemas** — `src/lib/validations.ts`
3. **TypeScript types** — `src/types/index.ts` mirrors many models by hand, so it does not
   fail to compile when the schema changes underneath it
4. **API response shapes** — a removed field silently becomes `undefined` in the browser
5. **Raw SQL** — invisible to the compiler

Report exact call sites. "Several places use this" is not a review.

## Severity ladder — highest first

**Destructive to existing rows.** A dropped column, a narrowed type, or a new NOT NULL with
no default on a populated table. There are no migrations in this project (`db push`), so
there is **no rollback**. This is the highest-severity thing you can find; say it first and
say it plainly.

**Wrong money type.** A new `Float` on a currency column. Reject it.

**Lost constraint.** A `@unique` removed, a NOT NULL relaxed, an `onDelete` changed to
`Cascade`. Ask what now enforces the rule. If the answer is "the route handler", that is a
downgrade.

**Missing FK index.** Every new relation needs one; Prisma does not add it.

**Race condition.** A new unique counter-like column written outside `$transaction()` —
`TokenCounter` is the cautionary example.

**Architecture violations** (bugs even when the build passes):
- a role name in a condition, or a permission stored in a column — access control is data
- importing `prisma/rbac-catalog.ts` from `src/`
- a design that needs something to run on a schedule — there is no cron here
- a permission check added to a public route (`/review/[token]`, `/fill/[token]`,
  `/api/public/*`, `/api/auth/*`, `/api/my-permissions`, `/api/services/earn-sync`).
  This has silently broken a customer flow before.

## Retypes deserve their own plan

Changing `Float` to `Decimal` is not a schema edit — it is a schema edit plus every
arithmetic site in TypeScript, because `Prisma.Decimal` does not support `+` and `>=`.
Before proposing one:

1. List every column changing.
2. List every TypeScript expression that reads them — arithmetic, comparison, `toFixed`,
   `JSON.stringify` in an API response.
3. Say what happens to values already stored, which were never exact to begin with.
4. Propose it **module by module**, not all at once. Bills/payments/credits first — that is
   where the harm is.

## Report

```
## Schema review — <models touched>

### Blocking
- <finding> — `file:line` — <what breaks, concretely>

### Worth fixing
- <finding> — `file:line`

### Call sites to update
| File:line | What it reads | Change needed |

### Questions
- <only ones where different answers give different schema>

### Commands
db push: yes/no · prisma generate: yes/no (stop the dev server first — EPERM)
RBAC re-seed: yes/no · TypeScript call sites: <n>
```

If nothing is wrong, say exactly that in one line and stop. An empty review is a good
outcome — do not manufacture findings to look useful.
