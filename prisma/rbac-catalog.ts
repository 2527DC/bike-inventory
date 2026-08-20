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
export const MODULE_GROUPS = ["Overview", "Operations", "Purchase", "Accounts", "Insights", "Admin"] as const;

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
