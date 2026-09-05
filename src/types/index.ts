// Roles are rows in the `roles` table, not a fixed union — an admin can create new ones at
// runtime, so no closed list of names can be correct. `roleKey` is a plain string used for
// display and logging only; authorisation always resolves grants from the database
// (src/lib/rbac.ts), never by comparing a role name.
export interface UserRole {
  id: string;
  key: string;
  name: string;
}

export type TransactionType = "INWARD" | "OUTWARD" | "TRANSFER" | "ADJUSTMENT";

export type ProductStatus = "ACTIVE" | "INACTIVE" | "DISCONTINUED";

export type ProductCondition =
  | "NEW"
  | "REFURBISHED_EXCELLENT"
  | "REFURBISHED_GOOD"
  | "REFURBISHED_FAIR"
  | "DAMAGED";

export type SerialStatus =
  | "IN_STOCK"
  | "SOLD"
  | "RETURNED"
  | "DAMAGED"
  | "TRANSFERRED"
  | "RGP_OUT";

export type BarcodeFormat = "CODE128" | "QR" | "EAN13";

export interface User {
  id: string;
  name: string;
  email: string;
  roleId: string;
  role?: UserRole;
  accessCode: string;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  reorderLevel: number;
}

export interface Brand {
  id: string;
  name: string;
  contactName?: string;
  contactPhone?: string;
  whatsappNumber?: string;
  cdTermsDays?: number;
  cdPercentage?: number;
}

export interface Bin {
  id: string;
  code: string;
  name: string;
  location: string;
  zone?: string;
  capacity?: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  categoryId: string;
  category?: Category;
  brandId: string;
  brand?: Brand;
  status: ProductStatus;
  condition: ProductCondition;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  gstRate: number;
  hsnCode?: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  reorderLevel: number;
  reorderQty: number;
  size?: string;
  color?: string;
  imageUrls: string[];
  tags: string[];
  binId?: string;
  bin?: Bin;
  createdAt: string;
  updatedAt: string;
}

export interface SerialItem {
  id: string;
  serialCode: string;
  productId: string;
  product?: Product;
  status: SerialStatus;
  condition: ProductCondition;
  binId?: string;
  bin?: Bin;
  batchNo?: string;
  invoiceNo?: string;
  receivedAt: string;
  soldAt?: string;
  customerName?: string;
  saleInvoiceNo?: string;
  barcodeData?: string;
  barcodeFormat: BarcodeFormat;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  type: TransactionType;
  productId: string;
  product?: Product;
  quantity: number;
  previousStock: number;
  newStock: number;
  referenceNo?: string;
  notes?: string;
  userId: string;
  user?: User;
  createdAt: string;
}

export interface StockCount {
  id: string;
  title: string;
  assignedToId: string;
  assignedTo?: User;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  dueDate: string;
  completedAt?: string;
  notes?: string;
}

export interface DashboardStat {
  label: string;
  value: string | number;
  icon: string;
  trend?: {
    direction: "up" | "down" | "neutral";
    value: string;
  };
  color?: string;
}

export interface InwardFormInput {
  productSearch: string;
  productId: string;
  quantity: number;
  referenceNo: string;
  binId: string;
  notes: string;
  serialTracking: boolean;
}

export interface OutwardFormInput {
  productSearch: string;
  productId: string;
  quantity: number;
  customerName: string;
  referenceNo: string;
  notes: string;
  serialCodes?: string[];
}

export type FilterChip =
  | "ALL"
  | "BICYCLES"
  | "SPARES"
  | "ACCESSORIES"
  | "LOW_STOCK";

export type POStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT_TO_VENDOR" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export type BillStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "DISPUTED";
export type PaymentMode = "CASH" | "CHEQUE" | "NEFT" | "RTGS" | "UPI" | "CREDIT_ADJUSTMENT";
export type ExpenseCategory = "DELIVERY" | "TRANSPORT" | "SHOP_MAINTENANCE" | "UTILITIES" | "SALARY_ADVANCE" | "FOOD_TEA" | "STATIONERY" | "MISCELLANEOUS";

export interface Vendor {
  id: string;
  name: string;
  code: string;
  gstin?: string;
  pan?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  whatsappNumber?: string;
  paymentTermDays: number;
  creditLimit: number;
  cdTermsDays?: number;
  cdPercentage?: number;
  openingBalance?: number;
  isActive: boolean;
  notes?: string;
  contacts?: VendorContact[];
  createdAt: string;
  updatedAt: string;
}

export interface VendorContact {
  id: string;
  vendorId: string;
  name: string;
  designation?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  isPrimary: boolean;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendor?: Vendor;
  status: POStatus;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  orderDate: string;
  expectedDate?: string;
  approvedById?: string;
  approvedAt?: string;
  createdById: string;
  notes?: string;
  deliveryAddress?: string;
  items?: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  product?: Product;
  quantity: number;
  receivedQty: number;
  unitPrice: number;
  gstRate: number;
  amount: number;
}

export interface VendorBill {
  id: string;
  vendorId: string;
  vendor?: Vendor;
  purchaseOrderId?: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: BillStatus;
  lastFollowedUp?: string;
  nextFollowUpDate?: string;
  followUpNotes?: string;
  notes?: string;
  payments?: VendorPayment[];
  createdAt: string;
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  vendor?: Vendor;
  billId?: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNo?: string;
  notes?: string;
  creditId?: string;
  recordedById: string;
  createdAt: string;
}

export interface VendorCredit {
  id: string;
  vendorId: string;
  vendor?: Vendor;
  creditNoteNo: string;
  amount: number;
  usedAmount: number;
  reason?: string;
  creditDate: string;
  notes?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  category: ExpenseCategory;
  description: string;
  paidBy: string;
  paymentMode: PaymentMode;
  referenceNo?: string;
  receiptUrl?: string;
  notes?: string;
  recordedById: string;
  createdAt: string;
}

export interface VendorFormInput {
  name: string;
  code: string;
  gstin: string;
  pan: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  whatsappNumber: string;
  paymentTermDays: number;
  creditLimit: number;
  cdTermsDays: number;
  cdPercentage: number;
}

export interface POFormInput {
  vendorId: string;
  expectedDate: string;
  deliveryAddress: string;
  notes: string;
  items: { productId: string; quantity: number; unitPrice: number; gstRate: number }[];
}

export interface ExpenseFormInput {
  date: string;
  amount: number;
  category: ExpenseCategory;
  description: string;
  paidBy: string;
  paymentMode: PaymentMode;
  referenceNo: string;
  notes: string;
}

export interface PaymentFormInput {
  vendorId: string;
  billId: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNo: string;
  notes: string;
}

// ---- Customers & Receivables ----

export type CustomerType = "WALK_IN" | "REGULAR" | "DEALER";
export type InvoiceStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  type: CustomerType;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerInvoice {
  id: string;
  customerId: string;
  customer?: Customer;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  status: InvoiceStatus;
  notes?: string;
  payments?: CustomerPayment[];
  createdAt: string;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  customer?: Customer;
  invoiceId?: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNo?: string;
  notes?: string;
  recordedById: string;
  createdAt: string;
}

// ---- Vendor Issues ----

export type IssueType = "QUALITY" | "SHORTAGE" | "DAMAGE" | "WRONG_ITEM" | "BILLING_ERROR" | "DELIVERY_DELAY" | "OTHER";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type IssuePriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface VendorIssue {
  id: string;
  vendorId: string;
  vendor?: Vendor;
  issueNo: string;
  issueType: IssueType;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  billId?: string;
  resolution?: string;
  resolvedAt?: string;
  createdById: string;
  createdAt: string;
}

export * from './lms';
