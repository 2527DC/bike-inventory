# Dark mode: the UI must stay readable when the phone or laptop is in dark mode

Status: pending — **plan only.** The owner answered Q1, Q2, Q3, Q6 and Q7 on 23 Sep 2026 (§1.1)
and said: "as of now jsut create the implmenation plan i will  let u know when to apply". **Do not
build until the owner says so.** Q4 and Q5 were not asked; their defaults apply unless the owner
says otherwise. Branch: chosen when the owner says to apply it (Q0).

Every `file:line` below was read from disk on 23 Sep 2026. Check rather than trust.

---

## 0. Requirement

### 0.1 The owner's words, verbatim (23 Sep 2026)

> and also i need to know  is this aplication setted for the dark mode also because if the phone or the laptop is in dark mode  the ui completely changes why   create a agent to review on this issue and create a plan regarding it  so that the ui must be properly vissible in the dark mode also

### 0.2 Restated as requirements

1. **R1** — Answer the question: is the application set up for dark mode today? (Answer: no. See §2.)
2. **R2** — Explain *why* the UI changes when the phone or laptop is in dark mode.
3. **R3** — When a phone (Android or iPhone, browser or installed app) is in dark mode, every screen must be properly visible: readable text, visible inputs, buttons and borders.
4. **R4** — The same on a laptop in dark mode (Chrome, Edge, Safari).
5. **R5** — The UI must no longer "completely change" in an uncontrolled way. What the user sees in dark mode must be something we chose, not something the browser guessed.
6. **R6** — The review is done by an agent and written up as this plan. Nothing is built until the owner answers §1.

---

## 1. Questions and clarifications — answer before build

A recommended default is given for each, so the owner can answer "defaults" in one word.

| # | Req | Question | Why it changes the build | Options | Recommended default | **Answer** |
|---|---|---|---|---|---|---|
| **Q0** | — | Which branch? | The current branch `feat/2309-bottom-nav-no-more-email-removal` has unrelated uncommitted work. | (a) new branch off `main`, e.g. `fix/2309-dark-mode-light-only`; (b) the current branch | (a) | |
| **Q1** | R3 R4 R5 | **The core choice.** Force the app to always look LIGHT, or build a real dark theme? | Light-only is ~3 small edits and stops the problem today. A real dark theme touches ~200 of 307 screen files (§2.4). | (a) **Light only, always** — declare `color-scheme: only light`, switch off Tailwind's automatic `dark:`; (b) **real dark theme now** — colour tokens + dark styles on every screen; (c) **light now (Phase 1), dark theme later** as its own project | (c) — Phase 1 alone fully meets R3–R5; the dark theme becomes a separate decision | |
| **Q2** | R3 R4 | Only if Q1 = (b) or (c)-later: when does the app go dark? | Decides whether we need a toggle, where it is stored, and a script that runs before the first paint (to avoid a white flash). | (a) follow the OS automatically; (b) a user toggle only; (c) toggle with three values — Light / Dark / Follow device | (c), stored per device in `localStorage` (no database change, no JWT change). Default = **Light** until the theme covers every screen | |
| **Q3** | R3 | The phone's status bar / PWA title bar colour. Today the page says blue `#2563eb` (`src/app/layout.tsx:50`) but the manifest says navy `#0f172a` (`public/manifest.json:11`). Which one? | The two disagree today, so the bar colour depends on whether the app was installed or opened in the browser. In a dark theme the bar would also need a dark value. | (a) navy `#0f172a` in both; (b) blue `#2563eb` in both; (c) keep as is | (a) navy in both — it matches the header. If a dark theme comes, add a second `themeColor` for dark | |
| **Q4** | R3 R4 | Are printed labels / barcode sheets, and PDF exports, in scope? | They must print black-on-white whatever the screen does. A dark theme must exclude them explicitly. | (a) always light, excluded from any dark theme; (b) themed too | (a) — paper is white | |
| **Q5** | R3 | Are the **login page** and the **public customer pages** (`/fill/[token]`, `/review/[token]`) included? | Customers open them on their own phones, many in dark mode. They share the root layout, so Phase 1 covers them automatically; a dark theme would need them designed separately. | (a) yes, same rule as the app; (b) exclude | (a) | |
| **Q6** | R5 | The four components that already carry `dark:` styles (§2.2) — remove those styles, or keep them for a future dark theme? | With Phase 1 switching the automatic `dark:` off, they become inert either way. Removing them is 193 line edits for no visible change. | (a) keep, inert; (b) strip them | (a) keep — they become useful if Q1 goes to a dark theme | |
| **Q7** | R3 | Which phones do the staff actually use? Samsung Internet in particular? | Samsung Internet's own dark mode can recolour pages even when they ask it not to. If staff use it, the fix is a browser setting, not code. | list the browsers | Tell us; we test on those first | |

