# Implementation plans

Plan documents, filed by whether the work is done.

```
docs/implementation/
  ├── pending/     approved or proposed, not finished
  └── completed/   shipped and verified
```

Move a file from `pending/` to `completed/` in the same commit that finishes the work, and
update its own status line at the same time. A plan whose location and whose header disagree
is worse than either alone — see the caveat below.

Reference documents that are not implementation plans stay at `docs/` root:
`data-flow-and-modules.md`, `dead-code.md`, `schema-review.md`, `phase2-architecture.md`,
`water-flow-chart.md`, and the `agents/` board.

---

## Current contents

### completed/

| Plan | Shipped |
|---|---|
| `cron-removal-plan.md` | 28 Aug 2026 — all cron jobs and screen polling removed |
| `storage-implementation-plan.md` | 28 Aug 2026 — runtime-switchable storage + Settings module |
| `service-merge-plan.md` | `bch-service` merged; `/services/*` and the `SERVICE_*` roles are live |
| `analytics-merge-plan.md` | store analytics merged; `/analytics`, `CountEvent` and the device endpoints are live |

### pending/

| Plan | State |
|---|---|
| `zoho-config-consolidation-plan.md` | not started — three identical config tables into one |
| `sequence-race-fix-plan.md` | not started — five sites allocate unique numbers with a read-then-write race |
| `store-hierarchy-and-team-plan.md` | its header says "approved, not started"; confirmed — no `Store` model exists |
| `ledger-merge-plan.md` | **partially done** — its own §12 says schema, RBAC, backend and frontend shipped, but PDF statement import and the 219-gap migration remain |

---

## Caveat: two files were filed against their own status lines

Status headers in this repo have gone stale. These two were classified by **what the code
actually shows**, not by what the document claims about itself:

- **`analytics-merge-plan.md`** says *"Status: plan. Nothing implemented yet."* — but the
  `analytics` module, `/analytics` screens, `CountEvent`, `FootfallDaily` and the device
  ingest endpoints all exist. Filed as completed.
- **`service-merge-plan.md`** says *"Status: plan, plus the RBAC groundwork already
  seeded"* — but CLAUDE.md documents `/services/*` as the merged former `bch-service` app,
  and the screens, models and `SERVICE_*` roles are all present. Filed as completed.

If either is wrong, the fix is to move the file **and** correct its header, so the two stop
disagreeing.
