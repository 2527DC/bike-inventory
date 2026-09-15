# A stock count is scoped by warehouse (Godown or Floor), in every mode, so creating one never fails for a missing store

Status: pending — Q0–Q5 open (15 Sep 2026). Nothing built.
Branch: not decided — Q0.

Every `file:line` below was read from disk on 15 Sep 2026. Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (15 Sep 2026)

The error, pasted from the dev server:

> ```
> GET /api/bins 200 in 2.6s (next.js: 2.1s, proxy.ts: 16ms, application-code: 483ms)
> 2026-09-15T09:44:17.103Z ERROR [server:stock-counts] stock count create failed {
>   message: '[\n' +
>     '  {\n' +
>     '    "expected": "string",\n' +
>     '    "code": "invalid_type",\n' +
>     '    "path": [\n' +
>     '      "storeId"\n' +
>     '    ],\n' +
>     '    "message": "Invalid input: expected string, received undefined"\n' +
>     '  }\n' +
>     ']'
> }
>  POST /api/stock-coun
> ```
>
> why i am getting this error let me know why

Then:

> i think it must be selected respected to the wrehouse where we cont have the stock we consider it in warehosue whith the type godown and floore wgere floor is a stoer

And, on how the plan is written:

> create a plan  where it  must first list the listing if the requiremnet and then the question and the plan

### 0.2 Restated as requirements

| # | Requirement |
|---|---|
| R1 | Creating a stock count never fails with *"storeId … received undefined"*. This holds on **every** screen that creates one (New Stock Count, Brand Count), with bin tracking **on or off**. |
| R2 | A stock count is chosen by **warehouse**: the person picks the store, then a warehouse in it, either the **Godown** or the **Floor**. The Floor is the shop. The warehouse's type is shown, so nobody has to know which building is which. |
| R3 | When bin tracking is on, the bin is picked **inside** that warehouse, not from a flat list of every bin in the business. |
| R4 | When a request is still wrong, the person sees a sentence that says what to choose, not a raw validation dump. |
| R5 | (process) This plan lists the requirements first, then the questions, then the plan. |

---

## 1. Questions and clarifications — answer before build

Answering "defaults" to all of them is a complete answer.

| # | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|
| **Q0** | Which branch? | `feat/remove-static-team-health` already carries plan 1509-po-sheet-mrp-price (uncommitted) and your other unfinished work. | (a) the same existing branch; (b) a new branch off `origin/main` | (a), as you chose for the PO change | |
| **Q1** | Keep **"Whole store"** (Floor and Godown counted together) on New Stock Count? | Decides whether the picker has that button. Since 8 Sep a whole-store count *can* correct stock: the approver names the warehouse that receives any surplus (`api/stock-counts/[id]/route.ts:240-262`). | (a) keep; (b) remove, warehouse only | (a) keep. Its caption is corrected (see A5). | |
| **Q2** | When bins are on, is the **bin optional**? | Decides whether "Whole warehouse" is offered next to the bins. | (a) optional, with "Whole warehouse" as the default; (b) a bin must always be picked | (a) | |
| **Q3** | Remove **"By Location"** and **"All Products"** from New Stock Count in bin mode? | "By Location" sends a `location` text the server never reads (`new/page.tsx:139-140`; the route reads no such field). "All Products" sends no place at all (§2.2). Both lead straight to this error. | (a) remove both; Store → Warehouse → (Bin) replaces them; (b) keep them and bolt a store picker on | (a). "Whole store" and "Whole warehouse" cover what they meant. | |
| **Q4** | Should the server **work out the store from the bin** when only a bin is sent? | This is a safety net for any caller that still sends only `binId`. The root fix is the screens (Parts A, B). | (a) yes, and refuse a bin whose warehouse is not in the chosen store; (b) no, refuse with "Choose a store" | (a) | |
| **Q5** | Brand Count keeps **no "Whole store"** option? | Today it is always one warehouse, on purpose (`brand-count/page.tsx:521-523`, decision D12), because a brand count corrects stock. | (a) keep it warehouse-only; (b) add Whole store | (a) | |

### 1.1 Decisions on record

| # | Decision | Date |
|---|---|---|
| — | none yet | |

---

## 2. How it works today — verified against the code

### 2.1 The server requires a store, and says so badly