### 1.1 Decisions on record

| Date | Q | Answer |
|---|---|---|
| 23 Sep 2026 | Q0 | **Not chosen.** Owner: "as of now jsut create the implmenation plan i will  let u know when to apply". |
| 23 Sep 2026 | Q1 | **(c) Light now, dark theme later.** Phase 1 only; the dark theme is its own project. |
| 23 Sep 2026 | Q2 | **(c) A Light / Dark / Follow-device toggle**, remembered per device, **starting on Light**. It applies to the later dark-theme project. |
| 23 Sep 2026 | Q3 | **(a) Navy `#0f172a`** in both `layout.tsx` and the manifest. |
| 23 Sep 2026 | Q6 | **(a) Keep** the 193 existing `dark:` styles. They do nothing after Phase 1. |
| 23 Sep 2026 | Q7 | Staff use **Chrome and the installed app**. Samsung Internet is not a priority. |
| — | Q4, Q5 | Not asked. Defaults apply: printed labels and PDFs stay light, and login plus `/fill`, `/review` follow the same light-only rule. |

---

## 2. How it works today — verified against the code

### 2.1 Short answer to R1 and R2

**No, the app is not set up for dark mode.** It was designed light-only, but it never *tells* the browser it is light-only. Two things then happen in dark mode:

1. **Tailwind switches on a few dark styles by itself.** Tailwind 4.2.2 is in use (`package.json:67`, `:76`; `postcss.config.mjs` loads `@tailwindcss/postcss`). There is no `tailwind.config.*` and no `@custom-variant dark` in `src/app/globals.css` (read in full, 174 lines). In Tailwind v4 the `dark:` prefix then defaults to `@media (prefers-color-scheme: dark)` (confirmed in `node_modules/tailwindcss/dist/lib.js`). So every `dark:` class turns on when the *device* is in dark mode — but only four files have them (§2.2). Those parts go dark; everything around them stays white. That is the "mixed" look.
2. **The browser darkens the page itself.** The app declares no `color-scheme` anywhere: no `colorScheme` in the `viewport` export (`src/app/layout.tsx:49-54`), no `<meta name="color-scheme">` in `<head>` (`src/app/layout.tsx:69-71`), and no `color-scheme` property in `globals.css`. A page that says nothing is fair game for "auto dark" features — Chrome on Android ("Darken websites" / auto-dark), Samsung Internet's dark mode, and some Android WebViews. They invert colours by algorithm: white cards turn grey-black, the blue and coloured badges shift, and images/icons can be inverted. That is the "UI completely changes" the owner sees on the phone.

On a laptop, desktop Chrome, Edge and Safari do not force-darken by default, so on a laptop the visible change is mainly (1). If a laptop shows the whole page inverted, that browser has a force-dark flag or extension switched on (e.g. `chrome://flags/#enable-force-dark`, or Dark Reader).

### 2.2 The only `dark:` styles in the app (193 lines, 4 files, `src/app/desktop/` excluded)

| File | `dark:` lines | Used on |
|---|---|---|
| `src/components/bins/bins-manager.tsx` | 154 | `/bins` (`src/app/(dashboard)/bins/page.tsx:3,9`) and the Bins tab of `/stores` (`src/app/(dashboard)/stores/page.tsx:19,163`) |
| `src/app/(dashboard)/transfers/new/_components/route-picker.tsx` | 25 | `/transfers/new` (`src/app/(dashboard)/transfers/new/page.tsx:17`) |
| `src/components/units/unit-label-sheet.tsx` | 10 | `/units/labels` and the bins manager (`bins-manager.tsx:29`) |
| `src/app/(dashboard)/units/labels/page.tsx` | 4 | `/units/labels` |

Examples of the mixed result in OS dark mode:
- `bins-manager.tsx:659` — each bin card is `bg-white … dark:bg-slate-900`, so the cards go near-black on the light-grey page body (`src/app/layout.tsx:72`, `bg-slate-50`).
- `bins-manager.tsx:911` — a shared `<Card>` (whose own base is `bg-white`, `src/components/ui/card.tsx:11`) is overridden to `dark:bg-slate-900/50`.
- `route-picker.tsx:166`, `:225`, `:253` — the route `<select>`s become `dark:bg-slate-900 dark:text-white` while every other input on the same page stays white (`src/components/ui/input.tsx:12`, `bg-white`).
- `unit-label-sheet.tsx:266` — the sheet goes dark, but its print output is separate (`unit-label-sheet.tsx:135`, `@media print`).

