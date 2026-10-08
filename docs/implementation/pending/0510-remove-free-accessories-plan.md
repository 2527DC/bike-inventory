# Outward deliveries lose the "Free Accessories" field — from every screen, the API and the database

Status: in-progress — release 1 built 8 Oct 2026 on `chore/0510-remove-free-accessories` (every use removed, column `@ignore`d, no migration; `tsc` and `npm run build` green, `grep -rn freeAccessories src` empty). Release 2 (the `DROP COLUMN` migration) is not started — it must wait until release 1 is live. The §4 browser pass is the owner's.
Branch: `chore/0510-remove-free-accessories`, from `main` (see Q4).

---

## 0. Requirement

### 0.1 The owner's words, verbatim (5 Oct 2026)

> and in teh outword i have Free Accessories (included with delivery) filed input filed i dont want it  remove it even from teh databse i dont wate it to store this input filed data to be enterd and stored

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | **Nobody can enter free accessories on an outward delivery.** The "Free Accessories (included with delivery)" card and both "Free Accessories" inputs on the schedule form are gone. |
| R2 | **The application stops storing it.** The API no longer accepts or writes the field. |
| R3 | **The database no longer holds it.** `Delivery.freeAccessories` is dropped. |

---

## 1. Questions and clarifications

| # | Question | Why it changes the build | Options | Recommended default | Answer |
|---|---|---|---|---|---|
| Q1 | The handover checklist has a **"Free accessories handed over" tick box** that shows this field. Remove it too? | It is **required** — handover cannot complete until it is ticked (`handover-checklist.tsx:46`). With the field gone it would always read "None specified" and still block the handover. | (a) remove the tick box · (b) keep it as a plain "accessories handed over" step with no text | (a) | **(a)** |
| Q2 | The WhatsApp **"on the way"** message ends with "Free Accessories: …". Remove that section? | Otherwise every customer is told "Free Accessories: None". It is in three message builders and the default template, plus the `{{accessories}}` placeholder in the template editor. | (a) remove it everywhere · (b) keep | (a) | **(a)** |
| Q3 | Drop the column in **one release or two**? | The VPS pipeline runs migrations **before** the deploy (`.github/workflows/deploy-vps.yml`), and CLAUDE.md rule 7 says a dropped column must not be read by the code still live. Today's code reads every `Delivery` column, so dropping it first breaks every delivery screen until the new code is up. | (a) **two:** release 1 removes every use and marks the field `@ignore` (no migration, nothing in the database changes); release 2 drops the column, safe in either order · (b) **one:** code and `DROP COLUMN` together, as plan 2309 did — the deliveries screens fail for the minutes between migration and deploy | (a) | **(a)** |
| Q4 | The stock-audit fix (plan `0510-audit-apply-bulk-unit-codes`) is **uncommitted** on `fix/0510-audit-apply-timeout`. Commit it there first? | A new branch would carry those uncommitted changes with it and mix the two PRs. | (a) commit the audit fix to its branch, then branch this from `main` · (b) leave it uncommitted and wait | (a) | **(a)** |

### 1.1 Decisions on record

| Date | Question | Answer |
|---|---|---|
| 5 Oct 2026 | Q1–Q4 | Owner chose the recommended option on all four: **Q1 (a)** the handover tick box goes; **Q2 (a)** the WhatsApp section goes everywhere; **Q3 (a)** two releases, `@ignore` first; **Q4 (a)** the audit fix is committed to its own branch first. |

---

## 2. How it works today — verified against the code, 5 Oct 2026

**Data:** production (copy taken 14:04 UTC today) has **284 deliveries, 0 with `freeAccessories` filled**. Dropping the column loses nothing. No custom WhatsApp templates are saved (`AlertConfig` has no `singleton` row), so only the built-in defaults mention it.

**Where it is entered:**
- `src/app/(dashboard)/deliveries/[id]/_components/free-accessories-editor.tsx` — the "Free Accessories (included with delivery)" card (`:44`), saving through `PUT /api/deliveries/[id]` (`:29`); mounted in `src/app/(dashboard)/deliveries/_components/delivery-detail.tsx:24, :213`.
- `src/app/(dashboard)/deliveries/[id]/_components/schedule-form.tsx` — state `:56`, sent at `:82`, two inputs: Bangalore `:196-199`, outstation `:232-235`.