- `stockCountSchema` requires `storeId: z.string().min(1, "Choose a store")` (`src/lib/validations.ts:188-198`).
- The route calls `stockCountSchema.parse(body)` (`src/app/api/stock-counts/route.ts:95`). The thrown ZodError lands in the catch, which logs `"stock count create failed"` and returns the **whole JSON issue list as the message** (`route.ts:303-307`). That is exactly your log line, and the text the screen shows.
- `binId` is read from the raw body, not the validated data (`route.ts:103`).
- A bin whose warehouse is **not** one of the chosen store's warehouses is not refused. `scopedWarehouse` stays null (`route.ts:151-156`), and the audit is written with the bin's warehouse under the wrong store (`route.ts:258`).

### 2.2 New Stock Count: the store picker is hidden in bin mode

- Bin mode comes from a database setting, fetched by `useBinTracking()` (`src/hooks/use-bin-tracking.ts:18`). It starts as `false` until that fetch returns (`use-bin-tracking.ts:10`).
- The scope's initial value is decided once, on that first render: `useState(BIN_TRACKING_ENABLED ? "bin" : "all")` (`src/app/(dashboard)/stock-audit/new/page.tsx:40`). **So in bin mode the screen opens on "All Products"**, which sends no place at all. This is the most likely path to your error.
- The Store → Warehouse picker renders only when bins are off (`new/page.tsx:203`). In bin mode you get By Bin / By Location / All Products instead (`new/page.tsx:180-198`).
- The body gets `storeId` only when bins are off (`new/page.tsx:133-136`). In bin mode it gets `binId`, or `location`, or nothing (`new/page.tsx:137-141`).
- The "what's missing" check asks for a store only when bins are off (`new/page.tsx:396`), so the button is enabled with no store.
- Bins are grouped by `b.location` (`new/page.tsx:70-79`), an old free-text column that can be null (`prisma/schema.prisma:680`). Bins with no location land under a group literally titled "null".
- There are two stale texts. The comment says *"there is no kind/type column"* (`new/page.tsx:234-235`), but `Warehouse.kind` is `FLOOR | GODOWN` (`schema.prisma:299-317`). The caption says *"Verify only — to correct stock, audit one warehouse"* (`new/page.tsx:251-254`), which stopped being true on 8 Sep (§1 Q1).
- The POST and the bins load use raw `fetch().then(r => r.json())` (`new/page.tsx:64, 142-147`). CLAUDE.md bans that in the browser.

### 2.3 Brand Count: same hole, plus a crash

- With bins on, step 2 is a flat bin list (`src/app/(dashboard)/stock-audit/brand-count/page.tsx:593-638`). Picking a bin skips the store and warehouse entirely (`handleSelectBin`, `brand-count/page.tsx:195-198`).
- The body sends `storeId: selectedWarehouse?.storeId` in bin mode (`brand-count/page.tsx:312-314`). `selectedWarehouse` comes from `selectedLocation`, which the bin path never sets, so **`storeId` is undefined**. It is the same error.
- The store/warehouse checks run only when bins are off (`brand-count/page.tsx:283-288`).
- **Crash.** Bins are split with `b.location.toLowerCase()` (`brand-count/page.tsx:431-432`). `Bin.location` is nullable (`schema.prisma:680`), and a bin created without one stores null (`src/app/api/bins/route.ts:63`). One such bin makes the screen throw a TypeError when bins are on.
- The split is "Warehouse Bins" / "Store Bins" by that old text, not by the warehouse the bin actually belongs to.
- A restored draft (`brand-count/page.tsx:103-127`) can hold a bin with no store. That also needs handling.

### 2.4 What the data already gives us

- `Warehouse.kind` is `FLOOR | GODOWN`, and each warehouse belongs to one store (`schema.prisma:299-317`). A bin belongs to one warehouse (`schema.prisma:678-679`).
- `useStores()` already returns every store with its warehouses **including `kind`** (`src/hooks/use-sites.ts:35`).
- `GET /api/bins` returns each bin's `warehouse { id, name, code, kind }` and accepts `?warehouseId=` (`api/bins/route.ts:13-27`). It does not return the store, which is why the screen cannot fill the store in from the bin.
- Brand Count's bins-off picker already does Store → Warehouse with a Floor/Godown tag (`brand-count/page.tsx:524-590`). It is the pattern to reuse.

---

## 3. Implementation plan

No schema change, no migration, no RBAC change.

### Part A — New Stock Count (`src/app/(dashboard)/stock-audit/new/page.tsx`)