No other screen has any `dark:` style. No theme provider exists (no `next-themes`, no `ThemeProvider`, no `.dark` class anywhere in `src/`).

### 2.3 Colour setup that exists but is not used

- `globals.css:3-7` defines `--background: #ffffff` and `--foreground: #0f172a`, mapped to Tailwind colours at `globals.css:9-14`. They are **never flipped for dark** (no `prefers-color-scheme` in the file) and **no component uses them** — `bg-background` / `text-foreground` occur 0 times in `src/`.
- `globals.css:36-37` sets `body { background: var(--background); color: var(--foreground) }`, but the `<body>` class `bg-slate-50` at `src/app/layout.tsx:72` wins for the background.
- Hardcoded colours in CSS: `globals.css:121` (focus ring `#0f172a`), `:138`, `:146`, `:153` (scrollbar thumb `#cbd5e1` / `#94a3b8`).
- Status bar: `themeColor: "#2563eb"` (`src/app/layout.tsx:50`), `appleWebApp.statusBarStyle: "default"` (`src/app/layout.tsx:44`); manifest `theme_color: "#0f172a"`, `background_color: "#ffffff"` (`public/manifest.json:10-11`). The two theme colours disagree (Q3).

### 2.4 Scope of hardcoded light colours (307 `.tsx` files outside `src/app/desktop/`)

| Class | Files | Uses |
|---|---|---|
| `bg-white` | 174 | 529 |
| `bg-slate-50` | 97 | 180 |
| `bg-slate-*` (all) | 172 | 685 |
| `text-slate-*` | 205 | 2,966 |
| `border-slate-*` | 157 | 683 |
| `bg-gray-*` | 41 | 191 |
| `text-gray-*` | 49 | 745 |
| `bg-blue-50` | 83 | 154 |
| `text-white` | 154 | 514 |

Roughly **200 of 307 files and ~5,000+ class uses** are written for a light background. A real dark theme means touching all of them (or mapping them through tokens). This is why Q1 matters.

Shared pieces with the widest effect (each has `bg-white` and slate colours): `src/components/ui/card.tsx`, `input.tsx`, `button.tsx`, `table.tsx`, `searchable-select.tsx`, `action-confirmation.tsx`, `error-banner.tsx`, `pagination.tsx`, `badge.tsx`, `skeleton.tsx`; the shells `src/app/(dashboard)/layout.tsx:61`, `src/components/header.tsx`, `header-menu.tsx` (34 slate uses), `app-sidebar.tsx` (23), `bottom-nav.tsx`.

`src/app/desktop/` (16 `.tsx` files) is out of scope by the owner's instruction.

### 2.5 Next.js support checked

`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md:157-177` documents `viewport.colorScheme`, rendered as `<meta name="color-scheme">`. The allowed values include `'only light'` (`node_modules/next/dist/lib/metadata/types/metadata-types.d.ts:36`). `themeColor` accepts a list with `media` queries (same doc, `:71` onward), which a dark theme would use for Q3.

---

## 3. Implementation plan

### Phase 1 — Lock the app to light (stops the problem immediately). Depends on Q0, Q3.

Needed whatever Q1 is. Three edits, CSS and metadata only.

1. **`src/app/layout.tsx:49-54`** — add `colorScheme: "only light"` to the `viewport` export. Next renders `<meta name="color-scheme" content="only light">`. `only light` is the documented opt-out from browser auto-dark (Chrome Android and WebViews honour it). Set `themeColor` to the Q3 answer.
2. **`src/app/globals.css`** — add `color-scheme: only light;` on `:root` (a CSS fallback for browsers that read the property, not the meta; also keeps native controls — date pickers, `<select>` popups, scrollbars — light).
3. **`src/app/globals.css`**, after `@import "tailwindcss";` — add
   `@custom-variant dark (&:where(.dark, .dark *));`
   This makes `dark:` respond to a `.dark` class instead of the OS setting. No element has that class, so the 193 `dark:` lines (§2.2) go inert and the four mixed screens render fully light. It is also exactly the switch a later dark theme would use (Q2).
4. **`public/manifest.json:11`** — align `theme_color` with Q3 (navy `#0f172a`). **If plan
   `2309-app-name-per-environment-plan.md` has shipped first, the manifest is
   `src/app/manifest.ts` instead. Edit `theme_color` there.**

