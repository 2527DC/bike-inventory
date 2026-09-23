# Bottom bar without "More"; no email notifications; a notifications inbox with an icon count

Status: pending — rewritten 23 Sep 2026 after the owner answered the questions one by one (§1.1).
**Every question is answered** (§1.1, last round 23 Sep 2026). Waiting for the owner's approval. Nothing is built. The owner said "dont implment it".
Branch: `feat/2309-bottom-nav-no-more-email-removal`, created from `main` on 23 Sep 2026 on the
owner's instruction. Nothing is committed.

The file name still says "category-size". That requirement was **dropped by the owner** (R5 below).
The name is kept so earlier links to this file still work.

Every `file:line` below was read from disk on 23 Sep 2026. Check it rather than trust it.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (23 Sep 2026)

First request:

> create a implementation plan where by listing the requiremnet the requirement are one thing is i need to remove the more bootm nav bar and let keep the elemnets in the right side sidebar at the phone or pwa and t i need to know about the notification where in the normal user he he seeaing the notification toggler thing where no one has the email notification the thing is we dont use the eamil fr the notification we will not notiy any user with emil remove any level if ther i option in data baser and also in the ui level and need the name with size at the categor in the brackets

> jsut create the implementation plan dont implemnt it

The bottom bar, corrected:

> i ned the bottom nav bar where i think only 5 items can be pined per user   in that i think we always have that more thing i need to remove that one elemnt lets us see only the  bottom nav bar which is  given  to the use i dont need that more  bottom navbutton   and i need u to ask the questions one by one

Email:

> see i am using the email for only the smtp intigration with the po where i dont want to make it enable dsable  by default it must be there thats it and leaving that i dont need to use as of now teh email for anything so remove any ui and related to those things

> keep the switch or else remove it where switch and if teh smtp is not set let in the po show it that set the smtp to send email to vendors

Category size, then dropped:

> i need it like the word we have as category and sub category na  in that lable just say ( size ) thats it

> no leave it dont change drop this req

The notifications screen, sound and count:

> i need u to also create a  notifications listing screen where it list the push notifications  and i need u to tell me this on recivising the push notification can i get the sound in pwa or in web if so let me know how

> i need u to check can this sound feature on reciving the notification be done  if so how tell me where can  we get the notification sound only when the aplication is open or can we also get the sound if the   user is in another tab but the ablication is opend in another tab and tell me how it work in the pwa will it give the notification sound when the pwa app is not opend and can it show the count of notification in the pwa if so let me know how

> ok update the implmenation plan with this requiremnt

Where the count goes (answering Q19):

> i think i dont need to code in the desktop  folder use the  normal dashboard  dont doe in desktop where we use in phone and laptops and pwa

> in the header of the aplication web dont need in the sidebar  let it be in the header for both the pwa and web

The logout-to-localhost question in the same conversation was answered in chat. It is a
configuration fix, not code, so it is in §5 and not a requirement here.

### 0.2 Restated as requirements

1. **R1** — The phone/PWA bottom bar **stays**. Only its **More** button is removed. The bar shows **Home + the tabs the admin pinned for that user** (up to 4). Nothing else changes.
2. **R2** — `/more` is still reachable. It stays as it is, opened from the ☰ drawer's existing link.
3. **R3** — Normal users no longer see an **Email** notification toggle.
4. **R4** — The app never notifies a user by email. Remove the email notification option at **every level**: UI, API, server logic and database.
5. **R5** — ~~Category labels say "(Size)"~~ — **dropped by the owner, 23 Sep 2026.** Not built.
6. **R6** — SMTP stays **only** for emailing purchase orders to vendors, with **no enable/disable switch**. If SMTP is filled in, PO email works.
7. **R7** — When SMTP is not set up, the **PO screen says so plainly**: set up SMTP to send POs to vendors by email.
8. **R8** — A **notifications list screen**. Each user sees the notifications sent to them.
9. **R9** — The count of unread notifications shows **inside the app, in the header** (a bell), on phone, PWA **and** laptop, **not in the sidebar**. It also shows **on the installed PWA's icon**, wherever the device supports it. All of this is in the normal dashboard, `src/app/(dashboard)/`. **Nothing goes in `src/app/desktop/`.**
10. **R10** — A notification plays a **sound** when it arrives. Everywhere, the device plays its own sound (§2.5). The app adds its own chime **only when it is the tab in front** (Q11).
11. **R11** — This plan only. No code is written until the owner approves it.

