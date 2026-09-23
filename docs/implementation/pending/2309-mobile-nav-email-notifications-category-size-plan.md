# Phone menu without the bottom bar; no email notifications anywhere; category names show their size in brackets

Status: pending — questions in §1 are open; nothing is built.
Branch: not created. Ask the owner which branch to base it on before starting (standing rule).

Every `file:line` below was read from disk on 23 Sep 2026 by three Explore agents and spot-checked
by hand (`notify/index.ts:95`, `(dashboard)/layout.tsx:42,52,61`, `stock/page.tsx:915`,
`notification-preferences.tsx:168`, `globals.css:6`, `purchase-orders/[id]/send/route.ts:14,217`).
Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (23 Sep 2026)

> create a implementation plan where by listing the requiremnet the requirement are one thing is i need to remove the more bootm nav bar and let keep the elemnets in the right side sidebar at the phone or pwa and t i need to know about the notification where in the normal user he he seeaing the notification toggler thing where no one has the email notification the thing is we dont use the eamil fr the notification we will not notiy any user with emil remove any level if ther i option in data baser and also in the ui level and need the name with size at the categor in the brackets

Follow-up, same day: *"jsut create the implementation plan dont implemnt it"*.

### 0.2 Restated as requirements

1. **R1** — Remove the bottom navigation bar (Home · pinned tabs · More) on phone and PWA.
2. **R2** — Everything the bottom bar and its **More** page gave the user must be reachable from the
   right-side drawer (the ☰ menu) on phone and PWA. Nothing becomes unreachable.
3. **R3** — Normal users must no longer see an **Email** notification toggle.
4. **R4** — The app never notifies a user by email. Remove the email notification option at
   **every level**: UI, API, server logic and database.
5. **R5** — Category names show the size in brackets — "name with size at the category in the
   brackets". The exact format is open, see Q7–Q9.
6. **R6** — This plan only. No code is written until the owner approves it.

---

## 1. Questions and clarifications — answer before build

| # | Question | Why it changes the build | Options | Recommended default | Answer |
|---|---|---|---|---|---|
| Q1 | The bottom bar's tabs are **pinned per user** by an admin on `/team/[id]` (`User.navTabs`). With the bar gone, what happens to the pins? | Decides whether we delete a column, an admin editor and an API field, or keep them for the drawer | (a) Drop pins entirely: remove the "Bottom Navigation" section on `/team/[id]`, the `navTabs` API field and (in a later release) the `User.navTabs` column. (b) Keep the pins and show them as a **"Pinned"** group at the top of the drawer | **(a)**. The drawer already lists every module the user can open | |
| Q2 | Should the drawer carry what only `/more` has today: the profile/role card, **My notifications**, Sign out, and the admin Zoho "Clear stuck syncs" panel? | R2 says nothing may be lost. Today these are reachable only through the drawer's "More, settings and sign out" link | (a) Keep the `/more` page, linked from the drawer as it is today. (b) Move Profile + My notifications + Sign out into the drawer footer, and keep `/more` for the Zoho panel and the version line | **(b)** — sign-out and notifications one tap away, like the desktop sidebar | |
| Q3 | Should the drawer get the **Approvals** link the desktop sidebar has (`ApprovalsNavLink`)? On phone only the header badge exists today | Small addition to `header-menu.tsx` | yes / no | **yes** | |
| Q4 | The **SMTP settings stay**. The purchase-order "Send to vendor" email uses the same SMTP config and sender as notifications. Is PO emailing staying? | If PO email stays, the `notification_config` SMTP columns, `src/lib/notify/email.ts`, the admin Email tab and the test-send must stay. Only the *notification* email path goes | (a) PO email stays, remove only notification email. (b) Email goes completely, including PO send | **(a)**. The PO email was built on purpose (plan 1509) | |
| Q5 | If Q4 = (a): the admin screen `/settings/notifications` has an **Email** tab (SMTP). Rename it and explain its purpose? | UI wording only | (a) Rename the tab to **"Email (PO sending)"** with a one-line note: "Used only to send purchase orders to vendors. Staff are never notified by email." (b) Move SMTP to its own settings card "Purchase-order email" | **(a)** | |
| Q6 | Delete the old `EMAIL` rows from `notification_outbox`? They are one "skipped" row per notification ever sent, plus any from before email was switched off | The `EMAIL` value cannot leave the `NotificationChannel` enum while rows use it | (a) Delete them in the migration. (b) Keep the enum value and just stop writing it | **(a)**. They record only "email skipped", which is noise | |
| Q7 | "Name with size in brackets": which **screen** or picker? | Decides which files change | /stock filter · /stock bulk "Category" assign · /stock/[id] edit · /categories list · stock-audit brand-count · bins home-rule · everywhere a category is shown | **Everywhere a category is picked or shown**, through one shared helper | |
| Q8 | Which **format**? Categories are already wheel sizes (`26`, `26 SS`, `27.5MS`, `700C MS`…); sub-categories MS/SS sit under a size parent | Decides what the helper returns | (a) Sub-category with its parent size: `SS (26)`, `MS (27.5)`; top level unchanged: `26`, `SPARES`. (b) Category with its product count: `26 SS (529)`. (c) Product name with its category: `UNIROX INSTRAGRAM BLU (26 SS)` | **(a)**. It uses the category tree, which exists; no size field, no guessing | |
| Q9 | Where does the **size** come from? | The owner ruled twice (9 Sep; 11 Sep, Q47) that there is **no size column**, and on 1 Sep "don't use any auto type regex". Reading a size out of product names misreads `42T`/`44T` chainrings | (a) From the category tree only (parent name). (b) Parse the product name | **(a)**. Non-size categories (SPARES, Accessories) show just their name | |
| Q10 | The dead `Product.size` column (`schema.prisma:593`, "dropped next release", plan 0909 §5): drop it in this plan's migration? | Adds one `DROP COLUMN` to the migration | yes / no | **yes**. Nothing reads it (grep of `src/` = comments only) | |

