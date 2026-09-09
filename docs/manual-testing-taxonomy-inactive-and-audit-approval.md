# Manual testing — brands/categories go inactive, and the stock audit's bulk zero + approval choice

What to test by hand for commit `ddf0092` on `feat/taxonomy-inactive-and-audit-approval`.
Written 8 Sep 2026. The plan it verifies is
`docs/implementation/pending/0809-brand-category-inactive-and-audit-approval-plan.md`;
this file is the browser half of that plan's §4, expanded per module.

`tsc --noEmit` and `eslint` are clean. **Neither proves any of the below** — every case here
is behaviour a type-checker cannot see.

---

## 0. Before you start

| # | Step | Why |
|---|---|---|
| 0.1 | Point `.env` at the database you intend to test (lines 13–14 are localhost `bch`). Print the host before you trust it. | Two Supabase projects are commented out in the same file. |
| 0.2 | `npx prisma migrate status` → must say up to date. If it names `20260908161249_brand_category_is_active` as pending, run `npx prisma migrate deploy`. | The screens read `isActive`; without the column every list 500s. |
| 0.3 | `npm run db:seed:rbac` | Removes `brands.delete` / `categories.delete`. **Only ADMIN held them.** Until this runs, `/team/permissions` still shows a Delete checkbox that grants nothing. |
| 0.4 | Sign in as an ADMIN, and have one non-admin user with `stock_audit` grants ready. | Several cases below are about who may do what. |
| 0.5 | Note a brand with products (not a placeholder) and a category with sub-categories. | Cases 1.x and 2.x need both. |

**Placeholders — never deactivate these, they are the import fall-backs:** `Unbranded`,
`Imported`, `General`, `Uncategorized`. Case 1.5 tests that the app refuses.

---

## 1. Brands — `/more/brands`

| # | Case | Steps | Expected |
|---|---|---|---|
| 1.1 | No delete anywhere | Open the screen, look at every row | **No trash icon.** Actions are Edit, Merge, and a Power toggle. |
| 1.2 | Deactivate cascades | Power on a brand holding products → read the confirm | The confirm names the product count. After OK: the row dims, shows an `Inactive` badge, and the receipt reads "N products set inactive · M units stay on the books". |
| 1.3 | The products really went | `/stock`, default filter | Those products are gone from the list. Switch the status filter to Inactive → they are there, stock unchanged. |
| 1.4 | It left the pickers | Open any product's edit form, and `/stock` bulk re-file | The deactivated brand is **not** in the dropdown. |
| 1.5 | Placeholder refused | Try to deactivate `Unbranded` | Refused with a sentence. Nothing changes. **`Unbranded` holds nearly the whole catalog — this refusal is the guard rail.** |
| 1.6 | Activate, products left alone | Power the brand back on → answer **Cancel** to the "also restore its products?" question | Brand is active. Its products stay INACTIVE. |
| 1.7 | Activate, products restored | Deactivate and activate again → answer **OK** this time | Products are ACTIVE again and back on `/stock`. |
| 1.8 | A discontinued product survives | Set one product to DISCONTINUED first, then deactivate and reactivate-with-restore its brand | That product is **still DISCONTINUED**, never flipped to INACTIVE or ACTIVE. |
| 1.9 | Status filter | The three pills | Default is **Active**. Inactive shows only retired rows. All shows both. |
| 1.10 | Merge target list | Press Merge on any brand | Only **active** brands are offered as the target. If nothing else is active, the Merge button is not there. |
| 1.11 | Merge moves everything | Merge a brand that has products **and** history (inbound shipments, ledger entries, a SKU mapping) into another | Merge succeeds, the source row is gone, and nothing lost its brand. Check the target's product count and the ledger screens. |
| 1.12 | Merge name clash | Merge two brands that hold a SKU mapping with the same `brandName` | Refused with a sentence naming the clash. **Nothing partially moved** — the source is still there with everything. |
| 1.13 | Permission | As a user with `brands.view` only | No Power toggle, no create form, no merge. |

## 2. Categories — `/categories`

Same shape as brands, plus the tree.

