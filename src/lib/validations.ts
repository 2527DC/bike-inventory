import { z } from "zod";
import {
  lmsBuyerPsychologySchema,
  lmsChecklistDoneSchema,
  lmsChecklistItemSchema,
  lmsCompetitorSchema,
  lmsFaqSchema,
  lmsObjectionSchema,
  lmsOptionsSchema,
  lmsReviewsSchema,
  lmsSourceSchema,
  lmsSpecsSchema,
  lmsAnswersSchema,
} from "@/lib/staff-lms/content-schemas";
import {
  LMS_ACHIEVEMENT_CRITERIA,
  LMS_DIFFICULTIES,
  LMS_QUIZ_TYPES,
  LMS_SCENARIO_TYPES,
} from "@/lib/staff-lms/constants";

/**
 * A product type row. Deliberately three fields — see the model comment in schema.prisma.
 * No delete action exists, so nothing here describes one.
 */
export const productTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(40).trim(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const productSchema = z.object({
  sku: z.string().min(1, "SKU is required").max(50),
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  categoryId: z.string().min(1, "Category is required"),
  brandId: z.string().min(1, "Brand is required"),
  // Was a z.enum of six fixed values. Product types are a table now, so the only thing this
  // can check is "a non-empty id was sent" — the route confirms the row exists, because zod
  // cannot ask the database.
  productTypeId: z.string().min(1, "Product type is required"),
  status: z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).optional(),
  condition: z
    .enum([
      "NEW",
      "REFURBISHED_EXCELLENT",
      "REFURBISHED_GOOD",
      "REFURBISHED_FAIR",
      "DAMAGED",
    ])
    .optional(),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  mrp: z.number().min(0).optional(),
  gstRate: z.number().min(0).max(100).optional(),
  hsnCode: z.string().optional(),
  minStock: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  reorderQty: z.number().int().min(0).optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  imageUrls: z.array(z.string().url()).optional(),
  tags: z.array(z.string()).optional(),
  binId: z.string().optional(),
});

export const productUpdateSchema = productSchema.partial();

export const inwardSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export const outwardSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().optional(),
  parentId: z.string().optional(),
  movingLevel: z.enum(["FAST", "NORMAL", "SLOW"]).optional(),
  reorderLevel: z.number().int().min(0).optional(),
});

/**
 * PATCH sends only what changed, so every field is optional — but `.partial()` alone would
 * accept `{}` and turn an empty body into a no-op 200. The refine makes that a 400.
 *
 * `parentId` accepts null explicitly: detaching a child from its parent is a real edit, and
 * `undefined` (absent) has to keep meaning "leave it alone".
 */
export const categoryUpdateSchema = categorySchema
  .partial()
  .extend({ parentId: z.string().nullable().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

export const brandSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  whatsappNumber: z.string().optional(),
  cdTermsDays: z.number().int().min(0).optional(),
  cdPercentage: z.number().min(0).max(100).optional(),
});

export const binSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  location: z.string().min(1, "Location is required"),
  zone: z.string().optional(),
  capacity: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const stockCountSchema = z.object({
  title: z.string().min(1, "Title is required"),
  assignedToId: z.string().optional(),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().optional(),
  productIds: z.array(z.string()).optional(),
  // The NAME of a ProductType, not an enum — types are rows an admin can add at runtime, so
  // no fixed list here can stay correct. Stored on StockCount.productType (a String) as a
  // record of what the count was scoped to.
  productType: z.string().max(40).optional(),
});

export const stockCountUpdateSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "APPROVED", "REJECTED"]).optional(),
  notes: z.string().optional(),
  rejectionReason: z.string().optional(),
  // Admin-only: when approving, also overwrite stock with the counted quantities.
  // Default (absent/false) = verify-only — records the count/variance without changing stock.
  applyToStock: z.boolean().optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        countedQty: z.number().int().min(0),
        suggestedBrand: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .optional(),
});

