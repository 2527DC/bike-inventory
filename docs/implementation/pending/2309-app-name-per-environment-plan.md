# App name per environment: "TEST BCH OPS" on the Vercel test, "BCH OPS" on the VPS

Status: pending — written 23 Sep 2026. **Every question in §1 is answered (§1.1). Waiting for the
owner's go-ahead.** Nothing built. Branch: `feat/2309-bottom-nav-no-more-email-removal` (Q7), the
same branch as plan 2309.

Every `file:line` below was read from disk on 23 Sep 2026.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (23 Sep 2026)

> and another thing that for the test ie for the test which is getting deployed in the versel  the aplication name must be test bch ops and for the production vps it must be BCH OPS how can i do it

> ok do it

### 0.2 Restated as requirements

1. **R1** — The test deployment on **Vercel** shows the application name **"TEST BCH OPS"** (exact form: Q1).
2. **R2** — The production deployment on the **VPS** shows **"BCH OPS"**.
3. **R3** — "Application name" covers every place a person sees it: the installed app's name on the home screen or taskbar, the browser tab, the header, the sidebar, the login page, the install banner, and notification titles.
4. **R4** — Nothing is duplicated per environment in code. One setting decides the name, and each deployment sets it (or doesn't).
5. **R5** — `src/app/desktop/` is not touched (owner, 23 Sep 2026: "dont doe in desktop").

---

## 1. Questions and clarifications

| # | Req | Question | Why it changes the build | Options | Recommended default |
|---|---|---|---|---|---|
| Q1 | R1 | Exact test name? | It is the literal string. | (a) **`TEST BCH OPS`** (b) `Test BCH OPS` (c) `BCH OPS (TEST)` | **(a)**, all caps like the production name |
| Q2 | R4 | How does a build know it is the test? | Decides who must set what. | (a) **An env var `NEXT_PUBLIC_APP_NAME`**, set to `TEST BCH OPS` in Vercel's project settings; default `BCH OPS` when unset (b) Detect Vercel automatically (`VERCEL=1` is set on every Vercel build) and use the test name there | **(a)**. It is explicit, and a future production deploy on Vercel would not silently be called TEST. |
| Q3 | R1 | Should the test build also **look** different, beyond the name? | The two use the same logo and colours, so they are easy to mix up on a phone. | (a) **No**, only the name (b) An amber "TEST" strip at the top of every screen (c) A "TEST" ribbon on the app icon, which needs a second icon set | **(a)** now. (b) is small and can be added later. |
| Q4 | R3 | The WhatsApp message footer "_Sent from BCH OPS App_" (`(dashboard)/activity/page.tsx:186`, `(dashboard)/vendor-issues/page.tsx:421`) goes to real people. Should it use the setting too? | Test messages would say "Sent from TEST BCH OPS App". | (a) **Yes**, so a message sent from the test is recognisable (b) No, always "BCH OPS" | **(a)** |
| Q5 | R3 | The long manifest name "BCH OPS — Inventory & Operations" (`public/manifest.json:2`): prefix it too? | It shows in install dialogs and app settings. | (a) **Yes**: `TEST BCH OPS — Inventory & Operations` (b) Keep the long name the same | **(a)** |
| Q6 | R3 | The SMTP test email ("BCH Ops — test email", `src/lib/notify/email.ts:166-172, 462`) and the test push title ("BCH Ops — test notification", `src/lib/notify/push.ts:186`)? | These are only seen by the admin testing the setup. | (a) **Yes, use the setting** (b) Leave as is | **(a)** |
| Q7 | — | Which branch? | This is separate from plan 2309 (bottom bar / email / inbox). | (a) **A new branch from `main`**, after plan 2309 merges (b) The same branch as plan 2309 | **(a)** |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 23 Sep 2026 | Q1 | **`TEST BCH OPS`**, all capitals. |
| 23 Sep 2026 | Q2 | **An env var `NEXT_PUBLIC_APP_NAME`**, set in Vercel. With no setting the name is `BCH OPS`. |
| 23 Sep 2026 | Q3 | **Name only.** No TEST strip, no icon change. |
| 23 Sep 2026 | Q4 | **Yes.** The WhatsApp footer uses the name. |
| 23 Sep 2026 | Q5 | **Yes.** The long manifest name is prefixed too. |
| 23 Sep 2026 | Q6 | **Yes.** The SMTP test email and the test push use the name. |
| 23 Sep 2026 | Q7 | **The same branch as plan 2309**, `feat/2309-bottom-nav-no-more-email-removal`. |

---

## 2. How it works today — verified against the code

- **The name is hard-coded in 12 places** (grep, 23 Sep 2026):
  - `src/app/layout.tsx:39` `title: "BCH OPS"`, `:45` `appleWebApp.title: "BCH OPS"`, `:41` `manifest: "/manifest.json"`
  - `public/manifest.json:2-3` — `name` and `short_name`
  - `src/components/header.tsx:29, 31` — logo `alt` and the text
  - `src/components/app-sidebar.tsx:163-164`
  - `src/app/login/page.tsx:54-55`
  - `src/components/pwa-install-banner.tsx:82` "Install BCH OPS App"
  - `src/components/enable-push-button.tsx:167` "add BCH OPS to the Home Screen"
  - `src/app/(dashboard)/more/page.tsx:210` version line "BCH OPS v0.8.0 | Final"
  - `public/sw.js:63` `PUSH_DEFAULT_TITLE`, `:249` quick-approve failure message
  - `src/lib/notify/push.ts:186`, `src/lib/notify/email.ts:166-172, 462`
  - WhatsApp footers (Q4)
- **The installed app's name comes from `public/manifest.json`.** It is a static file, so it cannot differ between two builds of the same code.
- **Vercel builds with `node scripts/vercel-build.mjs`** (`vercel.json`). **The VPS builds in GitHub Actions** (`.github/workflows/deploy-vps.yml:427-431`, `npm run build`). Each is a separate build, so a build-time value can differ between them.
- **Next.js supports a generated manifest.** Put `src/app/manifest.ts` in place and Next.js serves it at `/manifest.webmanifest` and adds the `<link rel="manifest">` itself (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`). The middleware already lets `.webmanifest` through without login (`src/middleware.ts:62`).

---

## 3. Implementation plan

Assumes the recommended defaults.

### Phase 1 — one setting, read everywhere (R1–R4)

**1.1** `src/lib/app-name.ts`:
```ts
/** The name people see. "TEST BCH OPS" on the Vercel test (set in Vercel), "BCH OPS" everywhere else. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "BCH OPS";
```
A `NEXT_PUBLIC_` value is inlined at **build** time, in server and browser code alike.

**1.2 The manifest:**
- Move `public/manifest.json` to **`src/app/manifest.ts`**, the same content with `name` = `` `${APP_NAME} — Inventory & Operations` `` (Q5) and `short_name` = `APP_NAME`.
- Delete `public/manifest.json` and the `manifest:` line in `layout.tsx:41`, because Next.js adds the link itself.

**1.3** Replace the literal in each place listed in §2 with `APP_NAME`: `layout.tsx` (both titles), `header.tsx`, `app-sidebar.tsx`, `login/page.tsx`, `pwa-install-banner.tsx`, `enable-push-button.tsx`, `more/page.tsx`, `push.ts`, `email.ts` (Q6), and the two WhatsApp footers (Q4).

**1.4 The service worker** (`public/sw.js`) is a static file and cannot read the setting.
- `PUSH_DEFAULT_TITLE` is only a fallback: every real push carries its own title from the server, which will now use `APP_NAME`.
- Change it to the neutral "BCH OPS", and word the `:249` message as "Could not reach the server".

**1.5 Settings to set, and who sets them:**
- **Vercel** → Project → Settings → Environment Variables → `NEXT_PUBLIC_APP_NAME` = `TEST BCH OPS` (Production and Preview), then **Redeploy**. Set by the owner.
- **VPS:** nothing is needed, because the default is `BCH OPS`. To make it explicit, add `NEXT_PUBLIC_APP_NAME: BCH OPS` to the Build step `env:` in `deploy-vps.yml:428-431`. A line in the VPS `.env` alone does **not** work, because the value is fixed at build time.
- Add `NEXT_PUBLIC_APP_NAME=` with a comment to `.env.example`, if the file exists.

### Logging
No new behaviour to log. `APP_NAME` is a constant, so there are no new code paths.

### Board of agents
- **Frontend:** the header and sidebar truncate a longer name, "TEST BCH OPS", cleanly at 375px.
- **Integration:** the WhatsApp footer change (Q4).

---

## 4. Verification

1. `npx tsc --noEmit`, then `npm run build`.
2. **Locally, without the setting:** the tab, header, sidebar and login show "BCH OPS", and `/manifest.webmanifest` has `short_name: "BCH OPS"`.
3. **Locally, with `NEXT_PUBLIC_APP_NAME="TEST BCH OPS" npm run build && npm start`:** every place in §2 shows "TEST BCH OPS". At 375px the header does not wrap or overflow.
4. **On Vercel, after setting the variable and redeploying:** install the app, and the home-screen name is "TEST BCH OPS".
5. **On the VPS, after deploy:** still "BCH OPS".
6. **Already installed apps:**
   - Android Chrome picks up a new name from the manifest on its own, usually within a day.
   - **iPhone never updates it.** Remove the app and add it to the Home Screen again.

---

## 5. Out of scope

- `src/app/desktop/` (R5).
- A different icon or colour for the test build (Q3 (b)/(c)), unless the owner picks one.
- `NEXTAUTH_URL` on Vercel. It must be the Vercel `https://` address for logout and push links to work there, the same fix as on the VPS. That is configuration only and is noted here as a reminder.
