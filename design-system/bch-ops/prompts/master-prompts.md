# BCH OPS — Master UI/UX Prompts

One prompt per **archetype**. ~100 routes collapse into these 6 shapes; each page = its archetype prompt + a few page-specific deltas (see `pages/`). Read `../MASTER.md` for tokens before applying any prompt.

## Shared foundation (applies to EVERY prompt below)

- **Who/where:** Indian bike-shop warehouse & store staff, on phones, one-handed, often poor light, using the app 100–200×/day. Speed and clarity beat decoration.
- **Goal:** *Elevate* the existing clean look — sharpen hierarchy, signals, spacing, touch. Do **not** change the mental model or reinvent flows.
- **Stack:** Next.js 16, React 19, Tailwind 4, shadcn-style components in `src/components/ui/*`. PWA with safe-area classes (`pb-nav`, `safe-top`).
- **Tokens (`../MASTER.md`):** slate neutrals, `#059669` green = confirm/positive, status = green/amber/red, bg `#F8FAFC`. **Numbers (qty, ₹, bill#, SKU) render `tabular-nums`** so columns align.
- **Non-negotiables:** 44×44px min touch targets, 8px+ gaps; body text ≥ 12px (kill the 9–10px labels); skeleton loading (never a bare spinner); light-mode contrast ≥ 4.5:1; visible focus rings; `prefers-reduced-motion` respected; motion ≤ 200ms; no horizontal page scroll; SVG icons only (Lucide), never emoji.
- **Reuse, don't rebuild:** never touch data fetching, routing, API calls, or business logic — restyle presentation only. One shared component per repeated element (card, pill, chip) configured per page.
- **Build with:** `shadcn` MCP (primitives: card, badge, skeleton, sheet), `21st` MCP (richer components e.g. filter bars, only when a primitive isn't enough), `ui-styling` skill (Tailwind token application), `ui-ux-pro-max` skill (per-page color/UX lookups).

---

## 1. LIST archetype
**Governs:** /inbound, /vendor-issues, /deliveries, /bills, /expenses, /purchase-orders, /vendors, /transfers, /stock, /stock-audit, /second-hand, /prebookings.

**Structure (top→bottom):** (1) sticky header — title + primary action (e.g. "Fetch Inbound"), search icon; (2) horizontally-scrollable **summary chips** = counts by status, tappable to filter, the **overdue/red chip is the loudest element** and never buried; (3) search + filter row (44px tall); (4) list as tap-through **cards** (not dense table rows): bold primary id (brand / bill#), muted secondary meta, right-aligned **status pill + age** where red = act today; (5) bottom nav.

**Interactions:** whole card = one ≥44px tap target → detail route. Loading = `SkeletonList` cards (reserve height, CLS<0.1). Empty = one line + the primary action. Consider pull-to-refresh.

**Audit fixes:** promote the overdue signal from a tiny pill to a **left border-accent + colored age text**. Remove controls flagged unsafe in the logic audit (e.g. count "refresh system qty").

**Done when:** all listed pages share one card component; overdue items unmissable at arm's length; 44px targets; skeleton load; numbers tabular; contrast ≥4.5:1; 390px screenshot matches.

---

## 2. DETAIL archetype
**Governs:** /inbound/[id], /vendor-issues/[id], /deliveries/[id], /bills/[id], /purchase-orders/[id], /vendors/[id], /stock/[id], /receivables/[id], /second-hand/[id], /team/[id], /stock-audit/[id].

**Structure:** (1) back-arrow header (one step back, preserves list state) + record title + status pill; (2) **primary-action bar** — the 1–2 actions this record exists for (Mark Delivered, Record Payment, Resolve), thumb-reachable near the bottom, ≥48px, green for confirm / red for destructive with confirm; (3) key facts as a scannable label→value grid (values tabular); (4) line-items / sub-records; (5) **activity/timeline** (who did what, when) at the bottom.

**Interactions:** destructive actions require a confirm sheet. Optimistic state + toast on success. Sticky action bar clears safe-area (`pb-safe`).

**Audit fixes:** never expose a mutating action the role can't perform (hide, don't just disable-on-fail); make status transitions follow the real state machine (no skip). Surface the "who did this" from the activity log.

**Done when:** the record's core action is reachable one-handed without scrolling hunt; timeline present; role-gated actions hidden for non-owners; confirm on destructive; screenshot at 390px.

---

## 3. FORM archetype
**Governs:** /vendor-issues/new, /purchase-orders/new, /vendors/new, /expenses/new, /payments/new, /receivables/new, /second-hand/new, /transfers/new, /stock-audit/new, /brand-stock/upload.

**Structure:** single column, one logical group per section; **visible labels above every field** (never placeholder-only); helper text under the field; primary submit as a sticky bottom bar (≥48px), secondary/cancel ghost.

**Interactions:** validate **on blur**, error message inline **next to the field** (not only a top summary), announced to screen readers; disable submit only with a reason shown; progressive disclosure (hide advanced fields until needed); numeric keypads for number fields (`inputMode`), camera capture for photo fields; compress media client-side before upload.

**Audit fixes:** enforce the same rules the server enforces (e.g. required resolution before close, allocation total = amount) at the field level so the user isn't surprised by a 400; cap quantities to sane ranges.

**Done when:** every field labeled; blur validation; inline errors; sticky submit; correct mobile keyboards; no data loss on rotation; screenshot at 390px.

---

## 4. DASHBOARD archetype
**Governs:** / (role home), /accounts, /reports + /reports/*, /reorder, /ai.

**Structure:** (1) greeting + date + role; (2) **"what needs me now"** block first — the red/overdue counts for THIS role, each a tap into the filtered list; (3) KPI row as **bullet/progress bars with the number always shown as text** (never color-only, never hover-only); (4) quick-action buttons for the role's top 2–3 tasks; (5) recent activity.

**Interactions:** every KPI/alert is a link into its list, pre-filtered. Skeleton dashboard while loading. Role determines which blocks render (a receiver's home ≠ an accountant's home).

**Audit fixes:** dashboard aggregates must match the source lists (the audit found three different vendor-balance formulas — pick one); don't show a metric a role can't act on.

**Done when:** the role sees their top job within the first screen; KPIs have text values + a11y fallback; each metric links to its filtered list; skeleton load; screenshot per role at 390px.

---

## 5. SCANNER / ACTION archetype
**Governs:** /scanner, /stock/[id]/barcode, stock-count execution, receiving flow.

**Structure:** full-bleed focused task; large live camera/scan target; one giant primary result/confirm zone; minimal chrome. Big numeric readout in tabular mono. Success = large green check + haptic; error = large red + retry.

**Interactions:** designed for gloves/one hand — targets ≥56px; immediate visual + haptic feedback on scan; keep a running count visible; never require precise small taps mid-flow.

**Audit fixes:** make double-scan / double-submit impossible from the UI (debounce + disable while pending) to complement the server guards; confirm location before committing stock.

**Done when:** usable one-handed at arm's length; unmistakable success/fail; no accidental double-commit; screenshot at 390px.

---

## 6. SETTINGS / ADMIN archetype
**Governs:** /more + /more/* (zoho, brands, brand-lead-times, alerts, whatsapp-templates, bins, label-designer, app-logic, problems), /team, /team/permissions.

**Structure:** grouped list of rows (icon + label + current value + chevron), section headers; toggles inline; destructive/admin-only items visually set apart and gated.

**Interactions:** dangerous actions (delete, reset, apply-correction) require typed/explicit confirm and are hidden for non-admins; show the current value inline so the user doesn't open a row to read state.

**Audit fixes:** hide admin-only rows for non-admins (don't rely on the API 403); reflect the delegation ownership — each role sees the settings they own.

**Done when:** admin-only actions hidden for non-admins; current values visible inline; destructive actions confirmed; screenshot at 390px.

---

### Propagation note
Per page, write a 3–5 line delta file in `pages/<route>.md` capturing only what differs from its archetype (specific fields, specific status set, specific primary action). Everything else inherits the archetype + MASTER.md.