// Roles are rows now, not an enum — the client sends the role's id and the API verifies it
// exists. Permissions are never accepted on a user; they belong to the role.
export const userSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  roleId: z.string().min(1, "Role is required"),
  accessCode: z.string().min(1, "Access code is required"),
  isActive: z.boolean().optional(),
  // Where this person works. Both optional, and `null` is meaningful — it is how the client
  // clears an assignment, which `undefined` cannot express (undefined means "leave alone").
  //
  // These are NOT permissions. Assigning someone to BCH does not restrict what they can see;
  // a BCH user still sees BCC stock. Storing and displaying the assignment is the whole
  // scope — see the plan's Phase 3, "Not in scope".
  storeId: z.string().min(1).nullable().optional(),
  warehouseId: z.string().min(1).nullable().optional(),
});

export const userUpdateSchema = userSchema.partial().extend({
  accessCode: z.string().min(1).optional(),
});

// ─── Brand ledger ────────────────────────────────────────────────────────────

export const ledgerEntrySchema = z.object({
  entryDate: z.string().min(1, "Date is required"),
  type: z.enum([
    "OPENING", "INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "DISCOUNT", "ADJUSTMENT",
  ]),
  ref: z.string().max(80).optional(),
  amount: z.number().positive("Amount must be greater than zero"),
  // Omitted means "derive from the type". Sent explicitly for the rare case of a credit
  // posted on a sales voucher, where the label and the sign disagree.
  direction: z.union([z.literal(1), z.literal(-1)]).optional(),
  note: z.string().max(500).optional(),
  brandId: z.string().optional(),
  // MANUAL is the escape hatch for a real payment not yet recorded in Accounts.
  source: z.enum(["STATEMENT_PDF", "STATEMENT_XLSX", "STATEMENT_CSV", "BCH_BOOKS", "MANUAL"]).optional(),
});

export const ledgerEntryReviewSchema = z.object({
  matchStatus: z.enum([
    "UNMATCHED", "MATCHED", "NEEDS_REVIEW", "THEY_MISSING", "WE_MISSING", "DISPUTED", "IGNORED",
  ]),
  reviewNote: z.string().max(500).optional(),
  billId: z.string().nullable().optional(),
  paymentId: z.string().nullable().optional(),
  creditId: z.string().nullable().optional(),
  gapId: z.string().nullable().optional(),
});

export const ledgerGapSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  gapType: z.enum([
    "DISCOUNT_PENDING", "CREDIT_NOTE_PENDING", "SHORT_CREDIT", "DISPUTE",
    "RECONCILIATION_DIFFERENCE", "DOCUMENTATION_GAP", "BALANCE_UNCONFIRMED",
    "SCHEME_ENTITLEMENT", "COMMITMENT_PENDING", "OPERATIONAL_WARRANTY",
    "INVOICE_DISCREPANCY", "REIMBURSEMENT_PENDING",
  ]),
  tier: z.enum(["FIRM", "LEVERAGE", "VERIFY", "CONDITIONAL"]).nullable().optional(),
  status: z.enum(["OPEN", "PROMISED", "VERIFY", "RESOLVED", "REJECTED"]).optional(),
  amount: z.number().nullable().optional(),
  amountNote: z.string().max(200).optional(),
  promisedBy: z.string().max(120).optional(),
  promisedOn: z.string().optional(),
  evidenceText: z.string().max(2000).optional(),
  action: z.string().max(1000).optional(),
  result: z.string().max(2000).optional(),
  brandId: z.string().optional(),
});

export const ledgerGapUpdateSchema = ledgerGapSchema.partial();

export const discountTermSchema = z.object({
  kind: z.enum(["CASH", "TRADE", "VOLUME", "TRANSPORT_SUPPORT", "MARKETING", "INCENTIVE", "OTHER"]),
  percentage: z.number().min(0).max(100).nullable().optional(),
  perUnitAmount: z.number().min(0).nullable().optional(),
  appliesTo: z.string().max(200).optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  withinDays: z.number().int().min(0).nullable().optional(),
  agreedBy: z.string().max(120).optional(),
  agreedOn: z.string().optional(),
  isProven: z.boolean().optional(),
  evidenceUrl: z.string().url().optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
  brandId: z.string().optional(),
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

export const roleCreateSchema = z.object({
  key: z
    .string()
    .min(2, "Key is required")
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_ -]*$/, "Key must start with a letter"),
  name: z.string().min(1, "Name is required").max(60),
  description: z.string().max(300).optional(),
  permissionIds: z.array(z.string()).optional(),
});