---

## 1. Questions and clarifications

### 1.1 Decisions on record

Asked one at a time, 23 Sep 2026. The owner answered every question in this table.

| # | Req | Question | Answer |
|---|---|---|---|
| Q1 | R1 | What does the bar show once More is removed? | **Home + up to 4 pinned tabs.** The limit stays at `MAX_NAV_TABS = 4`. |
| Q2 | R2 | How is `/more` reached without the More button? | **Keep the ☰ drawer's existing link.** `/more` is unchanged. |
| Q3 | R4, R6 | Does PO email stay? | **Yes.** SMTP is used only for PO email. Everything else about email goes. |
| Q4 | R6 | What does the admin SMTP screen keep? | **The SMTP fields and the Test send button.** The enable switch goes. |
| Q5 | R7 | What happens on a PO when SMTP is not set? | The PO **says so**: set up SMTP to send email to vendors. |
| Q6 | R4 | Delete the old `EMAIL` outbox rows? | **Yes, delete them.** |
| Q7 | R4 | When are the unused email columns dropped? | **In this release**, in the same PR as the code. |
| Q8 | R4, R6 | Drop the SMTP switch's column (`notification_config.emailEnabled`) too? | **Yes.** |
| Q9 | — | Drop the dead `Product.size` column in the same migration? | **Yes.** |
| Q10 | — | Where is the migration applied? | The owner says the Supabase database in `.env` is **a test copy**. The migration is written without touching any database (§3, B5), the owner reads the SQL, and then Claude runs `prisma migrate deploy` against it. **Never** `migrate dev` or `db push` there. |
| Q12 | R8 | Who is the list for? | **Each user sees only their own.** |
| Q13 | R9 | Read and unread? | **Yes.** Unread items are bold, a header bell shows the count, and there is a "Mark all read" button. |
| Q14 | R8 | Which notifications go into the inbox? | **Every one meant for that user**, even if they have no registered device or turned push off for that event. |
| Q15 | R8 | How long are notifications kept? | **The newest 200 per user.** Older ones are trimmed each time a new one is written, so no cron is needed. |
| Q16 | R8, R9 | Where does the inbox open from? | **A header bell** that opens `/notifications`. |
| Q17 | R5 | Category "(Size)" labels? | **Dropped.** |
| Q11 | R10 | Should the app play its own chime while it is open? | **(b) Only when the app is the tab in front.** In every other case only the device sound plays. |
| Q18 | R8 | An event an admin switched off, or push switched off completely: is it still listed? | **No.** "Off" reaches nobody. The user's own opt-out and a missing device still get listed (Q14). |
| Q19 | R9 | Where does the count go on a laptop screen? | **In a header, not the sidebar.** Nothing goes in `src/app/desktop/`. The normal dashboard gets a **slim laptop bar with only the bell**. The sidebar is unchanged. |
| — | — | Which branch? | **A new branch from `main`**: `feat/2309-bottom-nav-no-more-email-removal`. |

### 1.2 Still open

None.

---

## 2. How it works today — verified against the code

### 2.1 The bottom bar

- `src/components/bottom-nav.tsx:20-29` builds **Home**, the pinned tabs, then **More** (a link to `/more`). A full bar is Home + 4 + More = 6 buttons.
- `src/lib/nav-tabs.ts:11` sets `MAX_NAV_TABS = 4`. The comment at `:7-8` says "a full bar is Home + MAX_NAV_TABS + More".
- `bottom-nav.tsx:36` shows no bar when nothing is pinned (`hasNav` false, `src/lib/use-bottom-nav.ts`). That is unchanged.
- The ☰ drawer links to `/more` at `src/components/header-menu.tsx:247-260`. `/more` (`more/page.tsx`) holds:
  - the profile card
  - My notifications
  - the Zoho "Clear stuck syncs" panel
  - Sign out
  - the version line