| # | Case | Steps | Expected |
|---|---|---|---|
| 2.1 | No delete | Look at the rows | No trash icon. |
| 2.2 | Subtree cascade | Deactivate a parent that has sub-categories and products | Receipt names products **and** sub-categories. Parent and every child show `Inactive`; products of parent and children are INACTIVE. |
| 2.3 | Child first | Try to activate a child while its parent is inactive | Refused: "Activate &lt;parent&gt; first". |
| 2.4 | Parent then child | Activate the parent, then the child | Both work. Activating the parent does **not** silently re-activate children — each is its own decision. |
| 2.5 | Placeholder refused | Try to deactivate `Uncategorized` | Refused with a sentence. |
| 2.6 | Left the pickers | Product edit form, `/stock` bulk re-file, and the **inbound receiving** category picker | The inactive category is absent from all three. |
| 2.7 | Merge with children | Merge a category that still has sub-categories | Refused, and the sentence now says "Move them to another parent before merging" — it must **not** mention deleting. |
| 2.8 | Merge target | The target list | Active categories only. |

## 3. Products — `/stock`, `/stock/[id]`

| # | Case | Steps | Expected |
|---|---|---|---|
| 3.1 | Existing inactive value still visible | Open a product whose brand you deactivated | The brand select shows "&lt;name&gt; (inactive)" and is pre-selected. **It must not render blank** — a blank select saved by accident would silently re-brand the product. |
| 3.2 | Cannot re-file onto an inactive row | Select products on `/stock` → bulk assign brand | The inactive brand is not offered. If you force it (stale tab, second window), the API refuses with a sentence. |
| 3.3 | Reclassify refuses | The brand/category chips in the brand-count wizard | An inactive row is refused with a sentence naming it. |
| 3.4 | New product refuses | Create a product, then in a second tab deactivate its brand, then submit | Refused with "&lt;name&gt; is inactive. Activate it on /more/brands first." |
| 3.5 | Vendor ↔ brand link | `/vendors/[id]` → add a brand link | An inactive brand is refused. |

## 4. Stock audit, counting — `/stock-audit/[id]`

The audit must be **assigned to you** and **IN PROGRESS** for most of these.

| # | Case | Steps | Expected |
|---|---|---|---|
| 4.1 | The button appears | Open an in-progress audit assigned to you, Uncounted tab, with lines uncounted | A full-width **"Record 0 for all N uncounted"** button under the tabs. |
| 4.2 | It hides when it should | (a) switch to the Counted tab (b) type in the search box (c) open an audit assigned to someone else | The button is not shown in any of the three. Search replaces the tab filter, so a whole-audit action over a filtered list would be a lie. |
| 4.3 | Typed counts survive | Type `5` on one row, then **immediately** press the button (before the two-second auto-save) | The typed row keeps **5**. Every other uncounted line becomes 0. This is the case the flush exists for. |
| 4.4 | First press works | Same as 4.3, watching the sheet | The confirm sheet shows the right number and the press succeeds. **A 409 "the list changed" on the first press is a bug** — report it. |
| 4.5 | Idempotent | Press it again after it has run | Nothing to do, no error. |
| 4.6 | Stale screen | Open the audit in two tabs, zero from one, then press in the other | 409 with both numbers, the screen reloads. No double write. |
| 4.7 | Complete is unblocked | After zeroing, press Complete | Accepted. Before the button existed this needed a tap per line. |
| 4.8 | No brand creation | Open the per-line brand dropdown | The list ends with the last real brand. **No "+ Add new brand…"**, no typing prompt. |
| 4.9 | Suggestion still works | Pick an existing brand on a line whose product is `Unbranded`, save, then approve with "set system stock" | The product's brand becomes the picked one. Picking on a product that already has a real brand changes nothing. |
| 4.10 | Locked after completion | Complete the audit, then try to change a count | Refused: counts are saved only while in progress. |
| 4.11 | Approve buttons moved | Look at a COMPLETED audit as an approver | The count screen has **Reject** and a link **"Review differences & approve →"**. No approve buttons here any more. |

## 5. Stock audit, approval — `/stock-audit/[id]/review`

Needs `stock_audit.approve`, and **you must not be the assignee**.