| # | Change | Req |
|---|---|---|
| A1 | The **Store → Warehouse** picker always renders, whatever bin mode says. Each warehouse button shows its name and a **Floor** or **Godown** tag from `useStores()`. "Whole store" stays (Q1). | R1, R2 |
| A2 | Bin mode: the By Bin / By Location / All Products toggle is removed (Q3). Once a warehouse is picked, a third step lists **"Whole warehouse"** (default, Q2) and **only that warehouse's bins** (`b.warehouse.id === warehouseId`). There is no bin step for "Whole store". | R3 |
| A3 | The body is always `storeId` + `warehouseId?` + `binId?`. The "what's missing" check always requires a store. The auto-title reads `Stock Count - <warehouse> · Bin <code>`. | R1 |
| A4 | The `Bin` type gains `warehouse { id, name, kind }`. Grouping by the old `location` text goes. | R3 |
| A5 | The stale comment goes. The whole-store caption becomes: *"Counts Floor and Godown together. To correct stock, the approver chooses which warehouse receives any surplus."* | — |
| A6 | The two calls this part touches (the bins load and the create POST) move to `apiTry`, with `createLogger("stock-audit:new")` on failure. | CLAUDE.md |

### Part B — Brand Count (`src/app/(dashboard)/stock-audit/brand-count/page.tsx`)

| # | Change | Req |
|---|---|---|
| B1 | Bin mode reuses the bins-off step: **Store → Warehouse (Floor/Godown)**. Then comes a bin step showing that warehouse's bins, plus "Whole warehouse" (Q2). There is still no Whole store (Q5). | R1–R3 |
| B2 | The body always sends `storeId: selectedStoreId`, `warehouseId: selectedLocation`, and `binId` only when a bin was picked. The store/warehouse checks run in both modes. | R1 |
| B3 | The `b.location.toLowerCase()` split goes. Bins are filtered by warehouse id, so a bin with no location can no longer crash the screen. | R3 |
| B4 | Draft restore: a saved draft with a bin but no store/warehouse goes back to step 2 instead of the count step. | R1 |
| B5 | The create POST moves to `apiTry`. It already logs through `createLogger`. | CLAUDE.md |

### Part C — Server (`src/app/api/stock-counts/route.ts`)

| # | Change | Req |
|---|---|---|
| C1 | `safeParse` replaces `parse`. A refusal is **400 with the first issue's sentence** ("Choose a store"), logged as `warn` with the field path, not dumped as JSON. | R4 |
| C2 | Q4: when `storeId` is missing but `binId` is present, load the bin's warehouse and take its `storeId` before validating. Log it at `info` ("store derived from bin"), so a caller still relying on it is visible. | R1 |
| C3 | Use the validated `data.binId`, not `body.binId`. Refuse a bin whose warehouse is not an active warehouse of the chosen store: *"Bin A1 is not in BCH Store"*. Today that is silently accepted (§2.1). | R1 |

### Phases, agents, logging

- **C first**: the server contract is what A and B send to. Then **A and B in parallel**, one agent each, because they are separate files. That follows your rule of one agent per independent part.
- Every new branch logs through `createLogger` with ids only (storeId, warehouseId, binId), never a name. Every `catch` logs before it answers.

### Board of agents — to check before "done"

- **Inventory consultant:** a whole-store count still needs a correction warehouse at approval. That is unchanged.
- **Warehouse consultant:** bins are picked inside their warehouse, which matches how stock is actually held.
- **Backend engineer:** zod at the boundary (C1). A cross-store bin is refused, not accepted (C3).
- **Frontend engineer:** 44 px targets, a loading state while stores load, a disabled Create button with a reason.

---

## 4. Verification

1. `npx tsc --noEmit` (Claude). `npm run build` (owner).
2. Browser, **bin tracking ON**:
   - New Stock Count opens on the Store step, never on "All Products".
   - Warehouse buttons show Floor / Godown.
   - Picking a warehouse lists only its bins, plus "Whole warehouse".
   - Creating with a bin, with Whole warehouse, and with Whole store all succeed.
3. Browser, **bin tracking OFF**: New Stock Count and Brand Count behave as today.
4. Brand Count with bins ON: brand → store → warehouse → bin → count → submit succeeds. A bin with an empty `location` no longer crashes the screen.
5. API, signed in:
   - `POST /api/stock-counts` with only `binId` → created, with the store derived (C2).
   - A bin from the other store → 400 naming the bin (C3).
   - No store and no bin → 400 *"Choose a store"* (C1).

---

## 5. Out of scope, deliberately

- The other raw `fetch` calls on Brand Count (brands, categories, products, the start/complete calls at `brand-count/page.tsx:337-380`). Only the calls this plan touches move to `apiTry`.
- The legacy `Bin.location` column itself. It stays; nothing new reads it.
- The bins admin screen, and the stock-audit detail and review screens.
- The `BIN_TRACKING_ENABLED` environment fallback in `src/lib/inventory-config.ts`.