### 1.1 Decisions on record

| Date | Q | Answer | By |
|---|---|---|---|
| — | — | none yet | — |

---

## 2. How it works today — verified against the code

### 2.1 The bottom bar

- **Component:** `src/components/bottom-nav.tsx`. It renders **Home** (`/`), up to 4 admin-pinned tabs and
  **More** (a link to `/more`, not a sheet) (`:20-29`). It returns `null` when nothing is pinned
  (`:36`). It is fixed, `h-16`, with `safe-bottom` (`:44`).
- **Pin logic:** `src/lib/use-bottom-nav.ts:53-78` intersects `User.navTabs` with the user's
  granted modules; `MAX_NAV_TABS = 4` in `src/lib/nav-tabs.ts:11`.
- **Pins stored in:** `User.navTabs String[]` (`prisma/schema.prisma:414`).
  - Read path: `src/lib/rbac.ts:102-111,150-151,244`, then `src/app/api/my-permissions/route.ts:21-23`, then `src/stores/permissions.ts:66-70,102,111,121,133,165`, then `src/lib/use-permissions.ts:23,40-41`.
  - Write path: `src/app/api/users/[id]/route.ts:11,15,46,57,95-107`.
  - Admin editor: `src/app/(dashboard)/team/[id]/page.tsx:16,37,70,102,132,155-169,309-415`.
- **Mounted:** `src/app/(dashboard)/layout.tsx`
  - imports at `:6,9`
  - `useBottomNav()` at `:23`
  - `nav-hidden` at `:42`
  - `<main className="flex-1 pb-nav lg:pb-10">` at `:52`
  - `<div className="lg:hidden"><BottomNav/></div>` at `:59-62`
- **Space reserved for it:** `src/app/globals.css`
  - `--bottom-nav-height: 64px` (`:6`)
  - `.nav-hidden` (`:62-64`)
  - `.pb-nav` (`:67-69`)
  - `.above-nav` (`:77-79`, desktop override `:85-93`)
- **Pages using `.above-nav`** follow the variable automatically:
  - `vendor-issues/page.tsx:816`
  - `transfers/[id]:454`, `transfers/new:379`
  - `stock-audit/brand-count:1015`
  - `stock/page.tsx:814`
  - `accounts/reconcile/[id]:544`
  - `deliveries/dispatch:475,489`
  - `receivables:530`