### 2.2 Email as a notification channel

`c5a4317` hard-coded it off, but it is still visible and still stored:

| Level | Where | What |
|---|---|---|
| **User UI** | `src/components/notification-preferences.tsx:27,70,122,160-173`, rendered at `more/page.tsx:90` | an **Email** switch per event |
| **User API** | `src/app/api/notifications/preferences/route.ts:23-25,33,52,64,105,119-120` | zod `email: z.boolean()`, upserted |
| **Admin UI** | `settings/notifications/page.tsx:690-795` (EventsTable) | Email column `:753`, "PO Only" badge `:770-774`, sends `email:false` `:715-717` |
| **Admin API** | `src/app/api/notifications/events/route.ts:25,45,88-89` | zod `email`, upserts `emailEnabled` |
| **Server** | `src/lib/notify/index.ts` | reads `emailEnabled` as the email master switch (`:84-90`); `emailOn = false` (`:95`); writes an `EMAIL`/`SKIPPED` row on **every** call (`:103-108`); `wantsEmail` (`:124`); a dead email fan-out (`:179-191`); `absoluteUrl` is used only by that block (`:310-315`) |
| **Types / defaults** | `src/lib/notify/types.ts:14,264-293`; `src/lib/notify/events.ts:24,31-71` (stale header `:12-16`) | `Channel = "PUSH" \| "EMAIL"`, `email` fields, `defaults.email` |
| **Database** | `schema.prisma`: `NotificationEventSetting.emailEnabled`, `NotificationPreference.email`, `enum NotificationChannel { PUSH EMAIL }`, `NotificationOutbox.channel` | since `0_init` |
| **Docs** | `docs/notifications-guide.md` | a "turn on email" runbook |
| **Email footer** | `src/lib/notify/email.ts:471` | "Change them under More → My notifications" |

### 2.3 The SMTP switch and the PO screen

- **Admin screen:** `settings/notifications/page.tsx:340-343` has an **"Email enabled"** switch. `:829` shows an Enabled/Disabled badge.
- **API:** `api/notifications/config/route.ts:144, 221, 313` reads and writes `emailEnabled`.
- **The switch blocks PO email:** `src/lib/notify/email.ts:260-267` refuses with "Email sending is switched off". `checkEmailReady()` (`:205`) therefore reports "not ready", and PO email is blocked even when SMTP is filled in.
- **The PO page** (`purchase-orders/[id]/page.tsx`) already reads `/api/notifications/status` (`:88-96`). When email is not ready, it disables **Send to vendor**, but the reason appears only as:
  - a hover **tooltip**, "Email not configured — Settings › Notifications" (`:258, :299`), which a phone never shows
  - a small grey line at `:328-336`

### 2.4 Nothing stores a notification's text

- `NotificationOutbox` (`schema.prisma:1740-1765`) keeps the event, channel, status, user, masked device and `refId`. It has **no title, no body, no link and no read state**. It is a delivery log, not an inbox.
- `notify()` (`notify/index.ts:56`) receives `input.title`, `input.body` and `input.link`, and passes them only to `sendPush` (`:151-163`).
- **For the unread count, follow the pattern of `src/components/approvals-badge.tsx:32-52`.** It reads once per navigation, with **no timer** (CLAUDE.md, "There are no scheduled jobs").
- **There is no top header on desktop.** `app-sidebar.tsx:197` carries `ApprovalsNavLink`. The phone header (`src/components/header.tsx:33-45`) carries `ApprovalsBadge`.

### 2.5 Push, sound and the icon count — what the platform allows

- `public/sw.js:95-135` handles **every** push itself and always calls `showNotification`, with no `silent` flag. So a system notification with the **device's default sound** is shown whether the app is in front, in a background tab, or closed.
  - `enable-push-button.tsx:15` explains why there is deliberately no `onMessage()`.
