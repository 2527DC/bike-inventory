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
}

// Groups render in this order in the sidebar.
export const MODULE_GROUPS = [
  "Overview",
  "Operations",
  "Purchase",
  "Accounts",
  "Insights",
  "Service",
  "Admin",
] as const;

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
  {
    key: "settings",
    label: "App Settings",
    description: "Alert config, bins, store updates and app logic",
    icon: "Settings",
    route: "/more/alerts",
    group: "Admin",
    sortOrder: 520,
    actions: ["view", "create", "edit", "delete"],
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
  {
    key: "zoho",
    label: "Zoho / Zakya Sync",
    description: "External accounting and inventory integrations",
    icon: "Cloud",
    route: "/more/zoho",
    group: "Admin",
    sortOrder: 540,
    actions: ["view", "edit", "approve", "fetch"],
  },
  {
    key: "problems",
    label: "App Problems",
    description: "In-app problem reports raised by staff",
    icon: "AlertCircle",
    route: "/more/problems",
    group: "Admin",
    sortOrder: 550,
    actions: ["view", "create", "edit", "delete"],
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