export const roleUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  // The complete desired grant set. Omit to leave grants untouched.
  permissionIds: z.array(z.string()).optional(),
});

export const vendorSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  code: z.string().min(1, "Code is required").max(20),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().or(z.literal("")),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).optional().or(z.literal("")),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  whatsappNumber: z.string().optional(),
  waGroupName: z.string().optional(),
  waGroupCode: z.string().optional(),
  paymentTermDays: z.number().int().min(0).optional(),
  creditLimit: z.number().min(0).optional(),
  cdTermsDays: z.number().int().min(0).optional(),
  cdPercentage: z.number().min(0).max(100).optional(),
  openingBalance: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

export const vendorUpdateSchema = vendorSchema.partial();

export const vendorContactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  designation: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  whatsapp: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

export const purchaseOrderSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  expectedDate: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1, "Product is required"),
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
    unitPrice: z.number().min(0, "Price must be positive"),
    gstRate: z.number().min(0).max(100).optional(),
  })).min(1, "At least one item is required"),
});

export const vendorBillSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  purchaseOrderId: z.string().optional(),
  billNo: z.string().min(1, "Bill number is required"),
  billDate: z.string().min(1, "Bill date is required"),
  dueDate: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be positive"),
  notes: z.string().optional(),
});

export const vendorPaymentSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  billId: z.string().optional(),
  billAllocations: z.array(z.object({
    billId: z.string(),
    amount: z.number().min(0.01),
  })).optional(),
  amount: z.number().min(0.01, "Amount must be positive"),
  cdDiscountAmount: z.number().min(0).optional(),
  paymentMode: z.enum(["CASH", "CHEQUE", "NEFT", "RTGS", "UPI", "CREDIT_ADJUSTMENT"]),
  paymentDate: z.string().min(1, "Payment date is required"),
  referenceNo: z.string().optional(),
  creditId: z.string().optional(),
  notes: z.string().optional(),
});

export const vendorCreditSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  creditNoteNo: z.string().min(1, "Credit note number is required"),
  amount: z.number().min(0.01, "Amount must be positive"),
  reason: z.string().optional(),
  creditDate: z.string().min(1, "Credit date is required"),
  notes: z.string().optional(),
});

export const expenseSchema = z.object({
  date: z.string().min(1, "Date is required"),
  amount: z.number().min(0.01, "Amount must be positive"),
  category: z.enum(["DELIVERY", "TRANSPORT", "SHOP_MAINTENANCE", "UTILITIES", "SALARY_ADVANCE", "FOOD_TEA", "STATIONERY", "MISCELLANEOUS"]),
  description: z.string().min(1, "Description is required"),
  paidBy: z.string().min(1, "Paid by is required"),
  paymentMode: z.enum(["CASH", "CHEQUE", "NEFT", "RTGS", "UPI", "CREDIT_ADJUSTMENT"]),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export const billFollowUpSchema = z.object({
  nextFollowUpDate: z.string().optional(),
  followUpNotes: z.string().optional(),
});

// ---- Customers & Receivables ----

// `phone` is the customer's identity: it is required and unique on the table, because the
// service side looks a customer up by phone when a bike is dropped off. Ten digits, since
// that is what the counter actually captures.
export const customerSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, "").slice(-10))
    .refine((v) => v.length === 10, "Phone must be 10 digits"),
  whatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  type: z.enum(["WALK_IN", "REGULAR", "DEALER"]).optional(),
});

export const customerUpdateSchema = customerSchema.partial();

export const customerInvoiceSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  invoiceNo: z.string().min(1, "Invoice number is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  dueDate: z.string().min(1, "Due date is required"),
  amount: z.number().min(0.01, "Amount must be positive"),
  notes: z.string().optional(),
});

