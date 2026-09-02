# Why the old vendor backup could not be pasted — the issues, column by column

Context: `F:\bharath  Cycle\complete_database_backup.sql` is a `pg_dump --inserts` of the old
database (pg_dump 17.6, taken from Supabase). The goal was to bring `Vendor`, `VendorContact`,
`VendorIssue` and `VendorIssueNote` into a database created by `prisma/migrations/0_init` from the
current `prisma/schema.prisma`. Pasting the backup's rows as they are fails. This is the record of
exactly why, so nobody re-discovers it.

The fix is `scripts/db/extract-vendor-backup.js`, which re-emits every row with an explicit column
list; the column/type map it produces is `docs/vendor-issues-backup-restore.md`.

---

## Issue 1 — the backup's INSERTs are positional, and the column ORDER changed

pg_dump wrote every row as `INSERT INTO public."Vendor" VALUES ('id', 'name', …)` — **no column
list**. That form means "values in the order the table's columns were created". In the old
database, columns added later (`openingBalance`, `waGroupCode`, `waGroupName` on `Vendor`; the
`issueSource`/`clientName`/`clientPhone`/`ticketNo`/`serviceLocation` block on `VendorIssue`) sit at
the **end**, because `ALTER TABLE … ADD COLUMN` always appends. In a table created fresh by
`0_init`, the same columns sit **where `schema.prisma` declares them** — in the middle.

So a positional paste shifts every value after the first moved column into the wrong slot.

### `Vendor` — misaligned from position 14

Column sets are identical (24 columns both sides). Only the order differs.

| Position | Old backup column (value in the row) | Column it lands in, new table | Result |
|---|---|---|---|
| 1–13 | `id` … `whatsappNumber` | same | fine |
| 14 | `paymentTermDays` (`30`) | `waGroupName` (text) | **silently wrong** — `'30'` stored as a WhatsApp group name, no error |
| 15 | `creditLimit` (`0`) | `waGroupCode` (text) | silently wrong |
| 16 | `cdTermsDays` (`NULL`) | `paymentTermDays` integer NOT NULL | null violation (at execution) |
| 17 | `cdPercentage` (`NULL`) | `creditLimit` double NOT NULL | null violation |
| **18** | `isActive` (`true`) | **`cdTermsDays`** integer | **the first error PostgreSQL reports:** `column "cdTermsDays" is of type integer but expression is of type boolean` |
| 19 | `notes` | `cdPercentage` double | type error |
| 20 | `createdAt` (timestamp) | `openingBalance` double | type error |
| 21 | `updatedAt` (timestamp) | `isActive` boolean | type error |
| 22 | `openingBalance` (`0`) | `notes` text | silently wrong |
| 23 | `waGroupCode` | `createdAt` timestamp NOT NULL | type error / null violation |
| 24 | `waGroupName` | `updatedAt` timestamp NOT NULL | type error / null violation |

PostgreSQL type-checks the whole statement before running it, so the **boolean-into-integer at
position 18 (`cdTermsDays`) is the error you see** — the null violations at 16 and 17 would only
surface after that one was "fixed". And the two silent mis-stores at 14 and 15 would never error at
all: they would just corrupt the vendor rows.

### `VendorIssue` — misaligned from position 2

Column sets are identical (21 columns both sides). Enum value sets (`IssueType`, `IssueStatus`,
`IssuePriority`, `IssueSource`) are identical too.

| Position | Old backup column (value) | Lands in, new table | Result |
|---|---|---|---|
| 1 | `id` | `id` | fine |
| **2** | `vendorId` (`'vnd_88xrleke'`) | **`issueSource`** enum | **the first error:** `invalid input value for enum "IssueSource": "vnd_88xrleke"` |
| 3 | `issueNo` (`'ISS-202605-0002'`) | `vendorId` | silently wrong |
| 4 | `issueType` (`'DAMAGE'`) | `clientName` | silently wrong |
| 5 onward | everything else | shifted by the moved block | wrong or erroring |

### `VendorContact` and `VendorIssueNote` — order unchanged

Positional paste would put every value in the right column on these two. They fail for Issue 2
instead.

---

## Issue 2 — foreign keys to users that do not exist in the target

- `VendorIssue.createdById` (183 rows) and `VendorIssueNote.authorId` (289 rows) reference three
  old user ids: `usr_t1tprhib` (Syed Ibrahim), `usr_fml7hh04` (Sravan), `cmqhqha9x0000ju04df5qukq2`
  (hamsa). A freshly seeded database has one user (the seeded admin, a different id), so every one
  of those 472 rows fails: `violates foreign key constraint "VendorIssue_createdById_fkey"`.
- The old `User` rows cannot simply be pasted either — see Issue 3.

**Resolution chosen (owner, 2 Sep 2026):** every `createdById` and `authorId` is set to one existing
user, `cmt8hr7hq00ecw2n8gymzo7t5`, and no user rows are inserted. Authorship in the database is
lost; the three original authors are listed in `docs/vendor-issues-backup-restore.md` for the
record. (The generator can instead carry the three across as inactive users — run it without
`--user=`.)

---

## Issue 3 — the `User` table changed shape (old RBAC vs new)

| Old backup `User` | New `User` |
|---|---|
| `role` — a PostgreSQL enum (`ADMIN`, `SUPERVISOR`, `CUSTOM`, …) | gone — replaced by `roleId` (text, NOT NULL, FK → `roles.id`) |
| `customRoleName` text | gone |
| `permissions` jsonb | gone — permissions are rows in `role_permissions` now |
| — | `emoji`, `storeId`, `warehouseId` (new, nullable) |

A positional paste of an old user row puts `'ADMIN'` into `roleId` → foreign-key error (`roles` has
no row with id `ADMIN`). A paste with the old column names → `column "role" of relation "User" does
not exist`. There is no automatic mapping from an old `role` enum value to a seeded role row.

---

## Issue 4 — `VendorIssue.billId` → `VendorBill`

`VendorBill` is not part of this export (it drags `PurchaseOrder`, `InboundShipment` and the
payments tables with it). Any issue that pointed at a bill would fail the FK. **In this backup, no
issue does** — all 183 `billId` values are `NULL` — so nothing was lost; the generator nulls the
column defensively and reports the count (0).

---

## What the generator does about each

| Issue | Handling in `scripts/db/extract-vendor-backup.js` |
|---|---|
| 1 — positional order | Every INSERT names its columns, in the current schema's order. Order in the target no longer matters. |
| 2 — missing users | `--user=<id>` rewrites both author FKs to that id; without the flag, the referenced users are inserted first, inactive. |
| 3 — `User` shape | Never pastes old `User` rows as-is; when carrying users it writes only the columns the new table has and resolves `roleId` by subquery. |
| 4 — `billId` | Nulled with a count in the report (0 in this backup). |
| Re-runs | Every statement is `ON CONFLICT DO NOTHING`; the file is one transaction. |

Verified 2 Sep 2026: the generated file was applied to the local `bch` test database inside a
transaction and rolled back — all 576 statements succeeded, counts 83 / 18 / 183 / 289.