- **Sound when closed:**
  - **Android:** yes. Phones with aggressive battery savers need "No restrictions" for Chrome or the app.
  - **iPhone:** yes, on iOS 16.4+ and only for a Home Screen app.
  - **Desktop:** yes while Chrome is running, even with no window open.
  - A **custom** sound is impossible when the app is closed. The spec's `sound` option is implemented by no browser.
- **The app's own chime (Q11):** only a page that is open can play audio. The service worker `postMessage`s every open client, and the page plays a file. Browsers allow this only after the user has tapped or clicked the page once since it loaded.
- **The icon count** uses the Badging API, `navigator.setAppBadge(n)`, which the service worker can call inside the push handler, even when the app is closed.
  - **Yes:** installed PWA on Windows or macOS (Chrome or Edge); iOS 16.4+ Home Screen app.
  - **No:** on **Android** the launcher shows its own dot or count from the tray, not ours. Firefox and a Safari tab don't support it.
- **Nothing calls `setAppBadge` or `clearAppBadge` today** (grep of `public/` and `src/`).

---

## 3. Implementation plan

### Part A — the bottom bar without More (R1, R2)

**A1.** `src/components/bottom-nav.tsx`:
- remove the `more` entry (`:28`) and the `MoreHorizontal` import (`:5`)
- update the header comment (`:9-13`) to say "Home is always present; More was removed on 23 Sep 2026, and `/more` is reached from the ☰ drawer"

**A2.** `src/lib/nav-tabs.ts:7-8`: fix the comment to say a full bar is Home + `MAX_NAV_TABS`. The number stays at 4 (Q1).

**A3.** `/more`, the drawer link, the pin editor on `/team/[id]`, `User.navTabs`, `hasNav` and the `.above-nav` offsets are all **unchanged**. The bar keeps its height, so no offset moves.

### Part B — email is never a notification (R3, R4)

**B1. User UI:** in `notification-preferences.tsx`:
- remove the Email switch (`:160-173`), its skeleton row (`:122`), `"email"` from `ChannelField` (`:27`) and the payload field (`:70`)
- one switch remains per event: **Push**

**B2. User API:** `api/notifications/preferences/route.ts` drops `email` from zod (known keys stay strict, unknown keys are stripped, so a cached old client still saves) and from the GET.

**B3. Admin events:**
- In EventsTable, remove the Email column, the "PO Only" badge and `email:false` (`:715-717, 746, 753, 770-774`).
- In `api/notifications/events/route.ts`, drop `email` / `emailEnabled` (`:25, 45, 88-89`).

**B4. Server**, in `notify/index.ts`:
- select only `pushEnabled` from the config (`:84-90`)
- delete `emailOn` and the EMAIL/SKIPPED write (`:95-108`), `wantsEmail` (`:124`), the email fan-out (`:179-191`), `absoluteUrl` (`:310-315`) and the `sendEmail`/`maskEmail` import (`:34`)
- update the file header (`:1-6`) to say "push"

Also:
- `events.ts`: `defaults` becomes `{ push }`, and fix the stale header.
- `types.ts`: `Channel = "PUSH"`, and drop the `email` fields.
- `email.ts:471`: remove the "My notifications" footer line.

**B5. Database:** one migration, `<ts>_notification_inbox_remove_email`. It carries Part B, Part C's `emailEnabled` drop and Part D's new table (Q6–Q10).

- **How it is written:** `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`, **or** `migrate dev --create-only` against localhost only.
  - The diff route needs a shadow database, given as `--shadow-database-url` pointing at a **local** Postgres. If none is available, Claude stops and asks rather than touching Supabase.
  - The owner reads the SQL. **Claude then runs `npx prisma migrate status` and `npx prisma migrate deploy` against the Supabase test database** (Q10). Never `migrate dev`, `db push`, `reset` or `--accept-data-loss` there.
- **Order of statements:**