export const customerPaymentSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  invoiceId: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be positive"),
  paymentMode: z.enum(["CASH", "CHEQUE", "NEFT", "RTGS", "UPI", "CREDIT_ADJUSTMENT"]),
  paymentDate: z.string().min(1, "Payment date is required"),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

// ---- Ops Issues (Vendor + Client) ----

export const vendorIssueSchema = z.object({
  issueSource: z.enum(["VENDOR", "CLIENT"]).optional(),
  vendorId: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  issueType: z.enum(["QUALITY", "SHORTAGE", "DAMAGE", "WRONG_ITEM", "BILLING_ERROR", "DELIVERY_DELAY", "OTHER"]),
  description: z.string().min(1, "Description is required"),
  ticketNo: z.string().optional(),
  serviceLocation: z.enum(["IN_STORE", "CUSTOMER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  billId: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
  docLink: z.string().optional(),
  suggestedResolution: z.string().optional(),
});

export const vendorIssueUpdateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  resolution: z.string().optional(),
  docLink: z.string().optional(),
  ticketNo: z.string().optional(),
  serviceLocation: z.enum(["IN_STORE", "CUSTOMER"]).optional(),
  vendorId: z.string().optional(), // admin-only: reassign an issue to the correct brand
});

export const vendorIssueNoteSchema = z.object({
  text: z.string().min(1, "Note text is required"),
});

// ---- Deliveries ----

export const deliveryCreateSchema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  customerPhone: z.string().optional(),
  invoiceNo: z.string().min(1, "Invoice number is required"),
  invoiceAmount: z.number().min(0).optional(),
  expectedReadyDate: z.string().optional(),
  prebookNotes: z.string().optional(),
  lineItems: z.array(z.object({
    name: z.string(),
    quantity: z.number().int().min(1),
    rate: z.number().min(0).optional(),
  })).optional(),
});

export const deliveryUpdateSchema = z.object({
  status: z.enum(["PENDING", "VERIFIED", "WALK_OUT", "SCHEDULED", "OUT_FOR_DELIVERY", "DELIVERED", "FLAGGED", "PREBOOKED", "PACKED", "SHIPPED", "IN_TRANSIT"]).optional(),
  customerAddress: z.string().optional(),
  customerArea: z.string().optional(),
  customerPincode: z.string().regex(/^\d{6}$/, "Must be 6 digits").optional().or(z.literal("")),
  customerPhone: z.string().optional(),
  alternatePhone: z.string().optional(),
  scheduledDate: z.string().optional(),
  deliveryNotes: z.string().optional(),
  notes: z.string().optional(),
  flagReason: z.string().optional(),
  rejectionReason: z.string().optional(),
  isOutstation: z.boolean().optional(),
  courierName: z.string().optional(),
  courierTrackingNo: z.string().optional(),
  courierTrackingLink: z.string().optional(),
  courierCost: z.number().optional(),
  vehicleNo: z.string().optional(),
  invoiceType: z.enum(["SALES", "SERVICE", "CENTRE"]).nullable().optional(),
  freeAccessories: z.string().optional(),
  reversePickup: z.boolean().optional(),
  whatsAppScheduledSent: z.boolean().optional(),
  whatsAppDispatchedSent: z.boolean().optional(),
  whatsAppDeliveredSent: z.boolean().optional(),
  mapsLink: z.string().optional(),
});

// ─── Inbound Tracking ───────────────────────

export const inboundShipmentSchema = z.object({
  brandId: z.string().min(1, "Brand is required"),
  billNo: z.string().min(1, "Bill number is required"),
  billImageUrl: z.string().optional(),
  billPdfUrl: z.string().optional(),
  billDate: z.string().min(1, "Bill date is required"),
  notes: z.string().optional(),
  lineItems: z.array(z.object({
    productName: z.string().min(1, "Product name is required"),
    productId: z.string().optional(),
    sku: z.string().optional(),
    quantity: z.number().int().min(1),
    rate: z.number().min(0),
    gstPercent: z.number().min(0).max(100).optional(),
    gstAmount: z.number().min(0).optional(),
    amount: z.number().min(0),
    hsn: z.string().optional(),
  })).min(1, "At least one line item is required"),
});