- **Hard-coded offsets that assume the bar** (these leave a gap if left alone):
  - `src/components/pwa-install-banner.tsx:75` (`bottom-20`)
  - `src/components/error-toast.tsx:17` (`bottom-20`)
  - `src/app/(dashboard)/assembly/_components/awaiting-tab.tsx:233` (`bottom-20`; the comment at `:231` says "above the mobile bottom nav")
  - `src/app/(dashboard)/services/counter/page.tsx:856` (`bottom-16`, sits exactly on the bar)
  - `vendor-issues/[id]/page.tsx:764` and `vendor-issues/page.tsx:823` (`bottom-24` toasts)
- **PWA:** the only standalone detection is `pwa-install-banner.tsx:20-25,72`, which hides the banner. Nothing else
  changes in standalone mode. Phone and PWA are the same code path (below `lg`).

### 2.2 The phone drawer (already on the right)

- `src/components/header-menu.tsx`, opened by ☰ (`:94-107`) in `src/components/header.tsx:44`.
- The header is phone-only: `layout.tsx:48-50`.
- It slides in from the **right** (`:111`, panel `:126`) and has Esc, backdrop, scroll lock and focus return (`:54-71`).
- **Contents:**
  - Home (`:145-155`)
  - the full `buildNavTree(modules)` tree (`:78,170-245`)
  - a "More, settings and sign out" link to `/more` (`:247-260`)
- **Coverage:** every pinned tab is a module, so it is already in the drawer. **Only `/more` has:**
  - the profile/role card
  - `<NotificationPreferences/>`
  - the admin Zoho "Clear stuck syncs" panel
  - Sign out
  - the version line (`src/app/(dashboard)/more/page.tsx:75-211`)
- The desktop sidebar's `ApprovalsNavLink` (`app-sidebar.tsx:197`) is not in the drawer. The phone shows `ApprovalsBadge` in the header (`header.tsx:35`).

### 2.3 Email notifications