**Where it is stored:** `src/lib/validations.ts:790` (`freeAccessories: z.string().optional()`), written at `src/app/api/deliveries/[id]/route.ts:333`, column `prisma/schema.prisma:2046` (`freeAccessories String?` on `Delivery`).

**Where it is shown:**
- handover checklist tick box — `handover-checklist.tsx:37, :46, :174-189, :233` (Q1);
- WhatsApp "on the way" — `whatsapp-actions.tsx:89-102`, `dispatch-form.tsx:45-48`, `courier-info-card.tsx:56-60` (Q2);
- default template — `src/app/api/whatsapp-templates/route.ts:30-31`, editor `src/app/(dashboard)/more/whatsapp-templates/page.tsx:18, :46-47` (Q2);
- type — `src/app/(dashboard)/deliveries/[id]/_components/types.ts:39`.

Not related, left alone: the sales-practice script in `staff-lms/practice/page.tsx:102, :225` mentions free accessories as a customer objection.

---

## 3. Implementation plan

### Release 1 — the app stops using it (no migration)

1. Delete `free-accessories-editor.tsx`; remove its import and mount from `delivery-detail.tsx`.
2. `schedule-form.tsx` — remove the state, the payload key and both inputs.
3. `handover-checklist.tsx` — remove the tick box, drop it from `allConfirmed`, and the counter becomes `itemCount + 1` (Q1).
4. WhatsApp — remove the "Free Accessories" section from the three builders, the default `dispatched` template and the editor's placeholder list (Q2).
5. `types.ts` — remove the field.
6. `validations.ts` — remove the key. Zod strips unknown keys, so an old browser tab that still sends it is silently ignored, not refused.
7. `api/deliveries/[id]/route.ts:333` — remove the write.
8. `prisma/schema.prisma` — `freeAccessories String? @ignore`, with a comment naming this plan. `@ignore` takes it out of Prisma Client — no query reads or writes it — while Migrate keeps the column, so this release has **no migration**. Checked with `migrate dev` on localhost: it must report no changes.

Logging: no new code path; the removed write needs none. Schema: `@ignore` only. RBAC: none.

### Release 2 — the column goes (after release 1 is live)

`prisma/schema.prisma` — remove the field; `npx prisma migrate dev --name drop_delivery_free_accessories` on **localhost** → `ALTER TABLE "Delivery" DROP COLUMN "freeAccessories";`. The SQL is read before committing (rule 3). `npm run db:snapshot` before merge (rule 9). Applied by hand: `npx prisma migrate status`, then `npx prisma migrate deploy` (rule 4). Safe whether it runs before or after the deploy, because release 1 never reads the column.

### Board of agents

- `frontend-engineer.md` — removed inputs leave no empty section headers or dead state.
- `backend-engineer.md` — the API stops writing the field; validation no longer lists it.
- `database-architect.md` — drop only after nothing reads it (release 2); 0 populated rows.
- `warehouse-consultant.md` — the handover checklist loses one step (Q1).

---

## 4. Verification

1. `npx tsc --noEmit`, `npm run build`.
2. `grep -rn freeAccessories src` → nothing.
3. Release 1 on localhost: `migrate dev` reports no changes after `@ignore`.
4. Browser, on a local restore of production: open an outward delivery → no Free Accessories card; Schedule (Bangalore and outstation) → no input, scheduling still works; handover checklist → no accessories tick box, handover completes; WhatsApp "on the way" text has no Free Accessories section; Settings › WhatsApp templates has no `{{accessories}}`.
5. `PUT /api/deliveries/[id]` with `freeAccessories` in the body → 200, nothing stored.
6. Release 2: the migration contains only the `DROP COLUMN`; after it, delivery screens load.

---

## 5. Out of scope

- The sales-practice text in Staff LMS.
- Any change to how line items or the invoice are shown on the handover checklist.