| # | Case | Steps | Expected |
|---|---|---|---|
| 5.1 | The differences are shown | Open a completed audit | A strip above the table: lines that differ, net units, and how many lines were counted 0 with the units that writes off. |
| 5.2 | Two clear choices | Read the options | "Record the differences only" and "Set system stock to the counts". Neither fires without the confirm sheet. |
| 5.3 | Verify only | Choose the first, approve | Status APPROVED. **Stock is unchanged** — check a product's quantity before and after. |
| 5.4 | Apply | On another audit, choose the second, approve | Stock at that warehouse equals the counted numbers. |
| 5.5 | **A counted zero really zeroes** | Count a shelf as 0 for a product that has stock, approve with "set system stock" | Stock becomes **0** and a stock movement records the drop. **This is the bug this release fixes** — previously the zero was skipped silently and the phantom stock stayed. Test it first. |
| 5.6 | Stock that moved since | Raise an audit, sell/dispatch one unit of a counted product, then open the review | A **Now** column appears for that line. After applying, the movement record shows the live figure, not the older snapshot. |
| 5.7 | Whole-store audit | Approve a whole-store audit with "set system stock" | A warehouse picker appears and **Approve stays disabled until you choose one**. A surplus lands in the chosen warehouse; a shortage is taken across the store's warehouses. |
| 5.8 | No warehouse to correct into | A store with no active warehouse | The apply option is not offered, and the sentence explains that, rather than claiming the audit has no location. |
| 5.9 | Separation of duties | Open your own completed audit as its assignee, holding approve | No approve card. You cannot sign off your own count. |
| 5.10 | Reject still works | Reject with a reason chip | Status REJECTED, reason recorded, and the audit can be restarted. |
| 5.11 | Reversal still works | Delete an approved, applied audit | Its stock movements are reversed as before. |

## 6. Zoho imports

| # | Case | Steps | Expected |
|---|---|---|---|
| 6.1 | Bill import, inactive brand | Deactivate a brand that a Zoho bill's vendor maps to, then approve that bill | The product is still filed under it and the result carries a **notice** saying the brand is inactive. It is a notice, **not** an error, and the import does not fail. |
| 6.2 | Brand fetch | `/more/brands` → Fetch from Zoho, where a matching local brand is inactive | It still links by Zoho id, and the result lists a notice. |
| 6.3 | Category fetch | Same on `/categories` | Same. |
| 6.4 | Nothing new is invented | Approve any bill | No new Brand row appears that you did not create. |

## 7. Activity log — `/activity`

| # | Case | Expected |
|---|---|---|
| 7.1 | After a deactivate/activate | A row under **Master data**, labelled Brand or Category, reading "deactivated"/"activated" with the name and the counts. |
| 7.2 | After a bulk zero | A row under **Audit** reading "zeroed uncounted" with the audit number and how many lines. |
| 7.3 | After an approval | The existing approve row, whose detail says either "verify only" or "stock corrected at &lt;warehouse&gt;". |

## 8. Permissions — `/team/permissions`

| # | Case | Expected |
|---|---|---|
| 8.1 | After `db:seed:rbac` | Brands and Categories show **View, Create, Edit, Fetch**. No Delete. |
| 8.2 | A role with edit only | Can toggle active/inactive; cannot create or merge. |
| 8.3 | Nothing else lost | Every other module's grants are as they were. Only the two delete permissions were removed. |

## 9. Regression — things that must still work

These were not the target of the change but sit in the files it touched.

- `/more/brands` and `/categories`: create, rename, the Zoho fetch sheet, lead time on brands, the category parent/tree.
- `/stock`: filters, search, the "needs details" view, bulk re-file to an **active** brand.
- `/stock-audit`: creating an audit, the assignee dropdown, per-line counting, the `0 ✓` pill, Refresh for stale quantities, the Excel export from the review table.
- Inbound receiving: the category picker and receiving a shipment.
- Vendor screens: the vendor↔brand link list.

---

## Sign-off

| Section | Tester | Date | Result | Notes |
|---|---|---|---|---|
| 0 setup | | | | |
| 1 brands | | | | |
| 2 categories | | | | |
| 3 products | | | | |
| 4 audit counting | | | | |
| 5 audit approval | | | | |
| 6 Zoho imports | | | | |
| 7 activity log | | | | |
| 8 permissions | | | | |
| 9 regression | | | | |

**If a case fails**, note the exact screen, what you did, what you expected and what happened,
and check the browser console — the error boundary's "This page couldn't load" is never the
real message. The plan's §6 records what each part changed and why, which is where to start
reading.
