# /team/permissions: search the modules by name

Status: completed — 22 Sep 2026, "Search modules…" on /team/permissions and /team/permissions/gaps matches the module name, shows a matching child's parent and a matching parent's children, and never touches grants; the owner closed it ("search is enough"); on `feat/2209-audit-bin-transfers-list-permissions`; tsc and lint clean; owner owes `npm run build` + browser walk.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (22 Sep 2026)

> ok mi need to have a requiremnt that s /team/permissions i need search option where i can
> filter by search of the module name add this as teh reuiremt create a plan in the pending
> foleer which has this requiremnt

Answer to §1, same day:

> the search match the name of the modfule and show what i search that it and all other with
> recomnde

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | `/team/permissions` has a **search box for modules**. Typing filters the permission list to the modules whose **name** matches. |
| R2 | The filter only **hides** modules. It never changes grants: saving a role still saves every module's ticks, shown or hidden. |
| R3 | Clearing the box shows every module again, grouped and ordered as today. |
| R4 | When nothing matches, the screen says so ("No module matches “…”") instead of showing an empty page. |

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Default |
|---|---|---|---|---|---|
| Q1 | R1 | Match on the module **label** only ("Stock audit"), or also its **key** (`stock_audit`), **description** and **group** ("Operations")? | Decides what a search finds. | (a) **label and key**: the name people see, plus the key admins read in logs (b) label only (c) label, key, description and group | **(a)** |
| Q2 | R1 | A **sub-module** matches ("Inbound") but its parent ("Stock management") does not. Show the parent too? | Without it, the child appears indented under nothing. | (a) **show the parent as context**, marked "(parent)" and not counted as a match (b) the child alone | **(a)** |
| Q3 | R1 | A **parent** matches. Show all its sub-modules too? | "Stock management" is often searched to reach its children. | (a) **yes, show its children** (b) the parent alone | **(a)** |
| Q4 | R1 | Keep the typed search when switching to another role? | Comparing one module across roles means switching roles with the same filter. | (a) **keep it** (b) clear it | **(a)** |
| Q5 | R1 | Add the same module search to **`/team/permissions/gaps`**, the modules × roles matrix (plan 2109, R10)? | Same need, 55 rows. | (a) **yes, the same box and the same matching** (b) not now | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 22 Sep 2026 | Q1 | **(b) the module name (label) only**, not the key. |
| 22 Sep 2026 | Q2–Q5 | Recommended defaults: a matching child's parent is shown muted as context; a matching parent shows its children; the search stays across roles; the same search goes on the gaps screen. |

---

## 2. How it works today — verified against the code (22 Sep 2026)

- `src/app/(dashboard)/team/permissions/page.tsx` (405 lines) loads every module in one request
  (`/api/modules`, `:79`) and every role (`/api/roles`, `:80`).
- **A role search already exists** and is client-side on purpose. Every role arrives in one
  request, so a round trip per keystroke would be slower (`:52`, `:66–70`, `:259–276`, "Search
  roles…").
- **There is no module search.** Modules are grouped by `group` into `groups` (`:208–214`) and
  ordered roots-then-children by `orderTree` (`:191–206`). Its comment explains why nothing is
  collapsible: "a hidden section here is a checkbox someone cannot find". The list renders at
  `:306` onwards: one card per module, sub-modules indented (`ml-4`, `↳`), admin-only modules
  locked, and a per-module "Select all / Clear all".
- **Grants live in one `Set`, `granted`** (`:53`), holding the permission ids of the selected
  role. Save sends the whole set (`:143`). So filtering what is **rendered** cannot drop a grant
  (R2), as long as the filter never touches `granted`.
- `ModuleRow` has `label`, `key`, `description`, `group`, `parentId` (`:20–30`), everything the
  matching in Q1–Q3 needs.
- The gaps matrix is `src/app/(dashboard)/team/permissions/gaps/page.tsx` (plan 2109, R10).

---

## 3. Implementation plan

Front end only. No API, schema or RBAC change: every module is already on the client.

- **`team/permissions/page.tsx`:**
  - `moduleSearch` state, and a search box with the `Search` icon ("Search modules…") placed
    above the permission list, below the role picker. It matches the role search's look.
  - One pure helper, `visibleModuleIds(modules, query)`, returns the ids to show:
    - matches on `label` only, case-insensitive, trimmed (Q1b)
    - adds the parent of each matching child (Q2a)
    - adds the children of each matching parent (Q3a)
  - The group loop keeps only visible modules and **drops a group left empty**. `orderTree` is
    unchanged.
  - Context-only parents render muted with "(parent)".
  - An empty result shows "No module matches “…”" (R4).
  - The search stays when switching roles (Q4a).
  - `granted`, Save, "Select all / Clear all" and the admin-only lock are untouched (R2).
    "Select all" stays per module, never across the filter.
- **`team/permissions/gaps/page.tsx`** (Q5a): the same box and helper, filtering the matrix rows.
  The existing "Only modules with gaps" toggle combines with it.
- **Shared helper:** put `visibleModuleIds` in
  `src/app/(dashboard)/team/permissions/_lib/module-search.ts` so both screens match the same way.
- **Logging:** none per keystroke. A client-side filter is not a business event.

**Board of agents:** frontend engineer (search input, empty state, no layout shift).

---

## 4. Verification

- `npx tsc --noEmit`. `npm run build` is run by the owner.
- Browser, on `/team/permissions`:
  - type "audit" → only "Stock audit" (and any other module whose name has "audit") shows,
    under its group
  - type "inbound" → "Inbound" shows with "Stock management" as a muted parent
  - type "stock management" → the parent and all its sub-modules show
  - type "zzz" → "No module matches “zzz”"
  - with a search active, tick a permission, clear the search, and Save → grants on hidden
    modules are unchanged (reload the role to confirm)
  - switch roles → the search stays
- `/team/permissions/gaps`: the same searches filter the matrix rows.

---

## 5. Out of scope

- Searching by **permission action** ("approve", "fetch").
- Any change to grouping, ordering or the admin-only lock.
- A server-side search. All 55 modules are already loaded.

---

## 6. Build record — 22 Sep 2026

- `src/app/(dashboard)/team/permissions/_lib/module-search.ts`: `searchModules(modules, query)`
  returns `visible` (null means no search), `contextOnly` and `matched`. It matches the label
  only (Q1b), brings a matching child's parent as context (Q2a) and a matching parent's children
  (Q3a). Pure; never touches grants.
- `team/permissions/page.tsx`:
  - "Search modules…" box below the role picker
  - groups with nothing visible are dropped
  - "(parent)" on context-only parents
  - "No module matches “…”" when nothing matches
  - the search is kept across role switches
  - `granted`, Save, Select all and the admin lock are unchanged (R2)
- `team/permissions/gaps/page.tsx`: the same box and helper, combined with "Only modules with
  gaps". The counts and banner still cover every module.
- Helper checked on sample modules:
  - `""` → all
  - "audit" → Stock audit + Stock management (parent)
  - "INBOUND " → Inbound + parent
  - "stock management" → the parent + all its sub-modules
  - "zzz" → none
- `tsc --noEmit`: 0 source errors. ESLint on both screens: clean.
- Not done: `npm run build`, browser walk.