export const preBookingSchema = z.object({
  customerName: z.string().min(1, "Customer name is required"),
  customerPhone: z.string().optional(),
  zohoInvoiceNo: z.string().min(1, "Zoho invoice number is required"),
  productName: z.string().min(1, "Product name is required"),
  salesPerson: z.string().optional(),
  brandId: z.string().optional(),
});

// A StoreUpdate POST — the ops-hub noticeboard — not an update TO a store. Renamed from
// `storeUpdateSchema` on 30 Aug 2026: every other schema here uses *UpdateSchema for a PATCH
// body (productUpdateSchema, userUpdateSchema), so the old name collided with the real one
// when Store became a table.
export const storeUpdatePostSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000),
  category: z.enum(["Sales", "Staff", "Ops", "Issue", "Win", "Other"]),
});

// ─── Store analytics ingest ──────────────────────────────────────────────────
// These validate the ENVELOPE only. Per-event field validation deliberately stays in
// src/lib/analytics/store.ts, because DAT-002 requires every bad event to be reported
// individually with a reason — a zod schema over the item shape would reject the whole batch,
// throwing away 199 good crossings because the 200th carried a bad timestamp. The agent
// cannot repair a rejected event, so a batch-level 400 would just loop forever.

export const countEventBatchSchema = z
  .array(z.unknown())
  .max(1000, "batch too large (max 1000)");

// Unknown keys are stripped rather than rejected: the agent adds fields as it gains features
// (`confidence` was added mid-pilot) and an older server must not start 400-ing a newer agent.
export const heartbeatSchema = z.object({
  agent_id: z.string().max(64).optional(),
  queue_depth: z.number().int().min(0).nullable().optional(),
  camera_ok: z.boolean().nullable().optional(),
  last_frame_ts: z.number().nullable().optional(),
  agent_version: z.string().max(32).nullable().optional(),
});

// Device registration.
//
// `storeId` used to be z.enum(["BCH_STORE", "BCC_STORE"]) — the two StockLocation members
// that had a doorway to count through. That restriction is now expressed by the SCHEMA
// itself: a camera is registered against a `Store`, and every Store is a shop with a door,
// so there is no longer a set of location values to exclude. Warehouses cannot be named here
// because they are a different table.
//
// The value must still be a real, active store, and that check is server-side rather than a
// filtered <select> — see the route, which resolves it before writing.
export const analyticsDeviceCreateSchema = z.object({
  label: z.string().min(1, "Label is required").max(80),
  storeId: z.string().min(1, "A store is required"),
  agentId: z.string().min(1).max(64).default("edge-1"),
});

export const analyticsDeviceUpdateSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.label !== undefined || v.isActive !== undefined, {
    message: "nothing to update",
  });

// ─── Staff LMS ───────────────────────────────────────────────────────────────
// Request-body schemas for /api/staff-lms/*. The SHAPES of the Json columns these write
// into live in src/lib/staff-lms/content-schemas.ts and are imported rather than restated,
// so a change to a playbook's shape cannot drift between the writer and the reader.
//
// Naming: every export is `lms*`. A bare `productSchema` already exists at the top of this
// file and means an inventory SKU — a different table, a different concept, and one of the
// collisions the `Lms` prefix exists to prevent.


const cuid = z.string().min(1);

// ── Content: products ───────────────────────────────────────────────────────

