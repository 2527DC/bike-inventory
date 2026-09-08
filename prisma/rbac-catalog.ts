// ─── RBAC seed catalog ───────────────────────────────────────────────────────
// This file is SEED INPUT ONLY. It is imported by prisma/seed-rbac.ts to populate the
// `modules` and `permissions` tables, and by nothing else.
//
// The running application MUST NOT import this file. At runtime, modules and permissions
// are read from the database (see src/lib/rbac.ts), which is what makes access changeable
// without a redeploy. Keeping the catalog under prisma/ rather than src/ is deliberate —
// it makes an accidental runtime import obvious in review.

export type ActionKey = "view" | "create" | "edit" | "delete" | "approve" | "fetch";

/** Every action the system understands, with the label shown in the admin editor. */
export const ACTION_LABELS: Record<ActionKey, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  fetch: "Fetch / Sync",
};

/** `view` is special: it is what the sidebar tests to decide whether to show a module. */
export const READ_ACTION: ActionKey = "view";

export interface ModuleSeed {
  key: string;
  label: string;
  description: string;
  icon: string; // lucide-react icon name, resolved client-side
  route: string | null; // primary route; null = no direct page (permission-only module)
  group: string; // sidebar section
  sortOrder: number;
  actions: ActionKey[];
  /**
   * Key of the parent module, for sub-modules rendered inside a collapsible sidebar
   * parent. Omit for a root module — which is every module except the Staff LMS children.
   *
   * The seeder resolves this to `Module.parentId` in a second pass, after every root
   * exists, and asserts four things the foreign key cannot express:
   *   1. the named parent exists and is itself a root (depth is exactly two)
   *   2. no cycles
   *   3. a child does not declare its own `group` different from its parent's
   *   4. children sort within their parent
   * See prisma/schema.prisma -> model Module for why each one fails silently.
   */
  parentKey?: string;
}

// Sidebar group order is NOT declared anywhere — it falls out of `sortOrder` below.
// The sidebar walks modules in sortOrder and opens each new `group` as it first appears, so
// the bands assigned here (Overview 0-99, Operations 100s, Purchase 200s, Accounts 300s,
// Insights 400s, Admin 500s, Service 600s) ARE the group order. Keep a group's modules
// inside one band or that group will render split in two.
//
// A `MODULE_GROUPS` array used to sit here claiming to control this. Nothing imported it,
// and it disagreed with reality (it listed Service before Admin; sortOrder renders Admin
// first). Removed rather than wired, so there is one source of truth instead of two.

const CRUD: ActionKey[] = ["view", "create", "edit", "delete"];