```sql
DELETE FROM "notification_outbox" WHERE "channel" = 'EMAIL';                  -- Q6
ALTER TABLE "notification_event_settings" DROP COLUMN "emailEnabled";        -- R4
ALTER TABLE "notification_preferences"    DROP COLUMN "email";               -- R4
ALTER TABLE "notification_config"         DROP COLUMN "emailEnabled";        -- Q8
-- NotificationChannel becomes PUSH-only: Postgres cannot drop an enum value, so Prisma
-- renames the type, creates the new one, casts the column, and drops the old type.
ALTER TABLE "Product" DROP COLUMN "size";                                     -- Q9
CREATE TABLE "notification_inbox" (...);                                       -- Part D
```

- **Rule 7 (additive first) is broken on purpose, by the owner's choice (Q7).** Today's code reads the dropped columns, so **the migration and the code must go live together**. If the migration runs first, the running app errors on the notification screens and in `notify()` until the new code is deployed.
- **Rule 9:** `npm run db:snapshot` before the PR merges. Read the enum recreate SQL line by line (rule 3).
- **Before writing any of this,** grep for every reader of each dropped column (`emailEnabled`, `.email` on preferences, `Product.size`) and list them in the PR.

**B6. Docs:**
- Rewrite `docs/notifications-guide.md` as push only, plus a section "SMTP is for PO email only".
- Add a note to `docs/implementation/pending/notifications-and-settings-rbac-plan.md` that email as a notification channel was withdrawn on 23 Sep 2026.

### Part C — SMTP for PO email only, no switch (R6, R7)

**C1. Admin screen** (`settings/notifications/page.tsx`):
- remove the "Email enabled" switch (`:340-343`) and `enabled` from the email form state (`:174, 187, 228`)
- the status line (`:283`, `StatusLine` `:819-829`) shows only Connected / Not tested for email; push keeps its Enabled badge
- rename the tab to **"Email (PO sending)"**, with the note: *"Used only to send purchase orders to vendors. Staff are never notified by email."*
- the SMTP fields and **Test send** stay (Q4)

**C2. API** (`api/notifications/config/route.ts`): drop `enabled` from the email zod object and from the read and write (`:144, 221, 313`).

**C3. `email.ts` `loadSettings()`:** delete the `emailEnabled` check (`:260-267`). Email is then "ready" exactly when SMTP is complete. `checkEmailReady()` needs no other change.

**C4. PO page** (`purchase-orders/[id]/page.tsx`): when `emailReady === false`, show a **visible amber line under the buttons**, not only a tooltip:
- the text is **"Email to vendors is not set up. Set up SMTP in Settings › Notifications › Email (PO sending) to send POs by email."**
- a clerk without settings access gets the same line, ending "… ask an admin to set up SMTP"
- **Mark sent** stays as the other way through
- the tooltips at `:258, :299` use the same wording

**C5.** Wording: `settings/page.tsx:52` and `rbac-catalog.ts:788` become "Push notifications, and the SMTP used to email purchase orders". This is description text only; the owner runs `npm run db:seed:rbac` after the deploy.

### Part D — the notifications inbox (R8, R9)

**D1. Schema:** a new model, in the same migration as B5:

```prisma
/// One row per notification per recipient: what the user sees on /notifications.
/// Not the delivery log — that is NotificationOutbox. Trimmed to the newest 200 per user.
model NotificationInbox {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  eventKey  String
  title     String
  body      String    @db.Text
  link      String?
  refId     String?
  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@map("notification_inbox")
}
```

- **Cascade on user delete is deliberate.** This is the user's own inbox, not an audit log. The outbox keeps the delivery history without a foreign key.
- Run this model past the `schema-reviewer` agent before the migration is written.

**D2. Write it in `notify()`**, right after recipients are resolved (the `users` query at `:113-116`):
- Q18 (b): only when the push master switch is on **and** the event is switched on (`pushOn`, `:94`). The write is not affected by the user's own opt-out or by a missing device (Q14).
- One `createMany` for every active recipient.
- **Trim to 200 per user** in one statement:
  ```sql
  DELETE FROM notification_inbox WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) rn
                    FROM notification_inbox WHERE "userId" = ANY($1)) t WHERE rn > 200)
  ```