export const lmsProductSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  brand: z.string().min(1, "Brand is required").max(100),
  // Free text, not an enum. LMS_RIDING_STYLES is what the dropdown OFFERS; constraining it
  // here would mean a redeploy to add a category, which is the wrong cost for a label.
  category: z.string().min(1, "Category is required").max(60),
  price: z.number().nonnegative().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  usps: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  talkingPoints: z.array(z.string()).default([]),
  targetCustomer: z.string().nullable().optional(),
  commonObjections: z.array(lmsObjectionSchema).default([]),
  buyerPsychology: lmsBuyerPsychologySchema.nullable().optional(),
  uniqueFact: z.string().nullable().optional(),
  specs: lmsSpecsSchema.default({}),
  competitors: z.array(lmsCompetitorSchema).default([]),
  reviews: lmsReviewsSchema.default({ best: [], worst: [] }),
  sources: z.array(lmsSourceSchema).default([]),
  faqs: z.array(lmsFaqSchema).default([]),
  isActive: z.boolean().optional(),
  /** Optional soft link to an inventory SKU. See LmsProduct.stockProductId. */
  stockProductId: cuid.nullable().optional(),
});

export const lmsProductUpdateSchema = lmsProductSchema.partial();

// ── Content: playbooks (scenarios) ──────────────────────────────────────────

export const lmsScenarioSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(LMS_SCENARIO_TYPES),
  description: z.string().nullable().optional(),
  checklist: z.array(lmsChecklistItemSchema).default([]),
  tips: z.array(z.string()).default([]),
  difficulty: z.enum(LMS_DIFFICULTIES).default("beginner"),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

export const lmsScenarioUpdateSchema = lmsScenarioSchema.partial();

// ── Content: videos ─────────────────────────────────────────────────────────

export const lmsVideoCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const lmsVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  youtubeUrl: z.string().url("A valid YouTube URL is required"),
  categoryId: cuid.nullable().optional(),
  /** The LEARNING product this belongs to (lms_products), never a stock SKU. */
  lmsProductId: cuid.nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

export const lmsVideoUpdateSchema = lmsVideoSchema.partial();

// ── Content: course tree ────────────────────────────────────────────────────

export const lmsCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const lmsCourseLevelSchema = z.object({
  courseId: cuid,
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  weekNumber: z.number().int().positive().nullable().optional(),
  brandFocus: z.string().nullable().optional(),
});

export const lmsLessonSchema = z.object({
  levelId: cuid,
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  youtubeUrl: z.string().url().nullable().optional(),
  keyPointers: z.array(z.string()).default([]),
  checklist: z.array(lmsChecklistItemSchema).default([]),
  xpReward: z.number().int().min(0).default(30),
  isActive: z.boolean().optional(),
});

export const lmsCourseUpdateSchema = lmsCourseSchema.partial();
export const lmsCourseLevelUpdateSchema = lmsCourseLevelSchema.partial();
export const lmsLessonUpdateSchema = lmsLessonSchema.partial();

// ── Content: questions ──────────────────────────────────────────────────────

/**
 * Shared by lesson, quiz and weekly-test questions — the three tables have identical
 * question shapes and differ only in their parent FK, which the ROUTE supplies from the
 * URL rather than the body.
 *
 * `correctIndex` is validated against the option count with a refine, because an
 * out-of-range key is a question nobody can ever answer correctly, and it would only
 * surface as a learner complaint weeks later.
 */
export const lmsQuestionSchema = z
  .object({
    question: z.string().min(1).max(1000),
    options: lmsOptionsSchema.min(2, "A question needs at least two options"),
    correctIndex: z.number().int().min(0),
    explanation: z.string().nullable().optional(),
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine((q) => q.correctIndex < q.options.length, {
    message: "correctIndex points past the last option",
    path: ["correctIndex"],
  });

// ── Content: quizzes and weekly tests ───────────────────────────────────────

export const lmsQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  type: z.enum(LMS_QUIZ_TYPES).default("general"),
  difficulty: z.enum(LMS_DIFFICULTIES).default("beginner"),
  passingScore: z.number().int().min(0).max(100).default(70),
  xpReward: z.number().int().min(0).default(50),
  isActive: z.boolean().optional(),
});

