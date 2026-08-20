import { z } from "zod";

export const productSchema = z.object({
  sku: z.string().min(1, "SKU is required").max(50),
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().optional(),
  categoryId: z.string().min(1, "Category is required"),
  brandId: z.string().min(1, "Brand is required"),
  type: z.enum([
    "BICYCLE",
    "SPARE_PART",
    "ACCESSORY",
    "BOX_PIECE",
    "WIP",
    "FINISHED_GOOD",
  ]),
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
  productType: z.enum(["BICYCLE", "SPARE_PART", "ACCESSORY"]).optional(),
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
});

export const userUpdateSchema = userSchema.partial().extend({
  accessCode: z.string().min(1).optional(),
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

export const storeUpdateSchema = z.object({
  text: z.string().min(1, "Text is required").max(2000),
  category: z.enum(["Sales", "Staff", "Ops", "Issue", "Win", "Other"]),
});