export const MODULE_CATALOG: ModuleSeed[] = [
  // ── Overview ──────────────────────────────────────────────────────────────
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Home screen, KPIs and operational summary",
    icon: "LayoutDashboard",
    route: "/",
    group: "Overview",
    sortOrder: 10,
    actions: ["view"],
  },
  {
    key: "activity",
    label: "Activity Log",
    description: "Audit trail of user actions across the app",
    icon: "ClipboardList",
    route: "/activity",
    group: "Overview",
    sortOrder: 20,
    // `approve` gates "see the whole team’s activity" versus "see only your own". It is not
    // an approval step — CLAUDE.md says a rule of the shape "supervisors see all records,
    // juniors see only their own" IS the module’s approve grant, rather than a role name.
    // Added 30 Aug 2026 for frontend-role-check-removal-plan.md; /activity and
    // /desktop/activity read it.
    actions: ["view", "create", "approve"],
  },

  // ── Operations ────────────────────────────────────────────────────────────
  //
  // Stock Management is a PARENT with six children — the third module tree in this catalog,
  // after Staff LMS and Store Management.
  //
  // Unlike `store_management`, this parent HAS a route, and that is about the phone:
  // bottom-nav.tsx filters to `!m.parent`, so a routeless parent would drop Stock, Inbound
  // and Deliveries off the mobile bottom bar entirely and leave a stock user with
  // Second-Hand / Scanner / POS. The hub page keeps the tab.
  //
  // Every child KEEPS ITS KEY. Permissions are keyed on the module key, not on position in
  // the tree, so every existing stock.view / inbound.create / deliveries.approve /
  // transfers.edit / stock_audit.approve grant survives this move untouched. The seeder
  // upserts route, group, sortOrder and parentId in both create and update, so a re-seed
  // performs the re-parenting on rows that already exist — exactly how `zoho` was moved
  // under `settings`.
  {
    key: "stock_management",
    label: "Stock Management",
    description: "Stock, brand sheets, categories, audits, inbound, dispatch and transfers",
    icon: "Boxes",
    route: "/stock-management",
    group: "Operations",
    sortOrder: 100,
    // A grouping construct. Its own view grant gates the hub page and nothing else — the real
    // gates are stock.*, inbound.* and the rest. Do not give it CRUD expecting it to gate them.
    actions: ["view"],
  },
  {
    key: "stock",
    label: "Stock & Inventory",
    description: "Products, serials, stock levels and locations",
    icon: "Package",
    route: "/stock",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 101,
    // `fetch` is GONE. It gated the "Fetch Stock" button on /stock, which pulled the catalog
    // from Zoho; that import was deleted and products now arrive from
    // scripts/import-products.ts. Verified before removing: no `requireFeature("stock",
    // "fetch")` and no `canFetch("stock")` existed anywhere — the wizard's API calls were
    // gated by `zoho.fetch`, so nothing loses access. The seeder's stale-permission sweep
    // (seed-rbac.ts) deletes the row and its grants on the next `npm run db:seed:rbac`.
    //
    // P4 (R1) finished the job this started. FIVE more `fetch` actions were orphaned the same
    // way — inbound, deliveries, vendors, bills, customers and brand_ledger — because every
    // screen that used them called a route guarded by `zoho.fetch`. A role could therefore
    // hold the button and not the route, or the route and not the button, which is exactly
    // how "the Fetch button does nothing" started. `zoho.fetch` / `zoho.approve` is the one
    // truth now, and it is the ONLY surviving `fetch` action in this catalog.
    //
    // ⚠ RUN `npm run db:seed:rbac` AFTER DEPLOY, or the six dead permissions stay grantable
    //   on /team/permissions and keep implying an access they no longer control.
    actions: ["view", "create", "edit", "delete"],
  },
  {
    // Brand stock sheets: upload a brand's availability file (Excel/CSV/PDF/image), review
    // what it matched against our catalogue, then raise a PO for the rows worth ordering.
    //
    // The screens (`/brand-stock`, `/brand-stock/upload`, `/brand-stock/[id]`) already
    // existed and worked, but had NO module of their own, so nothing rendered a link to
    // them — the sidebar, the phone tab bar and the Stock Management hub are all derived
    // from this catalog (see src/lib/nav-config.ts for why the hardcoded lists were
    // deleted). The feature was reachable only by typing the URL.
    //
    // Guarded on `purchase_orders` until now, which is why it could be left out of the
    // catalog and still work. That split is the failure P4 documents at length — a module's
    // `view` decides what the menu shows while the route checks something else, so a role
    // can hold the entry and not the route, or the route and not the entry. The four
    // read/write routes move onto `brand_stock`; `generate-po` keeps `purchase_orders.create`
    // ON TOP of `brand_stock.view`, because the row it writes is a PurchaseOrder and this
    // must not become a second, weaker way to mint one.
    //
    // No `delete` action: nothing deletes a BrandStockUpload — there is no route for it.
    // Declaring one would put a grant on /team/permissions that controls nothing.
    //
    // sortOrder 102 is the slot product_types vacated in P3 of the 0409 plan, so this fills
    // the gap rather than renumbering rows that already exist.
    //
    // ⚠ RUN `npm run db:seed:rbac` AFTER DEPLOY, then grant Brand Stock on
    //   /team/permissions — a new module is granted to nobody, and ADMIN holds every
    //   permission only because it is re-seeded with them. Anyone using the URL today has
    //   `purchase_orders` and will lose the screen until they are granted this.
    key: "brand_stock",
    label: "Brand Stock",
    description: "Brand availability sheets, matching and PO generation",
    icon: "FileSpreadsheet",
    route: "/brand-stock",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 102,
    actions: ["view", "create", "edit"],
  },
  {
    key: "inbound",
    label: "Inbound Tracking",
    description: "Incoming shipments, receiving, putaway",
    icon: "ArrowDownCircle",
    route: "/inbound",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 105,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "deliveries",
    label: "Deliveries & Dispatch",
    description: "Outward dispatch, delivery runs, pre-bookings",
    icon: "Truck",
    route: "/deliveries",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 106,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "transfers",
    label: "Stock Transfers",
    description: "Inter-location transfer orders",
    icon: "ArrowRightLeft",
    route: "/transfers",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 107,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "stock_audit",
    label: "Stock Audit / Count",
    description: "Physical stock counts, reconciliation and resets",
    icon: "ClipboardCheck",
    route: "/stock-audit",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 104,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "second_hand",
    label: "Second-Hand Cycles",
    description: "Exchange and refurbished cycle inventory",
    icon: "Bike",
    route: "/second-hand",
    group: "Operations",
    sortOrder: 150,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "barcode",
    label: "Barcode & Labels",
    description: "Scanner, label printing and label designer",
    icon: "QrCode",
    route: "/scanner",
    group: "Operations",
    sortOrder: 160,
    actions: ["view", "create"],
  },
  {
    key: "pos",
    label: "POS & Settlement",
    description: "Point-of-sale sessions and daily cash settlement",
    icon: "CreditCard",
    route: "/accounts/settlement",
    group: "Operations",
    sortOrder: 170,
    actions: ["view", "create", "edit", "approve"],
  },

  // ── Purchase ──────────────────────────────────────────────────────────────
  {
    key: "vendors",
    label: "Vendors",
    description: "Vendor master, contacts and ledgers",
    icon: "Building2",
    route: "/vendors",
    group: "Purchase",
    sortOrder: 200,
    actions: ["view", "create", "edit", "delete"],
  },
  {
    key: "purchase_orders",
    label: "Purchase Orders",
    description: "POs and brand stock uploads",
    icon: "ShoppingCart",
    route: "/purchase-orders",
    group: "Purchase",
    sortOrder: 210,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "brands",
    label: "Brands",
    description: "Brand master, lead times and stock files",
    icon: "Tag",
    route: "/more/brands",
    // Moved under Stock Management on 8 Sep 2026 (owner). The brand master is stock master
    // data — it sits beside Categories, which was already a child here — not a purchasing
    // screen. It was in "Purchase" at sortOrder 220, next to purchase orders.
    //
    // `group` MUST equal the parent's ("Operations"); the seeder asserts it. `route` is
    // deliberately UNCHANGED: `User.navTabs` pins a module's route string, so renaming it to
    // /brands would silently drop the tab for anyone who pinned it (use-bottom-nav.ts skips a
    // route matching no granted module). `key` is likewise untouched — every existing grant
    // is keyed on it.
    parentKey: "stock_management",
    group: "Operations",
    sortOrder: 108, // after transfers (107); 100-107 are the existing stock_management children
    // CRUD plus `fetch`, and `fetch` is deliberately NOT `zoho.fetch`.
    //
    // `zoho.fetch` is the grant for pulling BILLS and INVOICES — a routine, high-frequency
    // job an accounts clerk does. Until now that same import was also the thing that MINTED
    // brands, one per bill vendor name, which is the defect the 0809 plan closes. If the
    // "Fetch from Zoho" button on /more/brands were guarded by `zoho.fetch`, everyone who
    // pulls bills would silently regain the power to rewrite the brand master — the same
    // hole, moved from an import side effect to a button.
    //
    // So the brand master is owned by its own screen: `brands.fetch` opens the preview
    // (which writes nothing), and `brands.create` is what actually inserts rows. Two grants,
    // because "may look at what Zoho has" and "may add 36 brands to the master" are
    // genuinely different decisions, and the person trusted with one need not hold the other.
    //
    // No `delete` (plan 0809-brand-category-inactive): a brand is retired with the
    // Active/Inactive toggle on `edit`, and nothing under it is ever destroyed.
    // ⚠ RUN `npm run db:seed:rbac` AFTER DEPLOY — the seeder removes the stale
    //   `brands.delete` permission and every grant of it, silently.
    actions: ["view", "create", "edit", "fetch"],
  },
  {
    // The product taxonomy, which until now had no screen and no module of its own.
    //
    // Five of the seven places that create a Category are Zoho import routes mirroring
    // `category_name` verbatim, and nothing in the UI ever called POST /api/categories — so
    // the taxonomy was entirely Zoho's and could not be corrected from the app. That is why
    // 151 products sit in "Uncategorized" and several categories are wheel sizes.
    //
    // GET /api/categories deliberately stays on `stock.view`: every product form reads it
    // for a dropdown, and re-guarding it here would empty those dropdowns for anyone who is
    // not a taxonomy admin — a silent empty list rather than an honest 403.
    //
    // A CHILD of `stock_management`. `group` moves Purchase -> Operations: seed-rbac.ts
    // throws if a child's group differs from its parent's, and the sidebar groups by the
    // PARENT's group anyway, so a mismatch would only have been a lie in the data.
    //
    // The route moved /more/categories -> /categories to match the rest of the tree.
    // next.config.ts permanently redirects the old path; nothing in src/ linked to it, so
    // bookmarks were the only thing at stake.
    //
    // Categories is now the only taxonomy a product is filed under — `product_types` was
    // removed in P3 of the 0409 plan. sortOrder 103 is left as-is rather than renumbered:
    // the gap at 102 is harmless and renumbering would rewrite rows for nothing.
    key: "categories",
    label: "Categories",
    description: "Product categories — the taxonomy Zoho imports into",
    icon: "Tag",
    route: "/categories",
    parentKey: "stock_management",
    group: "Operations", // MUST equal the parent's — the seeder asserts it
    sortOrder: 103, // 102 is now vacant (product_types removed); nothing renumbered
    // `fetch` here is the same argument as on `brands` above, and it matters more, not less.
    //
    // The Zoho bill import creates a Category from `item.category_name` verbatim and
    // UNBOUNDED — that is how wheel sizes ended up as categories. Guarding the new "Fetch
    // from Zoho" screen with `zoho.fetch` would hand the taxonomy back to whoever imports
    // bills, which is precisely the arrangement that produced the mess documented above.
    //
    // `categories.fetch` opens the preview (writes nothing); `categories.create` inserts.
    // The taxonomy is owned by the person who curates it, not by the person who happens to
    // run a bill pull.
    //
    // No `delete` (plan 0809-brand-category-inactive): a category is retired with the
    // Active/Inactive toggle on `edit`, subtree and all, and nothing is ever destroyed.
    // ⚠ RUN `npm run db:seed:rbac` AFTER DEPLOY — the seeder removes the stale
    //   `categories.delete` permission and every grant of it, silently.
    actions: ["view", "create", "edit", "fetch"],
  },
  {
    key: "vendor_issues",
    label: "Vendor / Ops Issues",
    description: "Issue tracking, notes and daily reports",
    icon: "AlertCircle",
    route: "/vendor-issues",
    group: "Purchase",
    sortOrder: 230,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "reorder",
    label: "Reorder & AI Insights",
    description: "Reorder levels, demand forecast and suggestions",
    icon: "RefreshCw",
    route: "/reorder",
    group: "Purchase",
    sortOrder: 240,
    actions: ["view", "edit"],
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  {
    // The accounts hub at /accounts — six screens and ~2,500 lines that shipped WITHOUT a
    // module row. The sidebar renders getAccess().modules, so a screen with no module can
    // never appear there: /accounts was reachable only through two <Link>s on the home
    // dashboard, and it borrowed `bills.view` for its permission because it had none of
    // its own. This entry is what puts it in the sidebar.
    //
    // `view` only, deliberately. This is a read-only roll-up — every action it links to
    // (record a payment, upload a statement, settle a day) lives on another screen and is
    // gated by that screen's own module. Granting someone the hub should not grant them
    // the writes underneath it.
    key: "accounts",
    label: "Accounts",
    description: "Accounts hub — payables, receivables, settlement and vendor ledger",
    icon: "Calculator",
    route: "/accounts",
    group: "Accounts",
    // Ahead of bills (300) so the hub heads its own section rather than trailing it.
    sortOrder: 290,
    actions: ["view"],
  },
  {
    // ── route: null is DELIBERATE — hidden from the sidebar, NOT removed ──────
    //
    // All three navigation surfaces render getAccess().modules and skip an entry that has
    // no route and no children (app-sidebar.tsx, bottom-nav.tsx, desktop/sidebar.tsx), so
    // nulling the route takes Bills & Payments out of the navigation while leaving every
    // permission it grants intact.
    //
    // Deleting the module instead would delete its permissions, and userCan answers
    // `undefined === true` -> FALSE FOR EVERYONE, ADMIN INCLUDED. `bills` is checked by 20
    // files — the Zoho bill pull, settlement, inbound receiving, the vendor detail screen
    // and the accounts hub, not just /bills — so removing it would 403 the whole accounting
    // import chain.
    //
    // /bills stays reachable by URL and from its card on the home dashboard, and it is
    // still grantable on /team/permissions. Put "/bills" back here to restore the sidebar
    // entry; that is the entire change.
    key: "bills",
    label: "Bills & Payments",
    description: "Vendor bills, payments, credits and bank statements",
    icon: "FileText",
    route: null,
    group: "Accounts",
    sortOrder: 300,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    // route: null — hidden from the sidebar, not removed. See the note on `bills` above;
    // `expenses` is checked by 5 files and /expenses stays reachable by URL and from the
    // dashboard card. Restore by putting "/expenses" back.
    key: "expenses",
    label: "Expenses",
    description: "Expense entry and approval",
    icon: "Receipt",
    route: null,
    group: "Accounts",
    sortOrder: 310,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    // Cost price is purchase-side financial data that used to be gated by a hardcoded
    // `role === "ADMIN"` check scattered across the product and second-hand routes. Modelling
    // it as its own module turns that implicit rule into something an admin can actually grant
    // — e.g. to a purchase manager who needs margins but no other accounts access.
    key: "cost_price",
    label: "Cost Price Visibility",
    description: "See purchase cost and margin on products and second-hand cycles",
    icon: "IndianRupee",
    route: null,
    group: "Accounts",
    sortOrder: 330,
    actions: ["view"],
  },
  {
    // ── THE WAY IN IS THE CUSTOMER LIST, NOT THE INVOICE LIST ────────────────────────────
    //
    // This module pointed at `/receivables` for as long as it existed, and there was a
    // second module `customer_list` -> `/customers` hanging off it as a child. That was
    // backwards twice over:
    //
    //   1. A child is COLLAPSED in the sidebar until you click its parent's chevron, and
    //      `bottom-nav.tsx` filters the phone's tab bar to `!m.parent` — so the one screen
    //      that simply lists customers was the single hardest thing in the app to find.
    //   2. Receivables are a view OF a customer. Landing on a flat list of invoices and
    //      working backwards to who owes them is the wrong way round.
    //
    // So `customer_list` is gone (its route would now duplicate this one) and this module
    // owns `/customers`. Receivables are reached per customer, from the row, at
    // /customers/[id]/receivables.
    //
    // `/receivables` ITSELF IS NOT DELETED and must not be. It still holds the aging
    // buckets and the Zoho invoice import, and four screens link to it — the dashboard
    // (twice), /accounts and the delivery payment warning. It simply has no nav entry now.
    //
    // Still five actions, and `create`/`edit` are the ones the list screen's add/edit sheet
    // checks. There is no separate grant for the list: one question, one answer.
    key: "customers",
    label: "Customers",
    description: "Customer master, invoices and receivables",
    icon: "Users",
    route: "/customers",
    group: "Accounts",
    sortOrder: 320,
    actions: ["view", "create", "edit", "delete"],
  },

  // ── Brand Ledger (supplier reconciliation) ────────────────────────────────
  // Split into two modules on purpose. The ledger is a record; the claim register is a set of
  // live disputes and negotiating positions — "they owe us ₹1.3L and we have no written
  // agreement" is not something everyone who can read a statement should see.
  {
    key: "brand_ledger",
    label: "Brand Ledgers",
    description: "Supplier statements, reconciliation against our books, agreed discount terms",
    icon: "FileText",
    route: "/ledger",
    group: "Accounts",
    sortOrder: 340,
    actions: ["view", "create", "edit", "delete"],
  },
  {
    key: "brand_ledger_gaps",
    label: "Ledger Claims",
    description: "Promised discounts and credits not yet received — the chase register",
    icon: "AlertCircle",
    route: null, // lives inside a vendor's ledger, not as a standalone page
    group: "Accounts",
    sortOrder: 350,
    // `approve` = authority to mark a claim resolved or dropped, which is a financial call.
    actions: ["view", "create", "edit", "delete", "approve"],
  },

  // ── Insights ──────────────────────────────────────────────────────────────
  {
    key: "reports",
    label: "Reports",
    description: "Daily, movement, purchase and expense reports",
    icon: "BarChart3",
    route: "/reports",
    group: "Insights",
    sortOrder: 400,
    actions: ["view"],
  },
  // Store analytics — entrance footfall from the door camera, joined to POS bills.
  // See docs/analytics-merge-plan.md.
  //
  // `route` is the footfall dashboard. The device-key screen lives at /analytics/devices and
  // is reached from a link on that page rather than its own sidebar entry — it is
  // administration of the feature, not the feature.
  //
  // `edit` is deliberately narrower than `view`: it governs issuing and revoking camera
  // API keys (AnalyticsDevice). Seeing footfall must not imply being able to mint a
  // credential that can write footfall.
  {
    key: "analytics",
    label: "Store Analytics",
    description: "Entrance footfall, counter health and the bills join",
    icon: "Activity",
    route: "/analytics",
    group: "Insights",
    sortOrder: 410,
    actions: ["view", "edit"],
  },

  // ── Service (merged from bch-service) ─────────────────────────────────────
  // These modules exist so the SERVICE_* roles below have real permissions to hold, and so
  // the ported API routes have a module to guard against.
  //
  // `route` is deliberately null on every one of them: the pages have NOT been ported yet.
  // The sidebar skips modules without a route, so seeding these now grants permissions
  // without filling the nav with links that 404. When a screen lands under /services/*, set
  // its route here and re-seed — that one line is all it takes for it to appear for everyone
  // who holds its view grant.
  {
    key: "service_jobs",
    label: "Service Jobs",
    description: "Workshop job cards, queue, assignment and status flow",
    icon: "Wrench",
    route: "/services/counter",
    group: "Service",
    sortOrder: 600,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "service_assembly",
    label: "Assembly Log",
    description: "Assembly work records and photos",
    icon: "ClipboardCheck",
    route: "/services/assembly",
    group: "Service",
    sortOrder: 610,
    actions: CRUD,
  },
  {
    key: "service_billing",
    label: "Service Billing",
    description: "Job billing, payment status and invoice linkage",
    icon: "CreditCard",
    route: "/services/billing",
    group: "Service",
    sortOrder: 620,
    actions: ["view", "create", "edit", "approve"],
  },
  {
    key: "service_prices",
    label: "Service Pricing",
    description: "Labour and parts price list by wheel size",
    icon: "IndianRupee",
    route: "/services/prices",
    group: "Service",
    sortOrder: 630,
    actions: CRUD,
  },
  {
    key: "service_reviews",
    label: "Customer Reviews",
    description: "Post-service ratings and Google review tracking",
    icon: "MessageSquare",
    route: null, // no standalone page; reviews surface inside the manager screen
    group: "Service",
    sortOrder: 640,
    actions: ["view", "delete"],
  },
  {
    key: "service_incentives",
    label: "Mechanic Incentives",
    description: "Mechanic performance and incentive calculation",
    icon: "BarChart3",
    route: null, // no standalone page; incentives surface inside the manager screen
    group: "Service",
    sortOrder: 650,
    actions: ["view", "edit"],
  },
  {
    key: "service_reports",
    label: "Service Reports",
    description: "Workshop throughput, TAT and history",
    icon: "BarChart3",
    route: "/services/manager",
    group: "Service",
    sortOrder: 660,
    actions: ["view"],
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    key: "team",
    label: "Team Management",
    description: "User accounts, access codes and role assignment",
    icon: "Users",
    route: "/team",
    group: "Admin",
    sortOrder: 500,
    actions: CRUD,
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    description: "Create roles and grant module permissions",
    icon: "ShieldCheck",
    route: "/team/permissions",
    group: "Admin",
    sortOrder: 510,
    actions: CRUD,
  },
  // Settings is the second module tree in this catalog (after Staff LMS): a parent with
  // children rendered as a collapsible sidebar section.
  //
  // `route` moved from /more/alerts to a real /settings hub. The old value pointed at one
  // specific settings page, which made the parent link incoherent once it had children —
  // clicking "Settings" landed on Alerts rather than on an index of settings.
  {
    key: "settings",
    label: "Settings",
    description: "Storage, integrations, alert config, bins and app logic",
    icon: "Settings",
    route: "/settings",
    group: "Admin",
    sortOrder: 520,
    actions: ["view", "create", "edit", "delete"],
  },
  {
    // ACTION SEMANTICS — the route guards depend on this exact meaning:
    //   view    — see which provider is live and its non-secret settings. Never the key.
    //   edit    — change credentials and run the connection test.
    //   approve — switch the LIVE provider. Deliberately separate from `edit`: correcting a
    //             typo in a bucket name and repointing every photo in the company are not
    //             the same decision, and CLAUDE.md says express that as a permission rather
    //             than as a role name.
    key: "settings_storage",
    label: "Storage",
    description: "Where uploaded photos and videos are stored — S3 or the server filesystem",
    icon: "HardDrive",
    // ROUTELESS ON PURPOSE. The page still exists at /settings/storage and is still reachable
    // — the Settings index links to it with a hardcoded href. What `route: null` removes is the
    // SIDEBAR ENTRY: app-sidebar.tsx:101 and more/page.tsx:68 both `continue` on a routeless
    // child. That is the whole point of the Settings tree: one entry in the sidebar, and the
    // index page as the only way in. api/modules/route.ts ignores `route` entirely, so this
    // still renders as an indented card in Roles & Permissions.
    route: null,
    group: "Admin",
    sortOrder: 521,
    actions: ["view", "edit", "approve"],
    parentKey: "settings",
  },
  {
    // NEW child, added with the notifications work. `view`/`edit` only — no `approve`:
    // settings_storage has one because repointing every photo in the company is a different
    // decision from fixing a typo, whereas flipping `pushEnabled` is instantly reversible.
    // If the master send-switch ever deserves a second pair of eyes, adding `approve` here is
    // a one-line change — which is the point of keeping these as modules rather than as
    // section-scoped actions on `settings`.
    key: "settings_notifications",
    label: "Notifications",
    description: "Email and push delivery — providers, credentials and per-event switches",
    icon: "Bell",
    route: null,
    group: "Admin", // MUST equal the parent's — the seeder asserts it
    sortOrder: 523,
    actions: ["view", "edit"],
    parentKey: "settings",
  },
  {
    // RE-PARENTED under settings and routeless, 2 Sep 2026. THE KEY DOES NOT CHANGE.
    // Renaming it to `settings_whatsapp` would read better and would be a bug: seed-rbac.ts
    // deletes any module missing from this catalog, and Permission.module / RolePermission
    // both cascade — so every existing whatsapp_templates.* grant would vanish silently,
    // with ADMIN unaffected so it would look fine to whoever tested it. Same argument as the
    // note above the `zoho` entry.
    //
    // 530 -> 524 keeps it inside the Settings band. 523/524 are the last free slots before
    // store_management at 540; see the band note at the top of this file.
    key: "whatsapp_templates",
    label: "WhatsApp Templates",
    description: "Customer messaging templates",
    icon: "MessageSquare",
    route: null,
    group: "Admin", // MUST equal the parent's — the seeder asserts it
    sortOrder: 524,
    actions: ["view", "edit"],
    parentKey: "settings",
  },

  // ── Store Management ──────────────────────────────────────────────────────
  // A parent plus two children, the second module tree in this catalog after Staff LMS.
  //
  // `store_management` is a ROOT module and must stay one: `stores` and `warehouses` are its
  // children, and nesting the parent under `settings` would make them GRANDCHILDREN, which
  // seed-rbac.ts:48 rejects outright — the sidebar walks exactly two levels, so a grandchild
  // would exist in the database and render nowhere.
  //
  // The parent is a grouping construct and its own `view` grant does almost nothing:
  // app-sidebar.tsx builds a placeholder parent from a child's carried parent data, so the
  // heading appears whenever EITHER child is granted. The real gates are stores.* and
  // warehouses.*. Do not give it CRUD expecting it to gate anything.
  //
  // Two modules rather than one, decided 30 Aug 2026: "open a new store" and "add a warehouse
  // to an existing site" are different decisions, and a warehouse supervisor can reasonably
  // hold the second without the first.
  {
    key: "store_management",
    label: "Store Management",
    description: "Sites and the warehouses inside them",
    icon: "Building2",
    route: null, // a pure container — no page of its own
    group: "Admin",
    sortOrder: 540,
    actions: ["view"],
  },
  {
    key: "stores",
    label: "Stores",
    description: "Store sites — the shops, their codes and contact details",
    icon: "Building2",
    route: "/stores",
    parentKey: "store_management",
    group: "Admin", // MUST equal the parent's group — the seeder asserts it
    sortOrder: 541,
    actions: CRUD,
  },
  {
    key: "warehouses",
    label: "Warehouses",
    description: "Warehouses under each store — where stock physically lives",
    icon: "Warehouse",
    route: "/stores/warehouses",
    parentKey: "store_management",
    group: "Admin",
    sortOrder: 542,
    actions: CRUD,
  },
  {
    // Re-parented under Settings, NOT recreated. The key stays "zoho", so every existing
    // role grant (zoho.view, zoho.fetch, ...) keeps working untouched — permissions key off
    // the module key, not its position in the tree. The seeder upserts route, group,
    // sortOrder and parentId in both create and update, so a re-seed performs the move.
    //
    // `group` must equal the parent's ("Admin"); the seeder asserts this, because a child
    // with its own group makes the sidebar render the section twice.
    key: "zoho",
    label: "Integrations",
    description: "Zoho Books, Zakya POS and Zoho Inventory connections",
    icon: "Cloud",
    // Routeless — same reasoning as settings_storage above. `parentKey` is KEPT: as a routeless
    // CHILD it stays indented under Settings in the admin grid, where a routeless root would
    // render flush-left. All 12 `zoho` guard sites are untouched; only the nav entry goes.
    route: null,
    group: "Admin",
    sortOrder: 522,
    actions: ["view", "edit", "approve", "fetch"],
    parentKey: "settings",
  },

  // ── Staff LMS ─────────────────────────────────────────────────────────────
  // The first module tree in this catalog: one parent plus three children, rendered as a
  // collapsible section in the sidebar. `parentKey` is what makes them children.
  //
  // sortOrder 700 opens a new band. Bands ARE the sidebar group order (see the note at the
  // top of this file), so a new group needs its own band or it renders split. 700 is clear
  // of Service (600s) and renumbers nothing. Children use 710/720/730 and sort inside the
  // parent, not globally.
  //
  // ACTION SEMANTICS — these are NOT the usual CRUD-on-a-record reading, and every route
  // guard in src/app/api/staff-lms depends on this exact meaning:
  //   view    — read the material AND record your own progress. Finishing a lesson writes
  //             to lms_lesson_progress; that is the learner's own row, gated on `view`,
  //             with the userId taken from the session and never from the request body.
  //   create  \
  //   edit     } change what everyone learns from — courses, lessons, products, playbooks.
  //   delete  /
  //   approve — see OTHER people's progress: the team performance section on the Staff LMS
  //             dashboard. This is how CLAUDE.md says to express "supervisors see all
  //             records, juniors see only their own" without naming a role.
  //
  // There is no AI Customer / roleplay module. That feature is out of scope — no table,
  // no route, no screen — so a permission for it would grant access to nothing.
  //
  // Content management (/staff-lms/manage/*) has no module of its own by design: it is
  // gated by create/edit/delete on the module that owns the content and reached from a
  // card on the dashboard. Same pattern as the analytics device-key screen — administration
  // of a feature, not a feature.
  {
    key: "staff_lms",
    label: "Staff LMS",
    description: "Learning dashboard, streaks, achievements and team performance",
    icon: "GraduationCap",
    route: "/staff-lms",
    group: "Staff LMS",
    sortOrder: 700,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "staff_lms_learning",
    label: "Learning",
    description: "Courses, lessons, quizzes, weekly tests, videos and playbooks",
    icon: "BookOpen",
    route: "/staff-lms/learning",
    group: "Staff LMS",
    sortOrder: 710,
    actions: ["view", "create", "edit", "delete", "approve"],
    parentKey: "staff_lms",
  },
  {
    key: "staff_lms_products",
    label: "Product Learning",
    description: "Product playbooks, specs, objections, comparisons and showroom mode",
    icon: "Bike",
    route: "/staff-lms/product-learning",
    group: "Staff LMS",
    sortOrder: 720,
    actions: ["view", "create", "edit", "delete", "approve"],
    parentKey: "staff_lms",
  },
  {
    key: "staff_lms_practice",
    label: "Practice & Scenarios",
    description: "Sales roleplay scenarios, customer objection handling and simulations",
    icon: "Swords",
    route: "/staff-lms/practice",
    group: "Staff LMS",
    sortOrder: 725,
    actions: ["view", "create", "edit", "delete", "approve"],
    parentKey: "staff_lms",
  },
  {
    key: "staff_lms_rank",
    label: "Rank",
    description: "XP leaderboard across the team",
    icon: "Trophy",
    route: "/staff-lms/rank",
    group: "Staff LMS",
    sortOrder: 730,
    actions: ["view", "create", "edit", "delete", "approve"],
    parentKey: "staff_lms",
  },
];

