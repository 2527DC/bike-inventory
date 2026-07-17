"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronDown, ChevronRight, Search,
  LayoutDashboard, Truck, Package, Store, FileText, Users,
  ClipboardCheck, ShoppingCart, CreditCard, BarChart3,
  AlertCircle, Cloud, Receipt, ArrowRightLeft, QrCode,
  Bike, Brain, Wrench, Settings, Bell, Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/* ═══════════════════════════════════════════════════════════════
   APP LOGIC — Single Source of Truth for BCH Operating System
   Every number, every button, every rule documented.
   CEO-only. Last updated: May 2026.
   ═══════════════════════════════════════════════════════════════ */

// ── Types ──

interface LogicEntry {
  label: string;
  type: "number" | "button" | "rule" | "fetch" | "api" | "nav" | "widget" | "action" | "filter";
  detail: string;
  affects?: string;
  api?: string;
  roles?: string;
  important?: boolean;
}

interface LogicSection {
  id: string;
  title: string;
  icon: typeof LayoutDashboard;
  color: string;
  description: string;
  entries: LogicEntry[];
}

// ── All Logic Data ──

const LOGIC_SECTIONS: LogicSection[] = [
  // ═══════════════════════════════════════════════════════════
  // 1. DASHBOARD
  // ═══════════════════════════════════════════════════════════
  {
    id: "dashboard",
    title: "Dashboard (Home)",
    icon: LayoutDashboard,
    color: "bg-blue-100 text-blue-700",
    description: "Role-based home page. Each role sees different stats, cards, and actions.",
    entries: [
      // ── Role Mapping ──
      { label: "Dashboard Role Mapping", type: "rule", detail: "CEO/ADMIN → AdminDashboard | SUPERVISOR/STORE_MANAGER → SupervisorDashboard | PURCHASE_MANAGER → PurchaseManagerDashboard | ACCOUNTS_MANAGER → AccountsManagerDashboard | INWARDS_EXECUTIVE/SERVICE_MANAGER/CUSTOM → ClerkDashboard (inward) | OUTWARDS_EXECUTIVE/SALES_MANAGER → OutwardsClerkDashboard", important: true },

      // ── CEO/ADMIN Dashboard Stats ──
      { label: "Outstanding Payable", type: "number", detail: "Total unpaid amount owed to all vendors. Calculated server-side from all bills with balance > 0.", api: "GET /api/accounts/summary → .stats.outstandingPayable", affects: "Links to /accounts page", roles: "CEO, ADMIN" },
      { label: "Outstanding Receivable", type: "number", detail: "Total amount customers owe us. Calculated from pending customer invoices.", api: "GET /api/accounts/summary → .stats.outstandingReceivable", affects: "Links to /receivables page", roles: "CEO, ADMIN" },
      { label: "Stock Value", type: "number", detail: "Total value of all inventory. Pulled from AI insights which calculates sum of (stock × cost price) for all active products.", api: "GET /api/ai/dashboard-insights → find type='stock_value' → .value", affects: "Links to /stock page", roles: "CEO, ADMIN" },
      { label: "Overdue Bills", type: "number", detail: "Count of bills where dueDate < today AND balance > 0. Shows 'None' if 0. Card turns RED if > 0, GREEN if 0.", api: "GET /api/accounts/summary → .stats.overdueBills", affects: "Links to /bills page", roles: "CEO, ADMIN" },
      { label: "Low Stock Count", type: "number", detail: "Number of products where currentStock <= reorderLevel AND reorderLevel > 0. Excludes inactive products.", api: "GET /api/ai/dashboard-insights → find type='reorder' → .value", affects: "Links to /reorder page", roles: "CEO, ADMIN" },
      { label: "In Transit", type: "number", detail: "Count of inbound shipments with status IN_TRANSIT. These are purchase orders/shipments that have been dispatched by vendors but not yet received.", api: "GET /api/inbound/stats → .data.inTransit.items", affects: "Links to /inbound page", roles: "CEO, ADMIN" },
      { label: "Open Vendor Issues", type: "number", detail: "Total count of vendor issues (brand + client) that are not CLOSED. Fetched via pagination total.", api: "GET /api/vendor-issues?limit=1 → .pagination.total", affects: "Links to /vendor-issues page", roles: "CEO, ADMIN" },
      { label: "AI Insights Count", type: "number", detail: "Total number of AI-generated insights (reorder alerts, slow stock, anomalies). All rule-based, not ML.", api: "GET /api/ai/dashboard-insights → count", affects: "Links to /ai page", roles: "CEO, ADMIN" },
      { label: "Inwards Today", type: "number", detail: "Count of inward transactions created today. Uses dateFrom=today filter with limit=1 to get pagination total only.", api: "GET /api/inventory/inwards?dateFrom={today}&limit=1 → .pagination.total", roles: "CEO, ADMIN" },
      { label: "Outwards Today", type: "number", detail: "Count of outward transactions created today. Same pattern as Inwards Today.", api: "GET /api/inventory/outwards?dateFrom={today}&limit=1 → .pagination.total", roles: "CEO, ADMIN" },

      // ── CEO/ADMIN Dashboard Buttons ──
      { label: "SOPs Button", type: "nav", detail: "Navigates to /sops?action=add. Opens SOP management page with create action pre-triggered.", affects: "Opens SOP page", roles: "CEO, ADMIN" },
      { label: "Tasks Button", type: "nav", detail: "Navigates to /tasks page showing all assigned tasks.", affects: "Opens Tasks page", roles: "CEO, ADMIN" },

      // ── CEO/ADMIN Dashboard Widgets ──
      { label: "Critical Alerts Widget", type: "widget", detail: "Shows alerts from /api/health/summary → .data.criticalAlerts. Displays message + owner badge with pulsing animation. Appears at TOP of dashboard only when alerts exist.", api: "GET /api/health/summary", roles: "CEO, ADMIN", important: true },
      { label: "Smart Insights Widget", type: "widget", detail: "Shows first 4 AI insights (excluding stock_value and reorder types). Each insight has severity badge (danger/warning/success/info). Links to /ai for full list.", api: "GET /api/ai/dashboard-insights", roles: "CEO, ADMIN" },
      { label: "Team Health Widget", type: "widget", detail: "Shows per-person pending task counts with overdue breakdown. Badges: 72h+ overdue = RED pulsing, 48h+ = RED, 24h+ = YELLOW. Helps identify who is falling behind.", api: "GET /api/health/summary → .data.people", roles: "CEO, ADMIN", important: true },
      { label: "Today's Summary Card", type: "widget", detail: "6 metrics in 2-column grid: Inwards verified, Inwards pending, Deliveries closed, Deliveries pending, Expenses today, POs no tracking. AMBER if pending > 0, else GREEN.", api: "GET /api/health/summary → .data.today", roles: "CEO, ADMIN" },
      { label: "Overdue Bills List", type: "widget", detail: "Shows first 5 overdue bills. Each shows: vendor name, bill number, due date, amount due (= amount - paidAmount). Each links to /bills/{id}.", api: "GET /api/accounts/summary → .overdueBillsList", roles: "CEO, ADMIN" },
      { label: "Team Checklist Stats", type: "widget", detail: "Per-user daily checklist completion percentage. GREEN = 100%, AMBER = partial, RED = 0%.", api: "GET /api/checklists/stats", roles: "CEO, ADMIN" },

      // ── Share Daily Report ──
      { label: "Share Daily Report (WhatsApp)", type: "action", detail: "Fetches today's activity log, formats into WhatsApp message with: total actions, category breakdown (DELIVERY/STOCK/INBOUND etc.), team activity (per person action count), last 10 activities with timestamps. Opens WhatsApp share.", api: "GET /api/activity?date={today}", affects: "Opens WhatsApp with formatted daily report", roles: "ALL roles", important: true },

      // ── SOP Nudge Banner ──
      { label: "SOP Morning Nudge Banner", type: "widget", detail: "Shows at top of ALL role dashboards if: (1) pending SOPs > 0, (2) not dismissed, (3) total SOPs > 0. Filters for DAILY frequency only. Shows '{pending} SOPs pending today' with 'Check Off' button → /sops/my-checkoffs. Can be dismissed with X.", api: "GET /api/sops?isActive=true&forMyRole=true + GET /api/sops/compliance?date={today}", roles: "ALL roles" },

      // ── SOP Checkoff Widget ──
      { label: "SOP Checkoff Widget", type: "widget", detail: "Shows first 5 SOPs with inline checkboxes. Progress bar shows done/total. Click checkbox → toggles check-off via POST. Links to /sops/my-checkoffs for full list.", api: "GET /api/sops?isActive=true&forMyRole=true + POST /api/sops/compliance", roles: "ALL roles" },

      // ── My Tasks Widget ──
      { label: "My Tasks Widget", type: "widget", detail: "Shows top 5 non-DONE tasks sorted by priority. Priority dots: TODAY=Red, TOMORROW=Orange, THREE_DAYS=Yellow, WEEK=Blue, MONTH=Gray. Status badges: IN_PROGRESS=blue, BLOCKED=red.", api: "GET /api/tasks?limit=50", roles: "ALL roles" },

      // ── Daily Checklist Widget ──
      { label: "Daily Checklist Widget", type: "widget", detail: "Shows today's checklist items with toggle checkboxes. Optimistic UI — toggles immediately, syncs to server. Checking → POST /api/checklists/complete. Unchecking → DELETE /api/checklists/complete?templateId={id}&date={today}.", api: "GET /api/checklists?date={today}", roles: "ALL roles" },

      // ── Outwards Clerk Dashboard ──
      { label: "Pending Verify (Outwards)", type: "number", detail: "Count of deliveries with status PENDING. These are new invoices fetched from Zoho that haven't been verified yet.", api: "GET /api/deliveries/stats → .pending", affects: "Links to /deliveries", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Scheduled (Outwards)", type: "number", detail: "Count of deliveries with status SCHEDULED. These are verified deliveries with a scheduled delivery date.", api: "GET /api/deliveries/stats → .scheduled", affects: "Links to /deliveries", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Out for Delivery (Outwards)", type: "number", detail: "Count of deliveries currently out for delivery. Dispatched but not yet delivered.", api: "GET /api/deliveries/stats → .outForDelivery", affects: "Links to /deliveries/dispatch", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Delivered (Outwards)", type: "number", detail: "Count of delivered items. Shows only current month's delivered items (auto-hide rule).", api: "GET /api/deliveries/stats → .delivered", affects: "Links to /deliveries", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Prebooked (Outwards)", type: "number", detail: "Count of pre-booked deliveries. Shows only if > 0. These are advance bookings not yet invoiced.", api: "GET /api/deliveries/stats → .prebooked", affects: "Links to /deliveries?status=PREBOOKED", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Flagged (Outwards)", type: "number", detail: "Count of flagged deliveries. Shows only if > 0. RED badge. These have issues that need attention.", api: "GET /api/deliveries/stats → .flagged", affects: "Links to /deliveries", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },
      { label: "Walk-out Nudge Banner", type: "widget", detail: "Shows if pending > 0. Pulsing animation. Text: '{pending} Walk-outs pending — Verify walk-out deliveries before end of day'. Links to /deliveries/walkout.", roles: "OUTWARDS_EXECUTIVE, SALES_MANAGER" },

      // ── Inwards Clerk Dashboard ──
      { label: "My Inwards Today (Clerk)", type: "number", detail: "Total quantity of inward transactions created by current user today. Shows trend as '{count} entries'.", api: "GET /api/inventory/inwards?dateFrom={today}&limit=50&mine=true", roles: "INWARDS_EXECUTIVE, SERVICE_MANAGER, CUSTOM" },
      { label: "Inwards EOD Report", type: "action", detail: "Fetches 3 APIs in parallel: (1) my inwards today, (2) all transfers today, (3) all inwards today. Formats WhatsApp message with quantities, entry counts, first 15 inward details, first 10 transfer details.", api: "3 concurrent fetches", affects: "Opens WhatsApp with EOD report", roles: "INWARDS_EXECUTIVE" },

      // ── Supervisor Dashboard ──
      { label: "Supervisor Stats", type: "number", detail: "Same 4 top cards as CEO (Outstanding Payable, Receivable, Overdue Bills, Open Issues) plus Daily Pulse (Inwards/Outwards today). Also shows MyTasksWidget, ShareDailyReport, SOPCheckoffWidget, DailyChecklistWidget.", api: "Multiple APIs", roles: "SUPERVISOR, STORE_MANAGER" },

      // ── Purchase Manager Dashboard ──
      { label: "Purchase Manager Stats", type: "number", detail: "4 cards: Total Products (from /api/products), Low Stock (from AI insights), Inwards Today, Pending POs (shows dash).", api: "GET /api/products?limit=1&status=ACTIVE + /api/ai/dashboard-insights", roles: "PURCHASE_MANAGER" },

      // ── Accounts Manager Dashboard ──
      { label: "Accounts Manager Stats", type: "number", detail: "3 cards: Ops Issues (open vendor issues count), Pending Audits (PENDING stock counts), Expenses 30d (total from accounts summary).", api: "GET /api/vendor-issues + /api/stock-counts + /api/accounts/summary", roles: "ACCOUNTS_MANAGER" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 2. DELIVERIES
  // ═══════════════════════════════════════════════════════════
  {
    id: "deliveries",
    title: "Deliveries",
    icon: Truck,
    color: "bg-orange-100 text-orange-700",
    description: "Delivery tracking from Zoho invoice fetch to customer handover. Hub: Walk-out, Bangalore, Outstation, Dispatch, Prebook.",
    entries: [
      // ── Status Flow ──
      { label: "Delivery Status Flow", type: "rule", detail: "PREBOOKED → PENDING → VERIFIED → SCHEDULED → (WALK_OUT or OUT_FOR_DELIVERY) → DELIVERED. Also: FLAGGED (issues), PACKED/SHIPPED/IN_TRANSIT (outstation).", important: true },
      { label: "Auto-Hide Rule", type: "rule", detail: "DELIVERED and WALK_OUT deliveries are hidden from the list unless they were delivered in the current month OR a specific date/dateRange filter is applied. This prevents old delivered items from cluttering the view.", api: "GET /api/deliveries — server-side filter: deliveredAt >= startOfMonth", important: true },

      // ── Fetch Buttons ──
      { label: "Fetch from Zoho (Quick Search)", type: "fetch", detail: "Search by invoice number or phone number (min 3 chars). Calls POST /api/deliveries/search-zoho with {query}. Returns matching invoices with 'alreadyImported' flag. Auto-selects new ones. Then POST /api/deliveries/import-zoho with {invoiceIds}.", api: "POST /api/deliveries/search-zoho → POST /api/deliveries/import-zoho", affects: "Creates new Delivery records in database from Zoho invoices. Sets status=PENDING. Imports customer name, phone, amount, line items.", roles: "Roles with fetch:deliveries permission", important: true },
      { label: "Fetch from Zoho (Date Range)", type: "fetch", detail: "Step 1: POST /api/zoho/trigger-pull step='init' → gets pullId. Step 2: POST /api/zoho/trigger-pull step='invoices' with {pullId, fromDate} → fetches invoices from Zoho for date range. Step 3: GET /api/zoho/pull-review?pullId → shows preview. Step 4: POST /api/zoho/pull-review/approve with selected invoice IDs. Day options: 3, 7, 14, 30, custom.", api: "4-step Zoho pull flow", affects: "Creates multiple Delivery records. Each invoice becomes one delivery with line items, customer data, amounts.", roles: "Roles with fetch:deliveries permission", important: true },

      // ── Action Buttons ──
      { label: "Flag Delivery", type: "action", detail: "Prompts for reason. Calls POST /api/deliveries/{id}/flag with {reason}. Sets status=FLAGGED. Response includes alertPhones[] and whatsappMessage. If phones exist, opens WhatsApp to first phone with the flag alert message.", api: "POST /api/deliveries/{id}/flag", affects: "Changes status to FLAGGED. Sends WhatsApp alert to configured alert phones.", important: true },
      { label: "Mark Ready", type: "action", detail: "Sets delivery status back to PENDING. Used to unflag or reset a delivery.", api: "PUT /api/deliveries/{id} with {status: 'PENDING'}", affects: "Changes status to PENDING" },
      { label: "Delete Delivery", type: "action", detail: "Confirmation dialog: 'Delete this delivery entry?'. Calls DELETE /api/deliveries/{id}. Removes the delivery record entirely.", api: "DELETE /api/deliveries/{id}", affects: "Permanently removes delivery record", roles: "Admin only for bulk, others for individual" },
      { label: "Bulk Delete", type: "action", detail: "Confirmation: 'Delete ALL {count} deliveries in current view? This cannot be undone.' Iterates and DELETEs each one. Shows progress: 'Deleted X of Y'.", api: "DELETE /api/deliveries/{id} × N", affects: "Permanently removes all visible deliveries", roles: "Admin only", important: true },
      { label: "Edit Scheduled Date", type: "action", detail: "Inline date input on delivery card. Calls PUT /api/deliveries/{id} with {scheduledDate}.", api: "PUT /api/deliveries/{id}", affects: "Updates scheduled delivery date" },

      // ── Delivery Detail Page ──
      { label: "Delivery Detail (/deliveries/[id])", type: "rule", detail: "Shows full delivery info: invoice details, customer info, line items, status history, handover actions. Actions depend on current status." },
      { label: "Walk-out Button (Detail)", type: "action", detail: "Available when status=PENDING. Marks as WALK_OUT (customer picked up in store). Opens handover form.", affects: "Changes status to WALK_OUT" },
      { label: "Schedule Button (Detail)", type: "action", detail: "Available when status=PENDING or VERIFIED. Sets scheduled date and changes status to SCHEDULED.", affects: "Changes status to SCHEDULED" },
      { label: "Verify Button (Detail)", type: "action", detail: "Available when status=PENDING. Marks items as verified for delivery.", affects: "Changes status to VERIFIED" },

      // ── Sub-pages ──
      { label: "Walk-out Page (/deliveries/walkout)", type: "nav", detail: "Shows all deliveries with status=WALK_OUT. Searchable. Click navigates to detail page.", api: "GET /api/deliveries?status=WALK_OUT&limit=100" },
      { label: "Bangalore Page (/deliveries/blr)", type: "nav", detail: "Shows non-outstation deliveries excluding WALK_OUT and PREBOOKED. Filters: ALL, PENDING, SCHEDULED, OUT_FOR_DELIVERY, DELIVERED.", api: "GET /api/deliveries?outstation=false&limit=100" },
      { label: "Outstation Page (/deliveries/outstation)", type: "nav", detail: "Shows outstation-only deliveries. Extra statuses: PACKED, SHIPPED, IN_TRANSIT. Shows courier name and tracking number if available.", api: "GET /api/deliveries?outstation=true&limit=100" },
      { label: "Dispatch Page (/deliveries/dispatch)", type: "nav", detail: "Two tabs: (1) Dispatch — move SCHEDULED → OUT_FOR_DELIVERY. (2) Mark Delivered — move OUT_FOR_DELIVERY → DELIVERED. Both support multi-select. Grouped by customer area.", api: "PUT /api/deliveries/batch with {deliveryIds, action}", important: true },
      { label: "Prebook Page (/deliveries/prebook)", type: "nav", detail: "Form to create pre-order: customer name, phone, invoice/reference no, advance amount, product description, expected ready date, notes. Creates delivery with status=PREBOOKED.", api: "POST /api/deliveries" },

      // ── Filters ──
      { label: "Status Filter", type: "filter", detail: "Options: PENDING (default), VERIFIED, WALK_OUT, SCHEDULED, OUT_FOR_DELIVERY, DELIVERED, FLAGGED, PREBOOKED, PACKED, SHIPPED, IN_TRANSIT. URL param: ?status=PREBOOKED sets initial filter." },
      { label: "Date Range Filter", type: "filter", detail: "Collapsible panel with preset ranges: Today, This Week, This Month, Last 30 Days, Custom. Affects which deliveries are shown." },
      { label: "Search", type: "filter", detail: "Searches by invoice number or customer name. Debounced (300ms delay). Client-side filtering on loaded data." },

      // ── Display Rules ──
      { label: "Aging Badge", type: "rule", detail: "Shows days since invoice date. Color: GREEN (0-2 days), YELLOW (3-6 days), RED (7+ days). Helps identify stuck deliveries." },
      { label: "Delivery Card Info", type: "rule", detail: "Shows: customer name, invoice number, invoice amount (INR), area (MapPin), line items (first item + '+X more'), sales person, scheduled date, phone (clickable tel: link)." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 3. INBOUND (INWARDS)
  // ═══════════════════════════════════════════════════════════
  {
    id: "inbound",
    title: "Inbound (Inwards)",
    icon: Package,
    color: "bg-green-100 text-green-700",
    description: "Stock received from vendors. Each inward transaction adds quantity to product stock. Backed by Zoho purchase receives.",
    entries: [
      { label: "Inbound Fetch from Zoho", type: "fetch", detail: "Same 4-step Zoho pull flow as deliveries but with step='items' or step='purchase_receives'. Pulls purchase receive documents from Zoho Books. Each line item maps to a product and adds to stock.", api: "POST /api/zoho/trigger-pull → GET /api/zoho/pull-review → POST /api/zoho/pull-review/approve", affects: "Creates inward transactions, increases product currentStock", roles: "Roles with fetch:inbound permission", important: true },
      { label: "Inward Transaction", type: "rule", detail: "Each inward record has: product, quantity, reference number (Zoho doc), vendor, date. When created, product.currentStock is incremented by the quantity.", important: true },
      { label: "Inwards List", type: "nav", detail: "Shows all inward transactions. Searchable by product name, SKU, reference. Filterable by date range. Shows: product, qty, vendor, date, reference, created by.", api: "GET /api/inventory/inwards?limit=100" },
      { label: "New Inward (Manual)", type: "action", detail: "Form to manually record stock receipt. Fields: product (search), quantity, reference number, notes. Only available if role has create:inbound permission.", api: "POST /api/inventory/inwards", affects: "Creates transaction + increments product stock", roles: "Roles with create:inbound" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 4. STOCK
  // ═══════════════════════════════════════════════════════════
  {
    id: "stock",
    title: "Stock",
    icon: Store,
    color: "bg-emerald-100 text-emerald-700",
    description: "Product catalog and inventory levels. All stock movements backed by Zoho documents.",
    entries: [
      // ── Stock Status Rules ──
      { label: "Stock Status Colors", type: "rule", detail: "GREEN: currentStock > reorderLevel OR no reorderLevel set. YELLOW: 0 < currentStock <= reorderLevel (low stock). RED: currentStock = 0 (out of stock).", important: true },
      { label: "Auto-Refresh", type: "rule", detail: "Stock page auto-refreshes data every 2 minutes (120,000ms interval). Prevents stale data on static screens." },

      // ── Views ──
      { label: "List View (Default)", type: "nav", detail: "Shows products with: name, SKU, current stock (color-coded), reorder level, brand, category, bin. Paginated (100 per page). Sortable by stock level.", api: "GET /api/products?limit=100&sortBy=currentStock&sortOrder=desc" },
      { label: "Per-Item View", type: "nav", detail: "Groups by product → shows bins with quantities. Shows which bin has how many units of each product.", api: "GET /api/stock/per-item" },
      { label: "By Brand View", type: "nav", detail: "Groups products by brand. Shows: brand name, product count, total stock, low/out-of-stock badges. Expandable — lazy-loads products on expand.", api: "GET /api/stock/by-brand → GET /api/products?brandId={id}&limit=500 (on expand)" },

      // ── Filters ──
      { label: "Quick Filters", type: "filter", detail: "ALL, IN_STOCK (stock > 0), NO_STOCK (stock = 0), LOW_STOCK (0 < stock <= reorderLevel), INACTIVE." },
      { label: "Advanced Filters", type: "filter", detail: "Brand (dropdown from /api/brands), Category (dropdown from /api/categories), Size (12\" to 29\"), Bin (dropdown from /api/bins). All combinable." },

      // ── Fetch Buttons ──
      { label: "Zoho Item Import", type: "fetch", detail: "Same 4-step Zoho pull: init → items → review → approve. Imports new products from Zoho Inventory. Creates Product records with SKU, name, cost price, selling price.", api: "POST /api/zoho/trigger-pull step='items'", affects: "Creates new Product records in database", roles: "Admin", important: true },

      // ── Bulk Actions ──
      { label: "Bulk Actions", type: "action", detail: "Select mode: toggle checkboxes on products. Actions: (1) Assign Brand — dropdown, (2) Change Status — ACTIVE/INACTIVE, (3) Assign Category — dropdown. Applies to all selected.", api: "POST /api/products/bulk with {productIds, brandId?, status?, categoryId?}", affects: "Updates brand/status/category for selected products" },

      // ── Export ──
      { label: "Export (Excel/PDF)", type: "action", detail: "Downloads stock data as Excel or PDF. Columns: SKU, Name, Type, Category, Brand, Size, Current Stock, Reorder Level, Bin." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 5. VENDORS
  // ═══════════════════════════════════════════════════════════
  {
    id: "vendors",
    title: "Vendors",
    icon: Store,
    color: "bg-indigo-100 text-indigo-700",
    description: "Vendor (brand) management. Star ratings, outstanding balances, contact details.",
    entries: [
      { label: "Star Rating Logic", type: "rule", detail: "Based on bill count percentile across all vendors. 80%+ bills → 5 stars, 60%+ → 4 stars, 40%+ → 3 stars, 20%+ → 2 stars, <20% → 1 star. More bills = better relationship = more stars.", important: true },
      { label: "Vendor Card", type: "rule", detail: "Shows: name, star rating, city, bill count, status badge (Active/Inactive), outstanding balance (if > 0), phone icon (clickable tel: link)." },
      { label: "Vendor List", type: "nav", detail: "Searchable (min 2 chars, searches name/code/city). Filterable by status (ALL/ACTIVE/INACTIVE). Sortable by Name A-Z, Highest Due, Lowest Due.", api: "GET /api/vendors?limit=100&includeInactive=true" },
      { label: "Vendor Detail", type: "nav", detail: "Shows vendor details, all bills, all purchase orders, payment history. Links to record payment.", api: "GET /api/vendors/{id}" },
      { label: "Export", type: "action", detail: "Excel/PDF with columns: Code, Name, City, Phone, WhatsApp, Payment Terms, Status, POs count, Bills count." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 6. BILLS & PAYMENTS
  // ═══════════════════════════════════════════════════════════
  {
    id: "bills",
    title: "Bills & Payments",
    icon: FileText,
    color: "bg-red-100 text-red-700",
    description: "Vendor bills from Zoho. Payment recording with AI screenshot parsing. FIFO allocation.",
    entries: [
      // ── Bill Status Rules ──
      { label: "Bill Status Rules", type: "rule", detail: "PAID: balance = 0. PARTIALLY_PAID: 0 < balance < total. PENDING: balance = total (nothing paid). OVERDUE: dueDate < today AND balance > 0.", important: true },

      // ── Fetch ──
      { label: "Fetch Bills from Zoho", type: "fetch", detail: "Search by bill number (prefix search) or date range (3/7/14/30 days). Same 4-step Zoho pull flow with step='bills'. Creates Bill records with vendor, line items, amounts, due dates.", api: "POST /api/zoho/trigger-pull step='bills'", affects: "Creates Bill records in database. Links to vendor.", roles: "Roles with fetch:bills permission", important: true },

      // ── Bills List ──
      { label: "Bills List Filters", type: "filter", detail: "Status: ALL, OVERDUE, PENDING, PARTIALLY_PAID, PAID. Billed To: ALL, HUB, CENTRE. Date range: custom or preset. Search: bill number or vendor name." },
      { label: "Bill Card", type: "rule", detail: "Shows: bill number, vendor name, bill date, due date, amount, paid amount, balance (amount - paidAmount), status badge, aging indicator." },

      // ── Payment Recording ──
      { label: "Record Payment (/payments/new)", type: "action", detail: "Full payment recording form. Fields: vendor, amount, payment mode (CASH/CHEQUE/NEFT/RTGS/UPI), date, reference no, notes, bill allocation.", api: "POST /api/payments", affects: "Creates Payment record. Updates bill paidAmount and status. Reduces vendor outstanding balance.", important: true },
      { label: "AI Screenshot Parser", type: "fetch", detail: "Upload bank statement / payment screenshot. AI extracts: vendor name, amount, payment mode, date, reference, bank name, payer. Fuzzy-matches vendor name to system vendors. Auto-fills form.", api: "POST /api/payments/parse-screenshot", affects: "Auto-fills payment form fields from image" },
      { label: "FIFO Bill Allocation", type: "rule", detail: "When amount is entered, system auto-allocates to oldest bills first (sorted by dueDate ascending). User can manually override by toggling bill checkboxes. Partial payments are supported — shows 'Paying: X' for partial.", important: true },
      { label: "Payment Modes", type: "rule", detail: "CASH, CHEQUE, NEFT, RTGS, UPI. IMPS auto-maps to NEFT. Each payment can include reference number (cheque no / UTR no)." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 7. PURCHASE ORDERS
  // ═══════════════════════════════════════════════════════════
  {
    id: "purchase-orders",
    title: "Purchase Orders",
    icon: ShoppingCart,
    color: "bg-purple-100 text-purple-700",
    description: "Purchase order creation, approval, and tracking. Links to Reorder dashboard.",
    entries: [
      { label: "PO Status Flow", type: "rule", detail: "DRAFT → PENDING_APPROVAL → APPROVED → SENT_TO_VENDOR → PARTIALLY_RECEIVED → RECEIVED. Also: CANCELLED.", important: true },
      { label: "PO List", type: "nav", detail: "Shows all POs with: PO number, vendor, status badge, amount, items count, order date, aging (if pending). Filterable by status, searchable, date range.", api: "GET /api/purchase-orders?limit=50" },
      { label: "New PO", type: "action", detail: "Form: vendor (dropdown), expected delivery date, product search + line items (qty, price, GST). Auto-loads reorder items from sessionStorage if coming from Reorder page.", api: "POST /api/purchase-orders", affects: "Creates PO record with line items" },
      { label: "Approve PO", type: "action", detail: "Changes status to APPROVED. Available for DRAFT/PENDING_APPROVAL.", api: "POST /api/purchase-orders/{id}/approve", roles: "Roles with approve:purchase_orders" },
      { label: "Send via WhatsApp", type: "action", detail: "Available for APPROVED POs. Opens WhatsApp with vendor phone and pre-filled message: PO number, items (name, SKU, qty, price), total, expected date.", affects: "Opens WhatsApp, marks PO as SENT_TO_VENDOR" },
      { label: "PO from Reorder", type: "rule", detail: "Reorder page stores selected items in sessionStorage key 'reorder-po-items'. New PO page reads this and pre-fills line items. Seamless flow: Reorder → Select items → Create PO." },
      { label: "Aging Badge", type: "rule", detail: "Shows for SENT_TO_VENDOR and PARTIALLY_RECEIVED statuses. AMBER if > 7 days, RED if > 14 days since order date." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 8. TEAM MANAGEMENT
  // ═══════════════════════════════════════════════════════════
  {
    id: "team",
    title: "Team Management",
    icon: Users,
    color: "bg-teal-100 text-teal-700",
    description: "User CRUD, role assignment, custom permissions. Access code = login credential.",
    entries: [
      { label: "Team List", type: "nav", detail: "Shows all team members grouped by role (CEO → CUSTOM). Each card: name, email, role badge, transaction count, active/inactive status. Search by name/email.", api: "GET /api/users?limit=50" },
      { label: "Add Member", type: "action", detail: "Form: name, email, role (dropdown), access code (used as password). CUSTOM role shows permission matrix: 27 features × 6 permissions (view/create/edit/delete/approve/fetch).", api: "POST /api/users", affects: "Creates new user with hashed password (bcrypt). Access code = initial password.", roles: "Admin only", important: true },
      { label: "Edit Member", type: "action", detail: "Same fields as Add. Plus: Active toggle (enable/disable login), custom role name. Non-admins see read-only view.", api: "PUT /api/users/{id}", affects: "Updates user details, role, permissions, active status", roles: "Admin only" },
      { label: "Remove Member", type: "action", detail: "Confirmation dialog. If user has transactions → soft-delete (deactivated). If no transactions → hard delete. Cannot delete yourself.", api: "DELETE /api/users/{id}", affects: "Deactivates or deletes user", roles: "Admin only" },
      { label: "Role Permissions Page", type: "action", detail: "Matrix editor for 8 roles × 27 features × 6 permissions. Toggle buttons with colored icons. Reset to defaults button. Saves to AlertConfig singleton.", api: "GET/PUT /api/role-permissions", affects: "Changes what all users of that role can do across the entire app", roles: "Admin only", important: true },
      { label: "Access Code Login", type: "rule", detail: "Users log in with their access code (not email). Access code is uppercase, must be unique. Stored as bcrypt hash in password field.", important: true },
      { label: "CEO = ADMIN", type: "rule", detail: "In auth-helpers.ts, CEO role is treated as ADMIN for all permission checks. CEO can access any ADMIN-restricted route.", important: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 9. SOPs (Standard Operating Procedures)
  // ═══════════════════════════════════════════════════════════
  {
    id: "sops",
    title: "SOPs & Compliance",
    icon: ClipboardCheck,
    color: "bg-teal-100 text-teal-700",
    description: "110 SOPs across 7 departments. 3 time slots. Check-off tracking, violations, leaderboard.",
    entries: [
      // ── Structure ──
      { label: "Time Slots", type: "rule", detail: "MORNING (9AM-12PM), AFTERNOON (12PM-5PM), EVENING (5PM-9PM). Each SOP can be assigned to one or more slots. Auto-detects current slot based on hour.", important: true },
      { label: "SOP Assignment", type: "rule", detail: "SOPs are assigned to ROLES (via roleAssignments table) and/or individual USERS (via assignees table). User sees SOPs for their role + individually assigned ones. Query: forMyRole=true.", important: true },
      { label: "CEO/ADMIN SOPs Missing", type: "rule", detail: "If CEO/ADMIN has no SOPs assigned to their role, My Check-offs page shows 'No SOPs for this time slot'. SOPs must be explicitly assigned to CEO role via SOP management.", important: true },

      // ── Pages ──
      { label: "SOP Management (/sops)", type: "nav", detail: "Two tabs: SOPs (list/create/edit) and Compliance (violations). SOPs grouped by category. Each shows: title, active toggle, frequency badge, assignee count. Expandable for description + actions.", api: "GET /api/sops" },
      { label: "My Check-offs (/sops/my-checkoffs)", type: "nav", detail: "Personal SOP checklist. Time slot tabs with progress bars. Click checkbox to mark done. Offline support: caches locally, queues actions, syncs when online.", api: "GET /api/sops?isActive=true&forMyRole=true + GET/POST /api/sops/compliance" },
      { label: "Staff Check-offs (/sops/staff-checkoffs)", type: "nav", detail: "Admin page. User picker dropdown to select any staff member. Manage their check-offs on their behalf. Useful for end-of-day reconciliation.", api: "POST /api/sops/compliance with {targetUserId}", roles: "CEO, ADMIN only" },
      { label: "SOP Dashboard (/sops/dashboard)", type: "nav", detail: "KPIs: team adherence %, weekly score, violations count, champion (longest streak). Leaderboard ranked by weekly score with star ratings (5 base - 0.5 per violation). WhatsApp share.", api: "GET /api/sops/dashboard" },

      // ── Actions ──
      { label: "Check Off Toggle", type: "action", detail: "POST /api/sops/compliance with {sopId, date, timeSlot}. Toggle logic: if check-off exists → DELETE it (uncheck). If not → CREATE it (check). Optimistic UI update.", api: "POST /api/sops/compliance", affects: "Creates/deletes SOPCheckOff record" },
      { label: "Log Violation", type: "action", detail: "Form: SOP (dropdown), staff name, notes. Creates violation record. Violations reduce star rating on dashboard (-0.5 per violation from 5 base).", api: "POST /api/sops/violations", affects: "Creates SOPViolation record. Affects leaderboard stars." },
      { label: "Seed SOPs", type: "action", detail: "Seeds all 110 default BCH SOPs across 7 departments (BDC, Sales, Service, Ops, Finance, Content, Billing). Admin only.", api: "POST /api/sops/seed-all", affects: "Creates ~110 SOP records with role assignments", roles: "Admin only" },

      // ── Compliance Rules ──
      { label: "Star Rating", type: "rule", detail: "5 stars base. -0.5 per violation. Formula: Math.max(0, 5 - violations * 0.5). Shown on leaderboard and WhatsApp report." },
      { label: "Streak", type: "rule", detail: "Consecutive days with 100% compliance. Emojis: 14+ days = Trophy, 7+ = Fire, 3+ = Lightning." },
      { label: "90-Day Cleanup", type: "rule", detail: "Check-off records older than 90 days are automatically deleted after each new check-off. Keeps database lean.", api: "Auto-triggered in POST /api/sops/compliance" },
      { label: "Offline Mode", type: "rule", detail: "My Check-offs works offline. Check-offs cached in localStorage/IndexedDB. Pending actions queued. Auto-sync when connection restored." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 10. VENDOR ISSUES (OPS ISSUES)
  // ═══════════════════════════════════════════════════════════
  {
    id: "vendor-issues",
    title: "Vendor Issues (Ops Issues)",
    icon: AlertCircle,
    color: "bg-red-100 text-red-700",
    description: "Track quality, shortage, damage issues from brands and clients. Photo evidence. Zoho client lookup.",
    entries: [
      { label: "Issue Sources", type: "rule", detail: "Two sources: BRAND (from vendor/supplier) and CLIENT (from customer). Displayed in separate sections when viewing ALL.", important: true },
      { label: "Issue Types", type: "rule", detail: "QUALITY (red), SHORTAGE (orange), DAMAGE (red), WRONG_ITEM (purple), BILLING_ERROR (blue), DELIVERY_DELAY (yellow), OTHER (slate)." },
      { label: "Priority Levels", type: "rule", detail: "LOW (gray), MEDIUM (blue), HIGH (orange), URGENT (red). Affects sort order and visual prominence." },
      { label: "Status Flow", type: "rule", detail: "OPEN → IN_PROGRESS → RESOLVED → CLOSED." },
      { label: "New Brand Issue", type: "action", detail: "Form: brand (vendor dropdown), related bill (optional), issue type, priority, description, photos (camera capture on mobile), suggested resolution.", api: "POST /api/vendor-issues", affects: "Creates VendorIssue record linked to vendor" },
      { label: "New Client Issue", type: "action", detail: "Form: client name (with Zoho search button), phone, issue type, priority, description, photos. Zoho search: GET /api/zoho/search-contacts?q={name} returns matching customers with phone/city.", api: "POST /api/vendor-issues + GET /api/zoho/search-contacts", affects: "Creates VendorIssue record with client details" },
      { label: "Overdue Calculation", type: "rule", detail: "Days since creation: Math.floor((now - createdAt) / 86400000). Shows as red text when > 0 days." },
      { label: "WhatsApp Share", type: "action", detail: "Shares all non-closed issues as WhatsApp message.", affects: "Opens WhatsApp" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 11. TRANSFERS
  // ═══════════════════════════════════════════════════════════
  {
    id: "transfers",
    title: "Transfers",
    icon: ArrowRightLeft,
    color: "bg-cyan-100 text-cyan-700",
    description: "Stock transfers between bins/locations. Track movement of inventory within the store.",
    entries: [
      { label: "Transfer Record", type: "rule", detail: "Each transfer has: transfer number, from-bin, to-bin, products with quantities, status, created by, date." },
      { label: "Transfer List", type: "nav", detail: "Shows all transfers. Filterable by date. Shows transfer number, status, product count.", api: "GET /api/transfers" },
      { label: "New Transfer", type: "action", detail: "Form: from bin, to bin, products (search + qty). Creates transfer and updates bin-level stock counts.", api: "POST /api/transfers", affects: "Moves stock between bins. Updates bin assignments." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 12. STOCK AUDIT
  // ═══════════════════════════════════════════════════════════
  {
    id: "stock-audit",
    title: "Stock Audit",
    icon: ClipboardCheck,
    color: "bg-amber-100 text-amber-700",
    description: "Physical stock count verification. Compare actual vs system quantities. Variance tracking.",
    entries: [
      { label: "Stock Count", type: "rule", detail: "Each audit has: products with system qty and counted qty. Variance = counted - system. Status: PENDING → COMPLETED." },
      { label: "Variance Classification", type: "rule", detail: "MATCH (variance = 0), SURPLUS (counted > system), SHORTAGE (counted < system). Each classified and highlighted." },
      { label: "New Audit", type: "action", detail: "Select products or bin. Enter actual counts. System calculates variance. Submit for review.", api: "POST /api/stock-counts", affects: "Creates audit record. Does NOT auto-adjust stock — requires admin review." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 13. SECOND-HAND CYCLES
  // ═══════════════════════════════════════════════════════════
  {
    id: "second-hand",
    title: "Second-Hand Cycles",
    icon: Bike,
    color: "bg-pink-100 text-pink-700",
    description: "Used cycle inventory. Buy-sell tracking with margin calculation.",
    entries: [
      { label: "Status", type: "rule", detail: "IN_STOCK or SOLD. Archive feature for old entries (admin only)." },
      { label: "Condition Grades", type: "rule", detail: "EXCELLENT (green), GOOD (blue), FAIR (yellow), SCRAP (red). Affects pricing and display." },
      { label: "Stats Card", type: "number", detail: "In Stock count (+ value for admin), Sold this month (+ revenue for admin), Avg Margin (admin only, for items > 30 days).", api: "GET /api/second-hand/stats" },
      { label: "Verification", type: "action", detail: "Admin/Supervisor can verify second-hand entries. Pending items show 'Pending' badge until verified.", roles: "Admin, Supervisor" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 14. ZOHO INTEGRATION
  // ═══════════════════════════════════════════════════════════
  {
    id: "zoho",
    title: "Zoho Integration",
    icon: Cloud,
    color: "bg-blue-100 text-blue-700",
    description: "Zoho Books sync layer. OAuth2 self-client. 4-step pull flow. API quota management.",
    entries: [
      { label: "4-Step Pull Flow", type: "rule", detail: "Step 1: POST trigger-pull step='init' → pullId. Step 2: POST trigger-pull step='{entity}' with pullId + fromDate → fetches from Zoho. Step 3: GET pull-review?pullId → preview new items. Step 4: POST pull-review/approve with selected IDs → imports.", important: true },
      { label: "Entity Types", type: "rule", detail: "invoices (→ deliveries), bills (→ bills), items (→ products), contacts (→ vendors/customers). Each entity type has its own import logic." },
      { label: "OAuth2 Self-Client", type: "rule", detail: "Uses Zoho self-client OAuth2 flow. Tokens stored in database (ZohoToken model). Auto-refresh on expiry. Settings page at /more/zoho shows connection status.", important: true },
      { label: "API Quota", type: "rule", detail: "Zoho has 1000 API calls/day for inventory. Each pull uses multiple calls. Monitor via Zoho sync page." },
      { label: "Zoho Client Search", type: "fetch", detail: "GET /api/zoho/search-contacts?q={query}. Searches Zoho Contacts by name (type=customer). Returns: id, name, phone, email, city. Used in vendor issues for client lookup.", api: "GET /api/zoho/search-contacts" },
      { label: "Clear Stuck Syncs", type: "action", detail: "POST /api/sync/clear. Resets any stuck sync/pull records that may block new syncs. Shows cleared count.", api: "POST /api/sync/clear", roles: "Admin only" },
      { label: "Cron: Zoho Auto-Pull", type: "rule", detail: "Scheduled cron job that auto-pulls latest data from Zoho. Runs via /api/cron/zoho-pull.", api: "GET /api/cron/zoho-pull" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 15. PERMISSIONS & AUTH
  // ═══════════════════════════════════════════════════════════
  {
    id: "permissions",
    title: "Permissions & Auth",
    icon: Settings,
    color: "bg-slate-100 text-slate-700",
    description: "Role-based access control. 11 roles × 27 features × 6 permission types.",
    entries: [
      { label: "11 Roles", type: "rule", detail: "CEO, ADMIN, SUPERVISOR, PURCHASE_MANAGER, ACCOUNTS_MANAGER, INWARDS_EXECUTIVE, OUTWARDS_EXECUTIVE, STORE_MANAGER, SALES_MANAGER, SERVICE_MANAGER, CUSTOM.", important: true },
      { label: "6 Permission Types", type: "rule", detail: "VIEW (see the page), CREATE (add new), EDIT (modify), DELETE (remove), APPROVE (approve workflows), FETCH (pull from Zoho). Each feature can have any combination.", important: true },
      { label: "27 Features", type: "rule", detail: "dashboard, inbound, deliveries, stock, stock_audit, transfers, vendors, bills, purchase_orders, expenses, reports, team, barcode, reorder, second_hand, zoho, whatsapp_templates, customers, vendor_issues, and more." },
      { label: "Permission Check Flow", type: "rule", detail: "Client: usePermissions(role) hook → fetches GET /api/my-permissions → caches result. Returns canView/canCreate/canEdit/canDelete/canApprove/canFetch functions. Server: requireAuth(roles?) in API routes.", important: true },
      { label: "Custom Role", type: "rule", detail: "CUSTOM role users have per-user permissions stored in user.permissions JSON field. Each permission individually toggled. Custom role name stored separately." },
      { label: "Default vs Saved Permissions", type: "rule", detail: "Defaults defined in code (DEFAULT_PERMISSIONS). Admin can override via /team/permissions page. Overrides saved in AlertConfig singleton. Merged at runtime: defaults + saved overrides." },
      { label: "Navigation Filtering", type: "rule", detail: "Bottom nav: 5 primary tabs per role (from nav-config.ts). More page: menu items filtered by role + featureKey permission check. Pages without permission show nothing or redirect." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 16. REPORTS & ANALYTICS
  // ═══════════════════════════════════════════════════════════
  {
    id: "reports",
    title: "Reports",
    icon: BarChart3,
    color: "bg-violet-100 text-violet-700",
    description: "6 report types. Stock value, movement analysis, purchase, expense, CD discount, daily activity.",
    entries: [
      { label: "Stock Value Report", type: "nav", detail: "Total inventory value by category and brand. Calculated as sum of (currentStock × costPrice) for all active products." },
      { label: "Movement Analysis", type: "nav", detail: "Identifies fast-moving, slow-moving, and dead stock. Based on transaction frequency over time periods." },
      { label: "Purchase Report", type: "nav", detail: "Vendor-wise purchase summary. Shows total purchased from each vendor over date range." },
      { label: "Expense Summary", type: "nav", detail: "Category-wise expense breakdown. Shows spending patterns over time." },
      { label: "CD Discount Summary", type: "nav", detail: "Cash discount earned, missed, and eligible. Helps track early payment savings." },
      { label: "Daily Activity Report", type: "nav", detail: "Today's inwards, outwards, payments, expenses. Comprehensive daily overview." },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 17. BARCODE & SCANNER
  // ═══════════════════════════════════════════════════════════
  {
    id: "barcode",
    title: "Barcode & Scanner",
    icon: QrCode,
    color: "bg-gray-100 text-gray-700",
    description: "Barcode scanning for quick product lookup. Label generation.",
    entries: [
      { label: "Barcode Scanner", type: "nav", detail: "Camera-based barcode scanner. Scans product barcode → looks up product by SKU/barcode field → shows product details with stock levels.", api: "GET /api/barcode/lookup?code={barcode}" },
      { label: "Label Designer", type: "nav", detail: "Generate printable barcode labels. Select products, configure label size, print batch.", api: "GET /api/barcode/generate" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 18. EXPENSES
  // ═══════════════════════════════════════════════════════════
  {
    id: "expenses",
    title: "Expenses",
    icon: Receipt,
    color: "bg-rose-100 text-rose-700",
    description: "Daily expense tracking by category. Receipt photo upload.",
    entries: [
      { label: "Expense Categories", type: "rule", detail: "Categories defined in system settings. Common: Fuel, Food, Stationery, Maintenance, Utilities, Miscellaneous." },
      { label: "New Expense", type: "action", detail: "Form: category, amount, description, date, receipt photo (optional). Creates expense record.", api: "POST /api/expenses", affects: "Creates Expense record. Appears in dashboard stats and reports." },
      { label: "Expense List", type: "nav", detail: "Shows all expenses. Filterable by category, date range. Searchable by description.", api: "GET /api/expenses" },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 19. ALERTS & NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════
  {
    id: "alerts",
    title: "Alerts & Config",
    icon: Bell,
    color: "bg-yellow-100 text-yellow-700",
    description: "Alert configuration for delivery flags, WhatsApp notifications, system alerts.",
    entries: [
      { label: "Alert Phones", type: "rule", detail: "Phone numbers that receive WhatsApp alerts when deliveries are flagged. Configured in /more/alerts. Stored in AlertConfig singleton." },
      { label: "WhatsApp Templates", type: "rule", detail: "Pre-configured message templates for various notifications. Managed at /more/whatsapp-templates." },
      { label: "Flag Alert Flow", type: "rule", detail: "When delivery flagged → POST /api/deliveries/{id}/flag → response includes alertPhones + whatsappMessage → auto-opens WhatsApp to first phone with message.", important: true },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // 20. NAVIGATION STRUCTURE
  // ═══════════════════════════════════════════════════════════
  {
    id: "navigation",
    title: "Navigation (Bottom Nav)",
    icon: Zap,
    color: "bg-slate-100 text-slate-700",
    description: "Role-based bottom navigation. 5 primary tabs per role.",
    entries: [
      { label: "CEO Tabs", type: "nav", detail: "Home, SOPs, Reports, Team, More" },
      { label: "ADMIN Tabs", type: "nav", detail: "Home, Inwards, Deliveries, Stock, More" },
      { label: "SUPERVISOR Tabs", type: "nav", detail: "Home, Inwards, Vendors, Stock, More" },
      { label: "PURCHASE_MANAGER Tabs", type: "nav", detail: "Home, Inwards, Stock, POs, More" },
      { label: "ACCOUNTS_MANAGER Tabs", type: "nav", detail: "Home, Ops Issues, Expenses, Stock, More" },
      { label: "INWARDS_EXECUTIVE Tabs", type: "nav", detail: "Home, Inwards, Transfers, Stock, More" },
      { label: "OUTWARDS_EXECUTIVE Tabs", type: "nav", detail: "Home, Inwards, Deliveries, Stock, More" },
      { label: "STORE_MANAGER Tabs", type: "nav", detail: "Home, Deliveries, Stock, SOPs, More" },
      { label: "SALES_MANAGER Tabs", type: "nav", detail: "Home, Deliveries, Stock, SOPs, More" },
      { label: "SERVICE_MANAGER Tabs", type: "nav", detail: "Home, Stock, SOPs, Issues, More" },
    ],
  },
];

// ── Type Colors ──
const TYPE_COLORS: Record<string, string> = {
  number: "bg-blue-100 text-blue-700",
  button: "bg-green-100 text-green-700",
  rule: "bg-amber-100 text-amber-700",
  fetch: "bg-red-100 text-red-700",
  api: "bg-purple-100 text-purple-700",
  nav: "bg-slate-100 text-slate-700",
  widget: "bg-teal-100 text-teal-700",
  action: "bg-orange-100 text-orange-700",
  filter: "bg-cyan-100 text-cyan-700",
};

const TYPE_LABELS: Record<string, string> = {
  number: "Stat/Number",
  button: "Button",
  rule: "Business Rule",
  fetch: "Zoho Fetch",
  api: "API Call",
  nav: "Navigation",
  widget: "Widget",
  action: "Action",
  filter: "Filter",
};

// ── Component ──

export default function AppLogicPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string })?.role;

  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // CEO only
  if (role && role !== "CEO" && role !== "ADMIN") {
    return (
      <div className="p-4 text-center text-slate-500">
        <p className="text-sm">This page is restricted to CEO/Admin only.</p>
      </div>
    );
  }

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleEntry = (key: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(LOGIC_SECTIONS.map(s => s.id)));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
    setExpandedEntries(new Set());
  };

  // Filter logic
  const searchLower = search.toLowerCase();
  const filteredSections = LOGIC_SECTIONS.map(section => {
    const filteredEntries = section.entries.filter(entry => {
      const matchesSearch = !search ||
        entry.label.toLowerCase().includes(searchLower) ||
        entry.detail.toLowerCase().includes(searchLower) ||
        (entry.api && entry.api.toLowerCase().includes(searchLower)) ||
        (entry.affects && entry.affects.toLowerCase().includes(searchLower)) ||
        (entry.roles && entry.roles.toLowerCase().includes(searchLower));
      const matchesType = typeFilter === "all" || entry.type === typeFilter;
      return matchesSearch && matchesType;
    });
    return { ...section, entries: filteredEntries };
  }).filter(s => s.entries.length > 0);

  const totalEntries = LOGIC_SECTIONS.reduce((sum, s) => sum + s.entries.length, 0);
  const fetchEntries = LOGIC_SECTIONS.reduce((sum, s) => sum + s.entries.filter(e => e.type === "fetch").length, 0);
  const ruleEntries = LOGIC_SECTIONS.reduce((sum, s) => sum + s.entries.filter(e => e.type === "rule").length, 0);
  const importantEntries = LOGIC_SECTIONS.reduce((sum, s) => sum + s.entries.filter(e => e.important).length, 0);

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">App Logic</h1>
          <p className="text-[11px] text-slate-500">Single Source of Truth — BCH Operating System</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-2 text-center">
          <p className="text-lg font-bold text-blue-700 tabular-nums">{totalEntries}</p>
          <p className="text-[11px] leading-tight text-blue-600 font-medium">Total Logic</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-2 text-center">
          <p className="text-lg font-bold text-red-700 tabular-nums">{fetchEntries}</p>
          <p className="text-[11px] leading-tight text-red-600 font-medium">Fetch Points</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-2 text-center">
          <p className="text-lg font-bold text-amber-700 tabular-nums">{ruleEntries}</p>
          <p className="text-[11px] leading-tight text-amber-600 font-medium">Business Rules</p>
        </div>
        <div className="rounded-xl border border-purple-100 bg-purple-50 p-2 text-center">
          <p className="text-lg font-bold text-purple-700 tabular-nums">{importantEntries}</p>
          <p className="text-[11px] leading-tight text-purple-600 font-medium">Critical</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search logic: fetch, delivery, zoho, rule..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 text-sm"
        />
      </div>

      {/* Type Filter Chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 no-scrollbar">
        <button
          onClick={() => setTypeFilter("all")}
          className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors focus-ring ${
            typeFilter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
          }`}
        >
          All
        </button>
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors focus-ring ${
              typeFilter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Expand/Collapse All */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={expandAll} className="text-[11px] text-blue-600 font-medium rounded focus-ring">Expand All</button>
        <span className="text-slate-300">|</span>
        <button onClick={collapseAll} className="text-[11px] text-blue-600 font-medium rounded focus-ring">Collapse All</button>
        <span className="text-[11px] text-slate-500 ml-auto">
          <span className="tabular-nums">{filteredSections.reduce((s, sec) => s + sec.entries.length, 0)}</span> entries shown
        </span>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {filteredSections.map(section => {
          const Icon = section.icon;
          const isExpanded = expandedSections.has(section.id);

          return (
            <Card key={section.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full min-h-[44px] flex items-center gap-2.5 p-3 text-left hover:bg-slate-50 transition-colors focus-ring"
              >
                <div className={`h-8 w-8 rounded-lg ${section.color} flex items-center justify-center shrink-0`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{section.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">{section.description}</p>
                </div>
                <Badge variant="default" className="text-[11px] tabular-nums shrink-0">{section.entries.length}</Badge>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
              </button>

              {/* Section Content */}
              {isExpanded && (
                <div className="border-t divide-y">
                  {section.entries.map((entry, idx) => {
                    const entryKey = `${section.id}-${idx}`;
                    const isEntryExpanded = expandedEntries.has(entryKey);

                    return (
                      <div key={entryKey} className={`${entry.important ? "bg-amber-50/60 border-l-2 border-amber-400" : ""}`}>
                        <button
                          onClick={() => toggleEntry(entryKey)}
                          className="w-full min-h-[44px] flex items-start gap-2 p-2.5 text-left hover:bg-slate-50/50 transition-colors focus-ring"
                        >
                          {entry.important && <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" aria-label="Critical" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={`${TYPE_COLORS[entry.type]} text-[11px] px-1.5 py-0 font-semibold border-0`}>
                                {TYPE_LABELS[entry.type]}
                              </Badge>
                              <span className="text-xs font-semibold text-slate-700">{entry.label}</span>
                            </div>
                            {!isEntryExpanded && (
                              <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{entry.detail}</p>
                            )}
                          </div>
                          {isEntryExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-300 shrink-0 mt-0.5" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0 mt-0.5" />}
                        </button>

                        {isEntryExpanded && (
                          <div className="px-3 pb-3 space-y-1.5">
                            <p className="text-[11px] text-slate-600 leading-relaxed">{entry.detail}</p>
                            {entry.api && (
                              <div className="flex items-start gap-1">
                                <span className="text-[11px] font-bold text-purple-600 shrink-0 mt-px">API:</span>
                                <code className="text-[11px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded break-all">{entry.api}</code>
                              </div>
                            )}
                            {entry.affects && (
                              <div className="flex items-start gap-1">
                                <span className="text-[11px] font-bold text-orange-600 shrink-0 mt-px">AFFECTS:</span>
                                <span className="text-[11px] text-orange-700">{entry.affects}</span>
                              </div>
                            )}
                            {entry.roles && (
                              <div className="flex items-start gap-1">
                                <span className="text-[11px] font-bold text-teal-600 shrink-0 mt-px">ROLES:</span>
                                <span className="text-[11px] text-teal-700">{entry.roles}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {filteredSections.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No logic entries match your search.</p>
        </div>
      )}
    </div>
  );
}