export const lmsWeeklyTestSchema = z.object({
  title: z.string().min(1).max(200),
  weekNumber: z.number().int().positive(),
  description: z.string().nullable().optional(),
  passingScore: z.number().int().min(0).max(100).default(70),
  xpReward: z.number().int().min(0).default(100),
  scheduledFor: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const lmsQuizUpdateSchema = lmsQuizSchema.partial();
export const lmsWeeklyTestUpdateSchema = lmsWeeklyTestSchema.partial();

// ── Content: announcements, tips, achievements ──────────────────────────────

export const lmsAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  expiresAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const lmsDailyTipSchema = z.object({
  content: z.string().min(1),
  category: z.string().max(60).default("general"),
  scheduledFor: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const lmsAchievementSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1),
  icon: z.string().min(1).max(60),
  // An enum, not free text: an unrecognised criteria type produces a badge nobody can ever
  // earn, and checkAchievements can only warn about it after the fact.
  criteriaType: z.enum(LMS_ACHIEVEMENT_CRITERIA),
  criteriaValue: z.number().int().positive(),
  xpReward: z.number().int().min(0).default(100),
});

export const lmsAnnouncementUpdateSchema = lmsAnnouncementSchema.partial();
export const lmsDailyTipUpdateSchema = lmsDailyTipSchema.partial();
export const lmsAchievementUpdateSchema = lmsAchievementSchema.partial();

// ── Learner writes — THE SELF-PROGRESS CONTRACT ─────────────────────────────
//
// Read this before adding anything below it.
//
// These five schemas back the endpoints where a learner writes their OWN rows. Every one
// is `.strict()`, and NONE of them declares `userId`.
//
// That is the single highest-severity rule in the module. The userId is taken from
// `requireFeature(...)` — the session — and never from the request body. Zod 4 STRIPS
// unknown keys silently by default, so a client sending `{"userId": "<someone else>"}`
// would be quietly ignored: correct behaviour, but invisible. `.strict()` turns that
// silence into a 400, which is the difference between a client bug you find in a week and
// one you never find at all.
//
// A route that needs a target id — which lesson, which quiz — takes it from the URL, not
// the body. If you find yourself wanting to add `userId` here, the answer is no.

export const lmsQuizAttemptSchema = z
  .object({
    answers: lmsAnswersSchema,
  })
  .strict();

export const lmsWeeklyTestAttemptSchema = z
  .object({
    answers: lmsAnswersSchema,
  })
  .strict();

export const lmsLessonProgressSchema = z
  .object({
    videoWatched: z.boolean().optional(),
    checklistDone: lmsChecklistDoneSchema.optional(),
    answers: lmsAnswersSchema.optional(),
  })
  .strict();

/**
 * Marks a video watched or a playbook completed. One id at a time, from the body rather
 * than the URL because this endpoint is not per-resource.
 */
export const lmsProgressSchema = z
  .object({
    videoId: cuid.optional(),
    scenarioId: cuid.optional(),
    productId: cuid.optional(),
  })
  .strict()
  .refine((v) => !!(v.videoId || v.scenarioId || v.productId), {
    message: "one of videoId, scenarioId or productId is required",
  });

/** The daily streak ping. Takes no input at all — the session is the whole request. */
export const lmsHeartbeatSchema = z.object({}).strict();

// ─── Store hierarchy ─────────────────────────────────────────────────────────

// `code` is the stable handle: it reuses the old StockLocation enum strings and is what
// /stock/by-location/[code] resolves against, so it is uppercase, alphanumeric + underscore,
// and never contains a space. `name` is free display text and can be renamed at will.
const SITE_CODE = z
  .string()
  .min(2, "Code is required")
  .max(40)
  .regex(/^[A-Za-z0-9_]+$/, "Code may use letters, numbers and underscores only");

export const storeSchema = z.object({
  code: SITE_CODE,
  name: z.string().min(1, "Name is required").max(100),
  address: z.string().max(300).optional(),
  phone: z.string().max(30).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const storeUpdateSchema = storeSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const warehouseSchema = z.object({
  storeId: z.string().min(1, "A store is required"),
  code: SITE_CODE,
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.number().int().min(0).optional(),
});

export const warehouseUpdateSchema = warehouseSchema.partial().extend({
  isActive: z.boolean().optional(),
});