Result: in OS dark mode the app looks the same as in light mode, everywhere, including `/login`, `/fill/*`, `/review/*`. Printing is unaffected.

Known limit: Samsung Internet's own dark mode may still recolour pages regardless (Q7). If staff use it, the fix is its setting "Dark mode → apply to websites: off", or using Chrome.

### Phase 2 — Real dark theme (only if Q1 = (b) or (c)). Depends on Q1, Q2, Q3, Q4, Q5.

A separate plan when chosen; outline only:

- **2a Tokens.** In `globals.css`, define semantic colours (`--surface`, `--surface-muted`, `--text`, `--text-muted`, `--border`, `--primary` …) on `:root`, with dark values under `.dark`. Map them in `@theme inline`. Replace `color-scheme: only light` with `light` / `dark` per class.
- **2b Primitives and shells first** (§2.4 list): switch them to tokens. This alone makes cards, inputs, tables, dialogs, header, drawer, sidebar and bottom bar correct.
- **2c Screens**, module by module (~200 files): replace `bg-white` / `text-slate-*` / `border-slate-*` / `bg-gray-*` / `text-gray-*` with tokens or add `dark:` pairs. Status colours (green/amber/red/blue chips) each need a dark pair.
- **2d Switch.** Per Q2: a small client component that sets `.dark` on `<html>` and reads/writes `localStorage` in `try/catch`, plus an inline script in `src/app/layout.tsx` `<head>` that applies it before paint (no white flash), and `suppressHydrationWarning` on `<html>`. A toggle in `src/components/header-menu.tsx`.
- **2e Excluded:** print CSS (`src/components/label-print.tsx:86`, `src/app/(dashboard)/more/label-designer/page.tsx:109`, `src/app/(dashboard)/stock/[id]/barcode/page.tsx:95`, `unit-label-sheet.tsx:135`) and PDF export stay light (Q4).
- **2f `themeColor`** becomes two entries with `media: "(prefers-color-scheme: dark)"` or is set by the toggle.

### Out of scope for every phase

`src/app/desktop/` — not touched (owner's instruction).

### Logging

Phase 1 is CSS and metadata only; there is no code path to log. Any client code in Phase 2 (the theme switch) uses `createLogger("ui:theme")` from `src/lib/logger.ts` — `log.debug` on theme applied, `log.warn` when `localStorage` throws — never `console.log`. Every `catch` logs.

### Board of agents — checked

- **Frontend engineer** (`docs/agents/frontend-engineer.md`): the app is "mobile-first PWA (employees use phones)" — Phase 1 targets exactly the phone case. Colour convention "Slate for neutral, Blue for primary…" is preserved unchanged by Phase 1; Phase 2 must keep the same meaning for each colour in dark. No loading/error-state or touch-target change. No red flag raised.
- No schema, API, RBAC or integration change in any phase — the other agents do not apply.

---

## 4. Verification

After Phase 1:

1. `npm run build` passes (Postgres must be running — see CLAUDE.md).
2. View source of any page: `<meta name="color-scheme" content="only light">` is present.
3. **Phone, OS dark mode on:**
   - Android Chrome (in the browser), with Chrome's "Darken websites" setting ON if the version offers it, and with `chrome://flags/#enable-force-dark` Enabled.
   - The installed PWA on Android.
   - iPhone Safari, and the Add-to-Home-Screen app.
   - Samsung Internet, if staff use it (Q7).
4. **Laptop, OS dark mode on:** Chrome, Edge, Safari (macOS). Also Windows dark mode with Edge.
5. On each, the screens look the same as in light mode, with readable text and visible borders:
   `/login`, dashboard home, `/stock`, a stock detail, a form with inputs and a `<select>` and a date field, a dialog / bottom sheet (e.g. filter sheet), `ActionConfirmation`, the bottom bar, the header drawer (`header-menu`), the sidebar on desktop, `/notifications`, an error toast, `/bins` and `/stores` → Bins tab, `/transfers/new`, `/units/labels`, a public `/fill/[token]` page.
6. The status bar / title bar colour matches the Q3 answer, installed and in the browser.
7. Print preview of a barcode / unit label sheet is still black on white.
8. Switch the OS back to light: nothing changes.

---

## 5. Out of scope, deliberately

- `src/app/desktop/` — owner's instruction.
- Removing the existing 193 `dark:` classes (Q6 default keeps them, inert).
- A real dark theme, unless Q1 chooses it — it gets its own plan.
- Samsung Internet's forced dark mode, beyond telling staff which setting to change.
- The shared-token refactor for light mode (e.g. moving `bg-white` to `bg-background`) — only worth doing as part of Phase 2.
