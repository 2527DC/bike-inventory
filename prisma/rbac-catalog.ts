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
    actions: ["view", "create"],
  },

  // ── Operations ────────────────────────────────────────────────────────────
  {
    key: "stock",
    label: "Stock & Inventory",
    description: "Products, serials, stock levels and locations",
    icon: "Package",
    route: "/stock",
    group: "Operations",
    sortOrder: 100,
    actions: ["view", "create", "edit", "delete", "fetch"],
  },
  {
    key: "inbound",
    label: "Inbound Tracking",
    description: "Incoming shipments, receiving, putaway",
    icon: "ArrowDownCircle",
    route: "/inbound",
    group: "Operations",
    sortOrder: 110,
    actions: ["view", "create", "edit", "delete", "approve", "fetch"],
  },
  {
    key: "deliveries",
    label: "Deliveries & Dispatch",
    description: "Outward dispatch, delivery runs, pre-bookings",
    icon: "Truck",
    route: "/deliveries",
    group: "Operations",
    sortOrder: 120,
    actions: ["view", "create", "edit", "delete", "approve", "fetch"],
  },
  {
    key: "transfers",
    label: "Stock Transfers",
    description: "Inter-location transfer orders",
    icon: "ArrowRightLeft",
    route: "/transfers",
    group: "Operations",
    sortOrder: 130,
    actions: ["view", "create", "edit", "delete", "approve"],
  },
  {
    key: "stock_audit",
    label: "Stock Audit / Count",
    description: "Physical stock counts, reconciliation and resets",
    icon: "ClipboardCheck",
    route: "/stock-audit",
    group: "Operations",
    sortOrder: 140,
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
    actions: ["view", "create", "edit", "delete", "fetch"],
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
    group: "Purchase",
    sortOrder: 220,
    actions: CRUD,
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
    key: "bills",
    label: "Bills & Payments",
    description: "Vendor bills, payments, credits and bank statements",
    icon: "FileText",
    route: "/bills",
    group: "Accounts",
    sortOrder: 300,
    actions: ["view", "create", "edit", "delete", "approve", "fetch"],
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Expense entry and approval",
    icon: "Receipt",
    route: "/expenses",
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
    key: "customers",
    label: "Customers & Receivables",
    description: "Customer master, invoices and receivables",
    icon: "HandCoins",
    route: "/receivables",
    group: "Accounts",
    sortOrder: 320,
    actions: ["view", "create", "edit", "delete", "fetch"],
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
    actions: ["view", "create", "edit", "delete", "fetch"],
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
    route: "/settings/storage",
    group: "Admin",
    sortOrder: 521,
    actions: ["view", "edit", "approve"],
    parentKey: "settings",
  },
  {
    key: "whatsapp_templates",
    label: "WhatsApp Templates",
    description: "Customer messaging templates",
    icon: "MessageSquare",
    route: "/more/whatsapp-templates",
    group: "Admin",
    sortOrder: 530,
    actions: ["view", "edit"],
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
    route: "/settings/integrations",
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

const ALL_JOB_ACTIONS: ActionKey[] = ["view", "create", "edit", "delete", "approve"];
const ALL_LMS_ACTIONS: ActionKey[] = ["view", "create", "edit", "delete", "approve"];

export const ROLE_CATALOG: RoleSeed[] = [
  {
    key: "SERVICE_MECHANIC",
    name: "Service Mechanic",
    description: "Works assigned job cards and logs assembly work.",
    grants: {
      service_jobs: ["view", "edit"], // works jobs; cannot create or delete them
      service_assembly: ["view", "create", "edit"],
    },
  },
  {
    key: "SERVICE_SUPERVISOR",
    name: "Service Supervisor",
    description: "Assigns work, approves job completion, oversees the floor.",
    grants: {
      service_jobs: ALL_JOB_ACTIONS,
      service_assembly: CRUD,
      service_prices: ["view"],
      service_reports: ["view"],
      service_incentives: ["view"],
    },
  },
  {
    key: "SERVICE_STAFF",
    name: "Service Counter Staff",
    description: "Receives bikes at the counter, creates job cards, handles customers.",
    grants: {
      service_jobs: ["view", "create", "edit"],
      service_prices: ["view"],
      customers: ["view", "create", "edit"],
    },
  },
  {
    key: "SERVICE_BILLING",
    name: "Service Billing",
    description: "Bills completed jobs and records payment.",
    grants: {
      service_billing: ["view", "create", "edit", "approve"],
      service_jobs: ["view"],
      service_prices: ["view"],
      customers: ["view"],
    },
  },
  {
    key: "SERVICE_MANAGER",
    name: "Service Manager",
    description: "Full workshop control including pricing, reviews and incentives.",
    grants: {
      service_jobs: ALL_JOB_ACTIONS,
      service_assembly: CRUD,
      service_billing: ["view", "create", "edit", "approve"],
      service_prices: CRUD,
      service_reviews: ["view", "delete"],
      service_incentives: ["view", "edit"],
      service_reports: ["view"],
      customers: ["view", "create", "edit"],
    },
  },
  {
    key: "SERVICE_VIEWER",
    name: "Service Viewer",
    description: "Read-only view of the workshop board. Cannot change anything.",
    grants: {
      service_jobs: ["view"],
      service_reports: ["view"],
    },
  },

  // ── Staff LMS ─────────────────────────────────────────────────────────────
  // The ONLY role this merge seeds. Deliberate: modules and permissions are created by the
  // seed, but who holds them is decided by hand at /team/permissions, with no redeploy.
  // There is no seeded learner, editor or lead role and no backfill script — so right after
  // `db:seed:rbac` an ordinary staff member gets no sidebar entry and 403 on every
  // /api/staff-lms call. That is the module shipping UNASSIGNED, not broken.
  //
  // Everything inside Staff LMS, nothing outside it. A person holding this role authors
  // content and reads the whole team's progress, but has no stock, purchase, accounts or
  // service access at all — scoped the same way the SERVICE_* roles above are. It is a
  // module owner, not a system administrator.
  //
  // Note the seeder is create-only for roles that already exist: this is created once with
  // its 20 grants, and any later widening or narrowing you do in the UI survives re-seeding.
  {
    key: "STAFF_LMS_ADMIN",
    name: "Staff LMS Admin",
    description: "Full control of Staff LMS — content, learners and team progress.",
    grants: {
      staff_lms: ALL_LMS_ACTIONS,
      staff_lms_learning: ALL_LMS_ACTIONS,
      staff_lms_products: ALL_LMS_ACTIONS,
      staff_lms_practice: ALL_LMS_ACTIONS,
      staff_lms_rank: ALL_LMS_ACTIONS,
    },
  },
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