// ─── Role catalog ────────────────────────────────────────────────────────────
// Default roles shipped with their grants, so an admin can create a user and attach a
// working role without ticking a permission grid by hand.
//
// These six replace the service app's former `UserRole` enum. They are namespaced
// SERVICE_* because the old enum's SUPERVISOR and MANAGER collide with inventory-side
// job titles that mean something different, and roles.key is unique.
//
// Scope: service modules only. A workshop mechanic gets no inventory access — if someone
// needs both, give them a role that grants both, or move them to one that does.
//
// `customers` is included where the service app itself manages customers (the counter takes
// a phone number when a bike is dropped off), since after the merge there is ONE customer
// table shared by both sides.

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  /** module key -> actions granted on that module */
  grants: Record<string, ActionKey[]>;
}

export const ROLE_CATALOG: RoleSeed[] = [
  // EMPTY BY DECISION — owner, 8 Sep 2026: "I don't want any default roles in the RBAC,
  // remove the default roles except for admin."
  //
  // Seven roles used to live here (SERVICE_MECHANIC, SERVICE_SUPERVISOR, SERVICE_STAFF,
  // SERVICE_BILLING, SERVICE_MANAGER, SERVICE_VIEWER, STAFF_LMS_ADMIN). They are in git
  // history if the grant sets are ever wanted as a reference.
  //
  // ADMIN is NOT here and never was: seed-rbac.ts creates it directly (ADMIN_ROLE_KEY) with
  // isSystem: true and every permission, because the first login needs a role that already
  // holds everything. It is unaffected by this list being empty.
  //
  // WHAT THIS DOES AND DOES NOT DO. The seeder only CREATES a role that does not exist —
  // it never updates and never deletes one (unlike modules and permissions, which it prunes
  // with deleteMany/notIn). So emptying this list means a FRESH database gets ADMIN alone.
  // It does NOT remove roles from a database that already has them; those are deleted by
  // hand, and only once no User references them — User.roleId is required with the default
  // Restrict, so the delete is refused rather than orphaning anyone.
  //
  // Roles are created at runtime from /team/permissions. That is the point: a role is data
  // an admin defines, not a constant a developer ships.
];

/** Flattened (role, permission-key) pairs for seeding. */
export function roleGrantKeys(role: RoleSeed): string[] {
  return Object.entries(role.grants).flatMap(([moduleKey, actions]) =>
    actions.map((a) => `${moduleKey}.${a}`)
  );
}

/** Flattened (module, action) pairs — one Permission row each. */
export function allPermissionSeeds() {
  return MODULE_CATALOG.flatMap((m) =>
    m.actions.map((action) => ({
      moduleKey: m.key,
      action,
      key: `${m.key}.${action}`,
      label: `${ACTION_LABELS[action]} ${m.label}`,
    }))
  );
}