**Already switched off in code, but still visible and still stored.** Commit `c5a4317` ("PO-only email
notifications") did the following:
- It hard-coded `const emailOn = false;` (`src/lib/notify/index.ts:95`).
- Every `notify()` call still writes an `EMAIL`/`SKIPPED` outbox row (`:103-108`).
- It still reads the user's `email` preference (`:118-124`).
- It kept a dead fan-out block (`:179-191`).

What remains, by level:

| Level | Where | What |
|---|---|---|
| **User UI** | `src/components/notification-preferences.tsx:27,70,122,160-173` — rendered for every user at `more/page.tsx:90` | an **Email** switch per event (`:167-173`) |
| **User API** | `src/app/api/notifications/preferences/route.ts:23-25,33,52,64,105,119-120` | zod requires `email: z.boolean()`; upserts it |
| **Admin UI** | `src/app/(dashboard)/settings/notifications/page.tsx:690-795` (EventsTable) | "Email" column header `:753`, "PO Only" badge `:770-774`, always sends `email:false` `:715-717` |
| **Admin API** | `src/app/api/notifications/events/route.ts:25,45,88-89` | zod `email`, upserts `emailEnabled` |
| **Types** | `src/lib/notify/types.ts:14,264-278,281-293` | `Channel = "PUSH" \| "EMAIL"`, `EventSettingView/Update.email`, `PreferenceView/Update.email` |
| **Event defaults** | `src/lib/notify/events.ts:24,31-71` (stale header `:12-16`) | `defaults.email: false` on every event |
| **Database** | `schema.prisma:1690` `NotificationEventSetting.emailEnabled` · `:1709` `NotificationPreference.email` · `:1718-1721` `enum NotificationChannel { PUSH EMAIL }` · `:1743` `NotificationOutbox.channel` | created in `prisma/migrations/0_init/migration.sql:53,707,720,731` |
| **Docs** | `docs/notifications-guide.md:7-23,45,53-61,95-117,159-166,185-204` | a full "turn on email" runbook, now wrong |
| **Email footer** | `src/lib/notify/email.ts:471` | "Change them under More → My notifications" |

**Email that is NOT a notification and must stay (Q4):**
- **PO "Send to vendor" by email with the PDF attached.**
  - The route: `src/app/api/purchase-orders/[id]/send/route.ts:14,153,217,292-293`.
  - The email template: `src/lib/purchase-orders/email.ts:44`.
  - The UI: `purchase-orders/[id]/_components/send-to-vendor-sheet.tsx`.
- **The PO Send button's readiness check:** `src/app/api/notifications/status/route.ts`, which calls `checkEmailReady`, consumed at `purchase-orders/[id]/page.tsx:66,92,257-258,298-299,332`.
- **What these depend on:**
  - the SMTP config: `NotificationConfig` smtp*/from*/emailEnabled/emailConnected, `schema.prisma:1605-1618`
  - the sender: `src/lib/notify/email.ts` (`sendEmail :70`, `sendTestEmail :161`, `checkEmailReady :205`, `loadSettings :240-308`)
  - the admin Email tab and test send: `settings/notifications/page.tsx:163-410`, `api/notifications/test/route.ts`, `api/notifications/config/route.ts:32-54,134-147,212-235`
- **Unrelated, untouched:**
  - `User.email`, `Vendor.email`, `Customer.email`
  - `PurchaseOrderSendChannel.EMAIL`
  - `EvidenceKind.EMAIL`

### 2.4 Category names and size

- `Category` (`schema.prisma:502-523`) has no size field. It has a tree: `parentId`, relation `CategoryTree`.
- 20 of 32 categories **are** wheel sizes (`prisma/data/catalog.sql:25-56`): `12 … 29 SS, 700C, 700C MS/SS`. Parents 24/26/27.5/29/700C each have MS/SS children (`:59-68`). About 61% of products sit in them.
- There is **no shared category label helper**. Each screen formats its own label:
  - `src/components/category-tree-select.tsx:288-304`: indented name, full path `Parent › Child` while searching
  - `stock/page.tsx:915`: `{c.name} ({c._count.products})`, the only bracket today
  - `stock/[id]/page.tsx:43-58,356-369`: local flatten, parent as hint
  - `stock-audit/brand-count/page.tsx:174-194`: its own flatten, which **lists each child twice** (the same bug plan 0909 Q10 fixed elsewhere)
  - display-only chips: `stock/_components/stock-table.tsx:204-208`, `stock-card.tsx:225-228`, `assembly/_components/my-queue-tab.tsx:105,228`, `stock-audit/[id]/page.tsx:951,1116`, `inbound/[id]/page.tsx:787-789`, `complaints/page.tsx:468,666`, `purchase-orders/_components/reorder-tab.tsx:80,237-240`
- `GET /api/categories` (`src/app/api/categories/route.ts:24-44`) already returns `parent` for every row, so a `Name (Parent)` label needs **no API change** on the pickers that use it.
- Zoho sends no size attribute: `src/lib/integrations/inventory.ts:16-27` carries only `category_id`, `name` and `parent_category_id`.
- `Product.size` (`schema.prisma:593`) is dead: no reads or writes in `src/`.

---

## 3. Implementation plan

Assumes the recommended defaults. Any different answer in §1 changes the part it names.

### Part A — no bottom bar; the right drawer holds everything (R1, R2)

**A1. Remove the bar**
- Delete `src/components/bottom-nav.tsx` and `src/lib/use-bottom-nav.ts`.
- In `(dashboard)/layout.tsx`:
  - drop the imports (`:6,9`), the hook (`:23`), the `nav-hidden` class (`:42`) and the mount (`:59-62`)
  - change `pb-nav` at `:52` to `pb-safe`
  - update the comment at `:19-20`
- In `globals.css`, set `--bottom-nav-height` to `0px` and remove `.nav-hidden`. Keep the variable so every `.above-nav` page works unchanged: it now sits 8px above the safe area.

**A2. Fix the hard-coded offsets from §2.1.** Bring each one down to the safe area, e.g. `bottom-4` plus `env(safe-area-inset-bottom)`:
- `pwa-install-banner.tsx:75`
- `error-toast.tsx:17`
- `awaiting-tab.tsx:231-233`
- `services/counter/page.tsx:856`
- `vendor-issues/[id]/page.tsx:764`
- `vendor-issues/page.tsx:823`

**A3. Drawer contents** (`header-menu.tsx`), Q2 (b) and Q3:
- Top: a user card with name and role.
- Then Home, **Approvals** (Q3) and the module tree, all as today.
- Footer:
  - **My notifications**, which opens the existing `NotificationPreferences` in a sheet or links to `/more#notifications`
  - **Sign out**, reusing the call in `app-sidebar.tsx:321-330`
  - "More" (to `/more`) for the Zoho panel and the version line

**A4. Pins go** (Q1 (a)):
- Remove the "Bottom Navigation" section and `MAX_NAV_TABS` from `team/[id]/page.tsx`.
- Remove `navTabs` from `api/users/[id]/route.ts`, `rbac.ts`, `api/my-permissions`, `stores/permissions.ts` and `use-permissions.ts`.
- Delete `src/lib/nav-tabs.ts`.
- **Column:** keep `User.navTabs` in this release (additive-first, CLAUDE.md rule 7) and mark it `// dropped next release`.
- **Grep first:** `prisma/rbac-catalog.ts:111,346-355,450,487,545` mentions nav tabs. Fix the comments; the catalog data changes only if it actually seeds tab routes, and that needs checking before the build.

### Part B — email is never a notification channel (R3, R4)

**B1. User UI:** in `notification-preferences.tsx`:
- remove the Email switch (`:167-173`), the skeleton row (`:122`), `"email"` from `ChannelField` (`:27`) and the payload field (`:70`)
- one switch remains per event: **Push**
- the header text says "Notifications arrive as push on this device"

**B2. User API:** in `api/notifications/preferences/route.ts`:
- zod drops `email`, and uses `.strip()` rather than strict, so an old cached client still saves
- the GET no longer returns `email`

**B3. Admin UI and API:**
- In EventsTable, remove the Email column (`:746,753,770-774`) and `email:false` (`:715-717`).
- In `api/notifications/events/route.ts`, drop `email`/`emailEnabled` (`:25,45,88-89`).
- Rename the Email tab (Q5 (a)) and change the subtitle at `page.tsx:114`. Update the card text at `settings/page.tsx:52` and the RBAC module description at `rbac-catalog.ts:788` to "Push notifications and the SMTP used to email purchase orders".

**B4. Server:** in `src/lib/notify/index.ts`:
- delete `emailOn` (`:95`), the EMAIL/SKIPPED outbox write (`:103-108`), `wantsEmail` (`:118-124`), the dead fan-out (`:179-191`) and the `sendEmail`/`maskEmail` import (`:34`, if now unused)
- keep `absoluteUrl` (`:310-315`) only if push still uses it

Also:
- In `events.ts`, `defaults` becomes `{ push }`; fix the stale header `:12-16`.
- In `types.ts`, `Channel = "PUSH"`; drop the `email` fields at `:264-293`.
- `email.ts` stays for PO send (Q4). Delete the "My notifications" footer line (`:471`), since PO email never needed it.

**B5. Database:** one migration, `<ts>_remove_email_notification_channel`, written with `migrate dev` on
**localhost only** (owner rule 9 Sep: Claude applies to local `bch` only; the owner deploys). It runs these steps in order:

```sql
DELETE FROM "notification_outbox" WHERE "channel" = 'EMAIL';          -- Q6
ALTER TABLE "notification_event_settings" DROP COLUMN "emailEnabled";
ALTER TABLE "notification_preferences" DROP COLUMN "email";
-- enum PUSH-only: Postgres cannot drop an enum value, so Prisma recreates the type
ALTER TABLE "Product" DROP COLUMN "size";                              -- Q10
```

- **Rule 7 (additive first) is broken on purpose, and here is why.** The dropped columns are read by today's
  code, so the old code fails against the new schema. There is no production deployment yet (memory: local and
  the cloud test db only), so this is acceptable **only if** code and migration deploy together. The owner confirms that at Q4/Q6 time.
  If that is not acceptable, split it: this release stops using the columns, and the next one drops them.
- Read the generated SQL before committing (rule 3), especially the enum recreate.
- `npm run db:snapshot` before the PR (rule 9).

**B6. Docs:** rewrite `docs/notifications-guide.md` as push only, plus one section "SMTP is for PO email
only". Add a note at the top of `docs/implementation/pending/notifications-and-settings-rbac-plan.md`
that email as a notification channel is withdrawn (23 Sep 2026), so Phase 4 / Part C and Q14 are
closed without being built.

### Part C — category name with size in brackets (R5)

Q8 (a) and Q9 (a):

**C1. One helper:** `categoryLabel(c)` in `src/lib/categories/tree.ts`.
- A child whose parent exists returns `"SS (26)"`, which is `${name} (${parent.name})`.
- A top-level category returns its name unchanged.
- It is pure and has no parsing.

**C2. Use it everywhere a category is shown:**
- `category-tree-select.tsx`: the selected value and the search results (the tree rows stay indented)
- the `/stock` bulk assign `<option>` at `:915`, which becomes `SS (26) · 529`. The count moves out of the brackets so the brackets mean one thing only
- `stock/[id]` edit and chip
- the `stock-table`/`stock-card` chips
- the `brand-count` picker, and fix its double-listing while there
- assembly, stock-audit, inbound, complaints and reorder labels

**C3. Server-built labels:** check the display-only screens in §2.4. Where the API returns only `category.name`, add `parent: { select: { name } }` to that route's `select`. List each route touched in the PR.

### Phases

| Phase | Parts | Depends on |
|---|---|---|
| 1 | A (nav) | Q1–Q3 |
| 2 | B1–B4, B6 (email code) | Q4–Q5 |
| 3 | B5 (migration) | Phase 2 merged in the same PR; Q6, Q10 |
| 4 | C (category label) | Q7–Q9 |

The phases are independent of each other except 2 → 3. One agent per phase can build them in parallel.

### RBAC

- No new module and no new action.
- Only the `settings_notifications` description text changes, so the owner runs `npm run db:seed:rbac` after deploy.
- No role-name checks are introduced.

### Logging

- `notify/index.ts` keeps its existing `createLogger` scope.
- Remove the "email skipped" log line along with the code.
- Every new or changed `catch` logs before it returns (CLAUDE.md).
- The drawer's sign-out uses the existing handler, which already logs.

### Board of agents

| Agent | Check |
|---|---|
| **Frontend** | drawer focus, scroll lock and Esc are kept; no fixed element overlaps the safe area; loading states on the preferences sheet |
| **Backend** | zod on preferences and events stays strict for known keys and strips old ones; `requireAuth` stays; `/api/my-permissions` stays authentication-only |
| **Database** | enum recreate SQL is read; snapshot before merge; `navTabs` kept one release |
| **Integration** | the PO email path (`send/route.ts`, `status/route.ts`, `email.ts`) is untouched and verified by a real send |

---

## 4. Verification

1. `npx tsc --noEmit` passes, then `npm run build` (the owner runs it; it takes 21–45 min).
2. `npx prisma migrate status` on localhost is up to date. Then run these on local `bch`:

   ```sql
   SELECT count(*) FROM notification_outbox WHERE channel::text = 'EMAIL';
   ```

   This should return 0. `\d notification_preferences` should show no `email` column.
3. **Phone width (375px) and installed PWA:**
   - No bottom bar on any page.
   - The last row of `/stock`, `/transfers/new` and `/vendor-issues` is fully visible.
   - The toast, the PWA banner, the assembly "assign" bar and the services counter bar sit at the bottom edge with no 64px gap.
4. **The drawer (☰, right side)** shows the user card, Home, Approvals, every module the user can view, My notifications, Sign out and More. Sign out works.
5. **As a normal user**, My notifications shows **only Push** per event, and saving works.
6. **As an admin:**
   - The Events table has no Email column.
   - The SMTP tab is labelled for PO sending, and its test email still arrives.
   - Sending a PO to a vendor by email still works and a `PurchaseOrderSend` row is written.
7. Trigger any notification (e.g. a Zoho pull). A PUSH outbox row is written and **no** EMAIL row.
8. Category labels:
   - `/stock` bulk assign shows `SS (26) · 529`.
   - The filter shows `SS (26)` when selected.
   - A `SPARES` product shows `SPARES`.
   - brand-count lists each sub-category once.

---

## 5. Out of scope, deliberately

- **The SMTP config, `email.ts` and PO emailing.** Kept for vendor POs (Q4). Emailing a vendor is not a user notification.
- **Dropping `User.navTabs`.** That happens in the release after this one.
- **A size column or size parsed from product names.** Ruled out by the owner on 1, 9 and 11 Sep.
- **Moving products that are in the wrong size category**, e.g. "SPRINT SLINGSHOT+26T" filed under `24 MS`. That is data, not code; raise it separately.
- **The desktop sidebar.** It is unchanged.
- **The `/more` page.** It stays, reached from the drawer.