- Read each recipient's **unread count** with one `groupBy`, and add it to the push `data` as `unread` (a string, as FCM requires).
- The write has its own try/catch that logs `log.error("inbox write failed", { eventKey, refId, users })` and carries on. `notify()` still never throws (rule 1 in its header).

**D3. API.** Every route is authentication only (`requireAuth`). No module check, because it is the user's own data. Every query filters `userId: user.id`.

| Route | Does |
|---|---|
| `GET /api/notifications/inbox?cursor=` | the user's rows, newest first, 30 at a time |
| `GET /api/notifications/inbox?count=1` | `{ unread }`, for the bell (the same pattern as approvals) |
| `POST /api/notifications/inbox/read` | `{ ids }` or `{ all: true }` → sets `readAt`, and returns the new `unread` |

- Zod on each route, and `successResponse` / `errorResponse`.
- Log at debug for reads and at info for mark-all.

**D4. Screen: `/notifications`** (`src/app/(dashboard)/notifications/page.tsx`):
- A list: bold title plus body for unread, normal weight for read, a relative time, tap to open its `link` (marking it read).
- **"Mark all read"** at the top.
- Loading skeleton, empty state ("No notifications yet"), and an error state with retry. Mobile-first, BCH OPS styling.
- Uses `apiFetch` / `apiTry` only, never a raw `.json()`.

**D5. The bell (R9):**
- **Phone:** a `NotificationsBell` in `header.tsx`, next to `ApprovalsBadge` (`:35`). It is a bell icon with a red count that is hidden at 0, and it links to `/notifications`.
- **Laptop, lg and up (Q19):** the phone header is `lg:hidden` (`(dashboard)/layout.tsx:48-50`), so a new **slim bar** shows only at `lg` and up, above `<main>` (`:52`).
  - It is right-aligned, about 48px tall, with a bottom border.
  - It holds only the same `NotificationsBell`. The logo, the name and the menu stay in the sidebar, so nothing appears twice.
  - **`app-sidebar.tsx` is not changed.**
- **Not in `src/app/desktop/`.** That folder is not touched.
- The count is read **once per navigation**, as `approvals-badge.tsx` does, and also when the service worker says a push arrived (D6). **No timer, no polling.**

**D6. The icon count and the service worker** (`public/sw.js`):
- In the push handler, after `showNotification`: `if (self.navigator.setAppBadge && data.unread) self.navigator.setAppBadge(Number(data.unread))`, guarded and in its own `.catch`.
- `postMessage({ type: "push-received" })` to every open client (`clients.matchAll`). The bell re-reads its count on this message.
- **On the page:** whenever the bell learns a count, it calls `navigator.setAppBadge(n)`, or `clearAppBadge()` at 0, if supported. So reading notifications in the app clears the icon.
- Bump the service worker's version or cache name, so installed PWAs pick up the new worker.

**D7. The chime (Q11 (b)):**
- Add `public/sounds/notify.mp3`, short and small.
- On `push-received`, the page plays it with `new Audio(...)`, only when `document.visibilityState === "visible"` **and** the window has focus (`document.hasFocus()`). A rejected `play()` (autoplay blocked) is logged at debug and ignored.

### RBAC

- No new module, no new action, no role-name checks.
- `/notifications` and `/api/notifications/inbox*` are **authentication only**, like `/more`.
- Only description text changes (C5), so the owner runs `npm run db:seed:rbac` after the deploy.

### Logging

- `notify` keeps its `createLogger("notify")` scope, and the "email skipped" line goes with the code.
- The new inbox routes use `createLogger("notifications:inbox")`.
- The bell uses `createLogger("notifications:bell")`, with a failed count logged at debug and shown as nothing.
- The service worker keeps its existing `console.error` convention in `sw.js`, which the logger cannot reach.
- Every new `catch` logs before it swallows.

### Board of agents

| Agent | Check |
|---|---|
| **Database** | the inbox model, indexes and cascade; the enum recreate SQL; the trim query; snapshot before merge; all drops in one release are the owner's call (Q7) |
| **Backend** | every inbox query scoped to `user.id`; `notify()` still never throws; zod strips old `email` keys |
| **Frontend** | the bell and list follow approvals-badge (no polling); the laptop bar does not shift the sidebar or `.above-nav` pages; loading, empty and error states; the PO amber line is visible on a phone |
| **Integration** | `sw.js`: badge and postMessage never block `showNotification`; the PO email path is verified by a real send after the switch is removed |

---

## 4. Verification

1. `npx tsc --noEmit` passes. Then `npm run build`, which the owner runs.
2. `npx prisma migrate status` on the Supabase test database is up to date after `migrate deploy`. Then:
   - `SELECT count(*) FROM notification_outbox WHERE channel::text='EMAIL'` returns 0
   - `notification_preferences.email`, `notification_event_settings.emailEnabled`, `notification_config.emailEnabled` and `Product.size` are gone
   - `notification_inbox` exists
3. **Bottom bar (375px and installed PWA):**
   - a user with pins sees Home + their pins and **no More**
   - a user with no pins sees no bar
   - ☰ → "More, settings and sign out" still opens `/more`, and Sign out works
4. **Normal user, My notifications:** only Push per event, and saving works.
5. **Admin:**
   - the Events table has no Email column
   - the tab reads "Email (PO sending)" with no Enabled switch
   - Test send arrives
6. **PO:**
   - with SMTP complete, **Send to vendor** sends and writes a `PurchaseOrderSend` row
   - with the SMTP host cleared on the test database, the button is disabled and the **amber line** is visible on a phone
7. **Inbox:**
   - trigger a notification, e.g. a Zoho pull
   - an inbox row exists for each recipient, **including** one who turned push off for the event
   - the bell shows 1, and opening it and tapping the item marks it read, so the bell hides
   - "Mark all read" works
   - write 205 rows for one user, and only the newest 200 are left
   - one user cannot see another's rows (`GET` as user B returns only B's)
8. **Icon count and sound:**
   - Installed PWA on Windows or Mac Chrome: a push sets the icon number, and reading clears it.
   - Android: the notification arrives **with the device sound** while the app is closed.
   - iPhone Home Screen app, if one is available: the same.
   - App open in a background tab: the system notification shows with sound, and on returning the bell count is already updated.
   - The chime (Q11 b) plays when the app is the tab in front, and **not** when it is in a background tab; there, only the device sound plays.
   - Laptop width: the slim header bar shows the bell with the count, and the sidebar has **no** Notifications row.
   - Trigger an event that an admin switched off: nothing is listed and nothing is pushed (Q18).
9. A push with no inbox (push master off) still writes the outbox SKIPPED row as today.

---

## 5. Out of scope, deliberately

- **Category "(Size)" labels (R5).** Dropped by the owner.
- **A custom notification sound while the app is closed.** No browser supports it (§2.5).
- **A number on the Android app icon.** Android's launcher draws its own dot or count from the tray.
- **Changing the pin limit, the pin editor, `User.navTabs` or `/more`.** R1 and R2 keep them.
- **An admin view of everyone's notifications.** The owner chose "each user, their own" (Q12). `NotificationOutbox` stays the delivery log.
- **Logout redirecting to localhost in production.** Explained in chat: next-auth builds the post-signout URL from `NEXTAUTH_URL`, and the production `.env` has `http://localhost:3000`, set twice (lines 5 and 31). The fix is configuration: set one `NEXTAUTH_URL=https://<public domain>` in the VPS `.env` and in the `ENV_FILE` secret, then restart pm2. No code. The same value also makes push links absolute (`push.ts:457`).
- **The desktop app under `src/app/desktop/`.** Not touched (Q19, the owner's words).
- **A Notifications row in the sidebar.** The owner chose the header (Q19).
