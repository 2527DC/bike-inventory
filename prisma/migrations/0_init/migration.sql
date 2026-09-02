-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INWARD', 'OUTWARD', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED', 'RGP_OUT', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI', 'CREDIT_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('DELIVERY', 'TRANSPORT', 'SHOP_MAINTENANCE', 'UTILITIES', 'SALARY_ADVANCE', 'FOOD_TEA', 'STATIONERY', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('WALK_IN', 'REGULAR', 'DEALER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('QUALITY', 'SHORTAGE', 'DAMAGE', 'WRONG_ITEM', 'BILLING_ERROR', 'DELIVERY_DELAY', 'OTHER');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'REFURBISHED_EXCELLENT', 'REFURBISHED_GOOD', 'REFURBISHED_FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "BankTxnType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "BankTxnMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'FLAGGED', 'EXPENSE', 'IGNORED');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('WEB', 'ANDROID');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "IssueSource" AS ENUM ('VENDOR', 'CLIENT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'VERIFIED', 'WALK_OUT', 'SCHEDULED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FLAGGED', 'PREBOOKED', 'PACKED', 'SHIPPED', 'IN_TRANSIT');

-- CreateEnum
CREATE TYPE "TransferOrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InboundShipmentStatus" AS ENUM ('IN_TRANSIT', 'DELIVERED', 'PARTIALLY_DELIVERED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CASH_VERIFIED', 'PARTIALLY_MATCHED', 'FULLY_MATCHED', 'DISCREPANCY');

-- CreateEnum
CREATE TYPE "PreBookingStatus" AS ENUM ('WAITING', 'MATCHED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BrandStockUploadStatus" AS ENUM ('PROCESSING', 'PARSED', 'REVIEWED', 'FAILED');

-- CreateEnum
CREATE TYPE "BrandStockMatchStatus" AS ENUM ('AUTO_MATCHED', 'FUZZY_MATCHED', 'MANUAL_MATCHED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RECEIVED', 'PARTS_NEEDED', 'READY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('QFX', 'PSVC', 'RSVC', 'FSVC', 'A50', 'A85', 'FULL', 'SND', 'WSH', 'ECYC');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'CREDIT', 'PAID');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DISCOUNT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerSide" AS ENUM ('VENDOR', 'BCH');

-- CreateEnum
CREATE TYPE "LedgerMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'NEEDS_REVIEW', 'THEY_MISSING', 'WE_MISSING', 'DISPUTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "LedgerEntrySource" AS ENUM ('STATEMENT_PDF', 'STATEMENT_XLSX', 'STATEMENT_CSV', 'BCH_BOOKS', 'MANUAL');

-- CreateEnum
CREATE TYPE "GapType" AS ENUM ('DISCOUNT_PENDING', 'CREDIT_NOTE_PENDING', 'SHORT_CREDIT', 'DISPUTE', 'RECONCILIATION_DIFFERENCE', 'DOCUMENTATION_GAP', 'BALANCE_UNCONFIRMED', 'SCHEME_ENTITLEMENT', 'COMMITMENT_PENDING', 'OPERATIONAL_WARRANTY', 'INVOICE_DISCREPANCY', 'REIMBURSEMENT_PENDING');

-- CreateEnum
CREATE TYPE "GapTier" AS ENUM ('FIRM', 'LEVERAGE', 'VERIFY', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "GapStatus" AS ENUM ('OPEN', 'PROMISED', 'VERIFY', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SCREENSHOT', 'PDF', 'EMAIL', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('CASH', 'TRADE', 'VOLUME', 'TRANSPORT_SUPPORT', 'MARKETING', 'INCENTIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "CountDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "modules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "route" TEXT,
    "group" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parent_id" TEXT,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "accessCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT,
    "warehouseId" TEXT,
    "navTabs" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "movingLevel" TEXT NOT NULL DEFAULT 'NORMAL',
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "whatsappNumber" TEXT,
    "cdTermsDays" INTEGER,
    "cdPercentage" DOUBLE PRECISION,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "zohoItemId" TEXT,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mrp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "hsnCode" TEXT,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "reservedStock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "maxStock" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT,
    "color" TEXT,
    "imageUrls" TEXT[],
    "tags" TEXT[],
    "binId" TEXT,
    "reorderVendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialItem" (
    "id" TEXT NOT NULL,
    "serialCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
    "binId" TEXT,
    "batchNo" TEXT,
    "invoiceNo" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldAt" TIMESTAMP(3),
    "customerName" TEXT,
    "saleInvoiceNo" TEXT,
    "barcodeData" TEXT,
    "barcodeFormat" TEXT NOT NULL DEFAULT 'CODE128',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialTransactionItem" (
    "id" TEXT NOT NULL,
    "serialItemId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerialTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "zone" TEXT,
    "capacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousStock" INTEGER NOT NULL,
    "newStock" INTEGER NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "isRgp" BOOLEAN NOT NULL DEFAULT false,
    "rgpReturnDate" TIMESTAMP(3),
    "rgpReturned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "countNo" TEXT,
    "title" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "binId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "productType" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "variance" INTEGER,
    "suggestedBrand" TEXT,
    "notes" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsappNumber" TEXT,
    "waGroupName" TEXT,
    "waGroupCode" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cdTermsDays" INTEGER,
    "cdPercentage" DOUBLE PRECISION,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorContact" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "deliveryAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "billNo" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "BillStatus" NOT NULL DEFAULT 'PENDING',
    "lastFollowedUp" TIMESTAMP(3),
    "nextFollowUpDate" TIMESTAMP(3),
    "followUpNotes" TEXT,
    "notes" TEXT,
    "billedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "billId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "cdDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMode" "PaymentMode" NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "creditId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCredit" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "usedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT,
    "creditDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "paidBy" TEXT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "referenceNo" TEXT,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "accountNumber" TEXT,
    "fileName" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "totalCredits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDebits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txnCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "BankTxnType" NOT NULL,
    "balance" DOUBLE PRECISION,
    "matchStatus" "BankTxnMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "flagReason" TEXT,
    "suggestedVendorId" TEXT,
    "suggestedBillId" TEXT,
    "suggestedCategory" TEXT,
    "confidence" DOUBLE PRECISION,
    "confirmedVendorId" TEXT,
    "confirmedPaymentId" TEXT,
    "confirmedExpenseId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_config" (
    "provider" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "organizationId" TEXT,
    "organizationName" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_config_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "StorageConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" TEXT NOT NULL DEFAULT 'LOCAL',
    "bucket" TEXT,
    "region" TEXT,
    "accessKeyId" TEXT,
    "secretAccessKey" TEXT,
    "publicBaseUrl" TEXT,
    "localDir" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "emailProvider" TEXT NOT NULL DEFAULT 'SMTP',
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailConnected" BOOLEAN NOT NULL DEFAULT false,
    "emailLastTestedAt" TIMESTAMP(3),
    "emailLastTestError" TEXT,
    "pushProvider" TEXT NOT NULL DEFAULT 'FCM',
    "fcmProjectId" TEXT,
    "fcmServiceAccount" TEXT,
    "fcmWebApiKey" TEXT,
    "fcmMessagingSenderId" TEXT,
    "fcmWebAppId" TEXT,
    "fcmVapidKey" TEXT,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushConnected" BOOLEAN NOT NULL DEFAULT false,
    "pushLastTestedAt" TIMESTAMP(3),
    "pushLastTestError" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event_settings" (
    "eventKey" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_event_settings_pkey" PRIMARY KEY ("eventKey")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "userId" TEXT,
    "target" TEXT,
    "refId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "synced" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "triggeredBy" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "type" "CustomerType" NOT NULL DEFAULT 'WALK_IN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInvoice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIssue" (
    "id" TEXT NOT NULL,
    "issueSource" "IssueSource" NOT NULL DEFAULT 'VENDOR',
    "vendorId" TEXT,
    "clientName" TEXT,
    "clientPhone" TEXT,
    "issueNo" TEXT NOT NULL,
    "ticketNo" TEXT,
    "serviceLocation" TEXT,
    "issueType" "IssueType" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "IssuePriority" NOT NULL DEFAULT 'MEDIUM',
    "billId" TEXT,
    "photoUrls" TEXT[],
    "docLink" TEXT,
    "suggestedResolution" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorIssueNote" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorIssueNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "zohoInvoiceId" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceAmount" DOUBLE PRECISION NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "alternatePhone" TEXT,
    "customerAddress" TEXT,
    "customerArea" TEXT,
    "customerPincode" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "stockReservedAt" TIMESTAMP(3),
    "expectedReadyDate" TIMESTAMP(3),
    "prebookNotes" TEXT,
    "flagReason" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "flagResolvedAt" TIMESTAMP(3),
    "flagResolvedBy" TEXT,
    "invoiceType" TEXT,
    "salesPerson" TEXT,
    "lineItems" JSONB,
    "notes" TEXT,
    "deliveryNotes" TEXT,
    "whatsAppScheduledSent" BOOLEAN NOT NULL DEFAULT false,
    "whatsAppDispatchedSent" BOOLEAN NOT NULL DEFAULT false,
    "whatsAppDeliveredSent" BOOLEAN NOT NULL DEFAULT false,
    "freeAccessories" TEXT,
    "reversePickup" BOOLEAN NOT NULL DEFAULT false,
    "isOutstation" BOOLEAN NOT NULL DEFAULT false,
    "courierName" TEXT,
    "courierTrackingNo" TEXT,
    "courierTrackingLink" TEXT,
    "courierCost" DOUBLE PRECISION,
    "vehicleNo" TEXT,
    "selfFillToken" TEXT,
    "selfFillTokenExpiry" TIMESTAMP(3),
    "selfFillCompletedAt" TIMESTAMP(3),
    "mapsLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "redFlagPhones" TEXT,
    "googleReviewLink" TEXT,
    "whatsappTemplates" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoPullPreview" (
    "id" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'new',
    "zohoId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "localMatch" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZohoPullPreview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoPullLog" (
    "id" TEXT NOT NULL,
    "pullId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "contactsNew" INTEGER NOT NULL DEFAULT 0,
    "itemsNew" INTEGER NOT NULL DEFAULT 0,
    "billsNew" INTEGER NOT NULL DEFAULT 0,
    "invoicesNew" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "apiCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ZohoPullLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondHandCycle" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" TEXT,
    "condition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "costPrice" DOUBLE PRECISION NOT NULL,
    "sellingPrice" DOUBLE PRECISION,
    "photoUrl" TEXT NOT NULL,
    "photoUrls" TEXT[],
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "zohoInvoiceNo" TEXT,
    "zohoItemId" TEXT,
    "binId" TEXT,
    "soldAt" TIMESTAMP(3),
    "soldToName" TEXT,
    "soldToPhone" TEXT,
    "soldInvoiceNo" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecondHandCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "status" "TransferOrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOrderItem" (
    "id" TEXT NOT NULL,
    "transferOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fromBinId" TEXT,
    "toBinId" TEXT,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundShipment" (
    "id" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billImageUrl" TEXT,
    "billPdfUrl" TEXT,
    "billDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TIMESTAMP(3) NOT NULL,
    "status" "InboundShipmentStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "putawayAt" TIMESTAMP(3),
    "putawayById" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorBillId" TEXT,
    "zohoBillId" TEXT,

    CONSTRAINT "InboundShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundLineItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,
    "hsn" TEXT,
    "isDelivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredQty" INTEGER,
    "preBookedCustomerName" TEXT,
    "preBookedCustomerPhone" TEXT,
    "preBookedInvoiceNo" TEXT,
    "whatsAppSent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "binId" TEXT,

    CONSTRAINT "InboundLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSession" (
    "id" TEXT NOT NULL,
    "zakyaSessionId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "registerName" TEXT,
    "cashierName" TEXT,
    "cashSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cardSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "upiSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "financeSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashRefunds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "countedCash" DOUBLE PRECISION,
    "cashDiscrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashInHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashDeposited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB,
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySettlement" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "totalCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCard" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalUpi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFinance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashCounted" DOUBLE PRECISION,
    "cashVariance" DOUBLE PRECISION,
    "cashVerifiedAt" TIMESTAMP(3),
    "cashVerifiedById" TEXT,
    "cashIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashOut" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashOutReason" TEXT,
    "matchedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unmatchedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementMatch" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "bankTxnId" TEXT,
    "matchedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreBooking" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "zohoInvoiceNo" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "brandId" TEXT,
    "status" "PreBookingStatus" NOT NULL DEFAULT 'WAITING',
    "matchedShipmentId" TEXT,
    "matchedLineItemId" TEXT,
    "salesPerson" TEXT,
    "expectedDate" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreUpdate" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpsActivityLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BrandStockUpload" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" "BrandStockUploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "matchedItems" INTEGER NOT NULL DEFAULT 0,
    "unmatchedItems" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandStockUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandStockItem" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rawSku" TEXT,
    "rawName" TEXT NOT NULL,
    "rawCategory" TEXT,
    "brandAvailableQty" INTEGER NOT NULL DEFAULT 0,
    "brandPrice" DOUBLE PRECISION,
    "brandMrp" DOUBLE PRECISION,
    "rawSize" TEXT,
    "matchStatus" "BrandStockMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchConfidence" DOUBLE PRECISION,
    "productId" TEXT,
    "bchCurrentStock" INTEGER,
    "bchReorderLevel" INTEGER,
    "suggestedQty" INTEGER,
    "orderQty" INTEGER,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSkuMapping" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "brandSku" TEXT,
    "brandName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandSkuMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_jobs" (
    "id" TEXT NOT NULL,
    "tokenNumber" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RECEIVED',
    "jobType" "JobType" NOT NULL,
    "estimatedHrs" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "bikeType" TEXT NOT NULL,
    "bikeColor" TEXT,
    "isEcycle" BOOLEAN NOT NULL DEFAULT false,
    "complaint" TEXT,
    "diagnosis" TEXT,
    "partsNeeded" TEXT,
    "workDone" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promisedAt" TIMESTAMP(3),
    "partsAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "holdReason" TEXT,
    "notes" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "amount" DOUBLE PRECISION,
    "zohoInvoiceId" TEXT,
    "deliveryMatchedInvoice" TEXT,
    "deliveryProposedAt" TIMESTAMP(3),
    "deliveryReviewedAt" TIMESTAMP(3),
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "afterPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "customerId" TEXT NOT NULL,
    "mechanicId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "service_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "googleReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "wheelSize" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_logs" (
    "id" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "assemblyType" TEXT NOT NULL,
    "bikeModel" TEXT,
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_counter" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "current" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "token_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_audit_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "details" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tokenNumber" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_ledger_entries" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "brandId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "ref" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" INTEGER NOT NULL,
    "side" "LedgerSide" NOT NULL,
    "note" TEXT,
    "source" "LedgerEntrySource" NOT NULL DEFAULT 'STATEMENT_CSV',
    "auditStatus" TEXT,
    "auditNote" TEXT,
    "matchStatus" "LedgerMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "billId" TEXT,
    "paymentId" TEXT,
    "creditId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "gapId" TEXT,
    "statementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_statements" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "claimedClosing" DOUBLE PRECISION,
    "computedClosing" DOUBLE PRECISION,
    "tiesOut" BOOLEAN NOT NULL DEFAULT false,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "sourceKind" "LedgerEntrySource" NOT NULL DEFAULT 'STATEMENT_CSV',
    "extractionModel" TEXT,
    "extractionNote" TEXT,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_gaps" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "brandId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "gapType" "GapType" NOT NULL,
    "tier" "GapTier",
    "status" "GapStatus" NOT NULL DEFAULT 'OPEN',
    "amount" DOUBLE PRECISION,
    "amountNote" TEXT,
    "promisedBy" TEXT,
    "promisedOn" TIMESTAMP(3),
    "evidenceText" TEXT,
    "action" TEXT,
    "result" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_gap_evidence" (
    "id" TEXT NOT NULL,
    "gapId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "capturedOn" TIMESTAMP(3),
    "source" TEXT,
    "note" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_gap_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_gap_notes" (
    "id" TEXT NOT NULL,
    "gapId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_gap_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_discount_terms" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "brandId" TEXT,
    "kind" "DiscountKind" NOT NULL,
    "percentage" DOUBLE PRECISION,
    "perUnitAmount" DOUBLE PRECISION,
    "appliesTo" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "withinDays" INTEGER,
    "agreedBy" TEXT,
    "agreedOn" TIMESTAMP(3),
    "isProven" BOOLEAN NOT NULL DEFAULT false,
    "evidenceUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_discount_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_vendors" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_events" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "entranceId" TEXT NOT NULL DEFAULT 'main',
    "direction" "CountDirection" NOT NULL,
    "eventTs" TIMESTAMP(3) NOT NULL,
    "receivedTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT,
    "adapter" TEXT NOT NULL DEFAULT 'RTSP_CV',
    "trackId" TEXT,
    "confidence" DOUBLE PRECISION,
    "agentVersion" TEXT,
    "configVersion" TEXT,
    "quality" TEXT NOT NULL DEFAULT 'ok',

    CONSTRAINT "count_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heartbeats" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT 'edge-1',
    "deviceId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "queueDepth" INTEGER,
    "cameraOk" BOOLEAN,
    "lastFrameTs" TIMESTAMP(3),
    "agentVersion" TEXT,

    CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_devices" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT 'edge-1',
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "image_url" TEXT,
    "usps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "talking_points" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_customer" TEXT,
    "common_objections" JSONB NOT NULL DEFAULT '[]',
    "buyer_psychology" JSONB NOT NULL DEFAULT '{}',
    "unique_fact" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "competitors" JSONB NOT NULL DEFAULT '[]',
    "reviews" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "faqs" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stock_product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_scenarios" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "tips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_video_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_video_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_videos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "youtube_url" TEXT NOT NULL,
    "category_id" TEXT,
    "duration_minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "lms_product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_quizzes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "passing_score" INTEGER NOT NULL DEFAULT 70,
    "xp_reward" INTEGER NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_quiz_questions" (
    "id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" INTEGER NOT NULL,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_quiz_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "xp_earned" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_achievements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "criteria_type" TEXT NOT NULL,
    "criteria_value" INTEGER NOT NULL,
    "xp_reward" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_user_achievements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "last_active_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "videos_watched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scenarios_completed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_activity_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "xp_earned" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lms_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_daily_tips" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "scheduled_for" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_daily_tips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_course_levels" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "week_number" INTEGER,
    "brand_focus" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_course_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_lessons" (
    "id" TEXT NOT NULL,
    "level_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "youtube_url" TEXT,
    "key_pointers" JSONB NOT NULL DEFAULT '[]',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "xp_reward" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_lesson_questions" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" INTEGER NOT NULL,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_lesson_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_lesson_progress" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "video_watched" BOOLEAN NOT NULL DEFAULT false,
    "checklist_done" JSONB NOT NULL DEFAULT '[]',
    "quiz_score" INTEGER,
    "quiz_total" INTEGER,
    "quiz_passed" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "xp_earned" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_weekly_tests" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "description" TEXT,
    "passing_score" INTEGER NOT NULL DEFAULT 70,
    "xp_reward" INTEGER NOT NULL DEFAULT 100,
    "scheduled_for" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_weekly_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_weekly_test_questions" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" INTEGER NOT NULL,
    "explanation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_weekly_test_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lms_weekly_test_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "xp_earned" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lms_weekly_test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modules_key_key" ON "modules"("key");

-- CreateIndex
CREATE INDEX "modules_isActive_sortOrder_idx" ON "modules"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "modules_parent_id_sortOrder_idx" ON "modules"("parent_id", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_moduleId_idx" ON "permissions"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_moduleId_action_key" ON "permissions"("moduleId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "roles_isActive_idx" ON "roles"("isActive");

-- CreateIndex
CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_name_key" ON "ProductType"("name");

-- CreateIndex
CREATE INDEX "ProductType_isActive_sortOrder_idx" ON "ProductType"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE INDEX "Warehouse_storeId_idx" ON "Warehouse"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_storeId_code_key" ON "Warehouse"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_accessCode_key" ON "User"("accessCode");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_zohoItemId_key" ON "Product"("zohoItemId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_reorderVendorId_idx" ON "Product"("reorderVendorId");

-- CreateIndex
CREATE INDEX "Product_productTypeId_idx" ON "Product"("productTypeId");

-- CreateIndex
CREATE INDEX "Product_status_productTypeId_idx" ON "Product"("status", "productTypeId");

-- CreateIndex
CREATE INDEX "Product_status_categoryId_idx" ON "Product"("status", "categoryId");

-- CreateIndex
CREATE INDEX "Product_status_brandId_idx" ON "Product"("status", "brandId");

-- CreateIndex
CREATE INDEX "Product_status_currentStock_idx" ON "Product"("status", "currentStock");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "StockLevel_warehouseId_idx" ON "StockLevel"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_productId_warehouseId_key" ON "StockLevel"("productId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialItem_serialCode_key" ON "SerialItem"("serialCode");

-- CreateIndex
CREATE INDEX "SerialItem_productId_idx" ON "SerialItem"("productId");

-- CreateIndex
CREATE INDEX "SerialItem_status_idx" ON "SerialItem"("status");

-- CreateIndex
CREATE INDEX "SerialItem_binId_idx" ON "SerialItem"("binId");

-- CreateIndex
CREATE INDEX "SerialTransactionItem_serialItemId_idx" ON "SerialTransactionItem"("serialItemId");

-- CreateIndex
CREATE INDEX "SerialTransactionItem_transactionId_idx" ON "SerialTransactionItem"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_code_key" ON "Bin"("code");

-- CreateIndex
CREATE INDEX "InventoryTransaction_productId_idx" ON "InventoryTransaction"("productId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_userId_idx" ON "InventoryTransaction"("userId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_type_idx" ON "InventoryTransaction"("type");

-- CreateIndex
CREATE INDEX "InventoryTransaction_createdAt_idx" ON "InventoryTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_type_createdAt_idx" ON "InventoryTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_productId_type_idx" ON "InventoryTransaction"("productId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_countNo_key" ON "StockCount"("countNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "VendorContact_vendorId_idx" ON "VendorContact"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE INDEX "VendorBill_vendorId_idx" ON "VendorBill"("vendorId");

-- CreateIndex
CREATE INDEX "VendorBill_status_idx" ON "VendorBill"("status");

-- CreateIndex
CREATE INDEX "VendorBill_dueDate_idx" ON "VendorBill"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_vendorId_billNo_key" ON "VendorBill"("vendorId", "billNo");

-- CreateIndex
CREATE INDEX "VendorPayment_vendorId_idx" ON "VendorPayment"("vendorId");

-- CreateIndex
CREATE INDEX "VendorPayment_billId_idx" ON "VendorPayment"("billId");

-- CreateIndex
CREATE INDEX "VendorPayment_paymentDate_idx" ON "VendorPayment"("paymentDate");

-- CreateIndex
CREATE INDEX "VendorCredit_vendorId_idx" ON "VendorCredit"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCredit_vendorId_creditNoteNo_key" ON "VendorCredit"("vendorId", "creditNoteNo");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

-- CreateIndex
CREATE INDEX "Expense_recordedById_idx" ON "Expense"("recordedById");

-- CreateIndex
CREATE INDEX "BankStatement_createdAt_idx" ON "BankStatement"("createdAt");

-- CreateIndex
CREATE INDEX "BankTransaction_statementId_idx" ON "BankTransaction"("statementId");

-- CreateIndex
CREATE INDEX "BankTransaction_matchStatus_idx" ON "BankTransaction"("matchStatus");

-- CreateIndex
CREATE INDEX "BankTransaction_date_idx" ON "BankTransaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_eventKey_key" ON "notification_preferences"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "notification_outbox_eventKey_createdAt_idx" ON "notification_outbox"("eventKey", "createdAt");

-- CreateIndex
CREATE INDEX "notification_outbox_userId_createdAt_idx" ON "notification_outbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncLog_syncType_idx" ON "SyncLog"("syncType");

-- CreateIndex
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInvoice_invoiceNo_key" ON "CustomerInvoice"("invoiceNo");

-- CreateIndex
CREATE INDEX "CustomerInvoice_customerId_idx" ON "CustomerInvoice"("customerId");

-- CreateIndex
CREATE INDEX "CustomerInvoice_status_idx" ON "CustomerInvoice"("status");

-- CreateIndex
CREATE INDEX "CustomerInvoice_dueDate_idx" ON "CustomerInvoice"("dueDate");

-- CreateIndex
CREATE INDEX "CustomerPayment_customerId_idx" ON "CustomerPayment"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPayment_invoiceId_idx" ON "CustomerPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "CustomerPayment_paymentDate_idx" ON "CustomerPayment"("paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "VendorIssue_issueNo_key" ON "VendorIssue"("issueNo");

-- CreateIndex
CREATE INDEX "VendorIssue_vendorId_idx" ON "VendorIssue"("vendorId");

-- CreateIndex
CREATE INDEX "VendorIssue_status_idx" ON "VendorIssue"("status");

-- CreateIndex
CREATE INDEX "VendorIssue_priority_idx" ON "VendorIssue"("priority");

-- CreateIndex
CREATE INDEX "VendorIssue_createdAt_idx" ON "VendorIssue"("createdAt");

-- CreateIndex
CREATE INDEX "VendorIssue_issueSource_idx" ON "VendorIssue"("issueSource");

-- CreateIndex
CREATE INDEX "VendorIssueNote_issueId_idx" ON "VendorIssueNote"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_invoiceNo_key" ON "Delivery"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_selfFillToken_key" ON "Delivery"("selfFillToken");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "Delivery_invoiceDate_idx" ON "Delivery"("invoiceDate");

-- CreateIndex
CREATE INDEX "Delivery_customerArea_idx" ON "Delivery"("customerArea");

-- CreateIndex
CREATE INDEX "Delivery_scheduledDate_idx" ON "Delivery"("scheduledDate");

-- CreateIndex
CREATE INDEX "ZohoPullPreview_pullId_idx" ON "ZohoPullPreview"("pullId");

-- CreateIndex
CREATE INDEX "ZohoPullPreview_entityType_idx" ON "ZohoPullPreview"("entityType");

-- CreateIndex
CREATE INDEX "ZohoPullPreview_status_idx" ON "ZohoPullPreview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ZohoPullLog_pullId_key" ON "ZohoPullLog"("pullId");

-- CreateIndex
CREATE INDEX "ZohoPullLog_status_idx" ON "ZohoPullLog"("status");

-- CreateIndex
CREATE INDEX "ZohoPullLog_createdAt_idx" ON "ZohoPullLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecondHandCycle_sku_key" ON "SecondHandCycle"("sku");

-- CreateIndex
CREATE INDEX "SecondHandCycle_status_idx" ON "SecondHandCycle"("status");

-- CreateIndex
CREATE INDEX "SecondHandCycle_sku_idx" ON "SecondHandCycle"("sku");

-- CreateIndex
CREATE INDEX "SecondHandCycle_createdAt_idx" ON "SecondHandCycle"("createdAt");

-- CreateIndex
CREATE INDEX "SecondHandCycle_isVerified_idx" ON "SecondHandCycle"("isVerified");

-- CreateIndex
CREATE UNIQUE INDEX "TransferOrder_orderNo_key" ON "TransferOrder"("orderNo");

-- CreateIndex
CREATE INDEX "TransferOrder_status_idx" ON "TransferOrder"("status");

-- CreateIndex
CREATE INDEX "TransferOrder_createdById_idx" ON "TransferOrder"("createdById");

-- CreateIndex
CREATE INDEX "TransferOrder_createdAt_idx" ON "TransferOrder"("createdAt");

-- CreateIndex
CREATE INDEX "TransferOrderItem_transferOrderId_idx" ON "TransferOrderItem"("transferOrderId");

-- CreateIndex
CREATE INDEX "TransferOrderItem_productId_idx" ON "TransferOrderItem"("productId");

-- CreateIndex
CREATE INDEX "TransferOrderItem_fromWarehouseId_idx" ON "TransferOrderItem"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "TransferOrderItem_toWarehouseId_idx" ON "TransferOrderItem"("toWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundShipment_shipmentNo_key" ON "InboundShipment"("shipmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "InboundShipment_vendorBillId_key" ON "InboundShipment"("vendorBillId");

-- CreateIndex
CREATE INDEX "InboundShipment_status_idx" ON "InboundShipment"("status");

-- CreateIndex
CREATE INDEX "InboundShipment_brandId_idx" ON "InboundShipment"("brandId");

-- CreateIndex
CREATE INDEX "InboundShipment_billNo_idx" ON "InboundShipment"("billNo");

-- CreateIndex
CREATE INDEX "InboundShipment_expectedDeliveryDate_idx" ON "InboundShipment"("expectedDeliveryDate");

-- CreateIndex
CREATE INDEX "InboundShipment_createdAt_idx" ON "InboundShipment"("createdAt");

-- CreateIndex
CREATE INDEX "InboundLineItem_shipmentId_idx" ON "InboundLineItem"("shipmentId");

-- CreateIndex
CREATE INDEX "InboundLineItem_productId_idx" ON "InboundLineItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PosSession_zakyaSessionId_key" ON "PosSession"("zakyaSessionId");

-- CreateIndex
CREATE INDEX "PosSession_sessionDate_idx" ON "PosSession"("sessionDate");

-- CreateIndex
CREATE INDEX "PosSession_settlementId_idx" ON "PosSession"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySettlement_date_key" ON "DailySettlement"("date");

-- CreateIndex
CREATE INDEX "DailySettlement_status_idx" ON "DailySettlement"("status");

-- CreateIndex
CREATE INDEX "DailySettlement_date_idx" ON "DailySettlement"("date");

-- CreateIndex
CREATE INDEX "SettlementMatch_settlementId_idx" ON "SettlementMatch"("settlementId");

-- CreateIndex
CREATE INDEX "SettlementMatch_bankTxnId_idx" ON "SettlementMatch"("bankTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "PreBooking_matchedLineItemId_key" ON "PreBooking"("matchedLineItemId");

-- CreateIndex
CREATE INDEX "PreBooking_status_idx" ON "PreBooking"("status");

-- CreateIndex
CREATE INDEX "PreBooking_brandId_idx" ON "PreBooking"("brandId");

-- CreateIndex
CREATE INDEX "PreBooking_matchedShipmentId_idx" ON "PreBooking"("matchedShipmentId");

-- CreateIndex
CREATE INDEX "PreBooking_createdAt_idx" ON "PreBooking"("createdAt");

-- CreateIndex
CREATE INDEX "StoreUpdate_category_idx" ON "StoreUpdate"("category");

-- CreateIndex
CREATE INDEX "StoreUpdate_createdAt_idx" ON "StoreUpdate"("createdAt");

-- CreateIndex
CREATE INDEX "OpsActivityLog_action_idx" ON "OpsActivityLog"("action");

-- CreateIndex
CREATE INDEX "OpsActivityLog_createdAt_idx" ON "OpsActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "BrandStockUpload_brandId_idx" ON "BrandStockUpload"("brandId");

-- CreateIndex
CREATE INDEX "BrandStockUpload_status_idx" ON "BrandStockUpload"("status");

-- CreateIndex
CREATE INDEX "BrandStockUpload_createdAt_idx" ON "BrandStockUpload"("createdAt");

-- CreateIndex
CREATE INDEX "BrandStockItem_uploadId_idx" ON "BrandStockItem"("uploadId");

-- CreateIndex
CREATE INDEX "BrandStockItem_matchStatus_idx" ON "BrandStockItem"("matchStatus");

-- CreateIndex
CREATE INDEX "BrandStockItem_productId_idx" ON "BrandStockItem"("productId");

-- CreateIndex
CREATE INDEX "BrandSkuMapping_brandId_idx" ON "BrandSkuMapping"("brandId");

-- CreateIndex
CREATE INDEX "BrandSkuMapping_productId_idx" ON "BrandSkuMapping"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSkuMapping_brandId_brandName_key" ON "BrandSkuMapping"("brandId", "brandName");

-- CreateIndex
CREATE UNIQUE INDEX "service_jobs_tokenNumber_key" ON "service_jobs"("tokenNumber");

-- CreateIndex
CREATE INDEX "service_jobs_status_idx" ON "service_jobs"("status");

-- CreateIndex
CREATE INDEX "service_jobs_mechanicId_idx" ON "service_jobs"("mechanicId");

-- CreateIndex
CREATE INDEX "service_jobs_receivedAt_idx" ON "service_jobs"("receivedAt");

-- CreateIndex
CREATE INDEX "service_jobs_customerId_idx" ON "service_jobs"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_jobId_key" ON "reviews"("jobId");

-- CreateIndex
CREATE INDEX "reviews_mechanicId_idx" ON "reviews"("mechanicId");

-- CreateIndex
CREATE INDEX "price_items_category_idx" ON "price_items"("category");

-- CreateIndex
CREATE INDEX "price_items_wheelSize_idx" ON "price_items"("wheelSize");

-- CreateIndex
CREATE INDEX "assembly_logs_mechanicId_idx" ON "assembly_logs"("mechanicId");

-- CreateIndex
CREATE INDEX "assembly_logs_createdAt_idx" ON "assembly_logs"("createdAt");

-- CreateIndex
CREATE INDEX "service_audit_logs_jobId_idx" ON "service_audit_logs"("jobId");

-- CreateIndex
CREATE INDEX "service_audit_logs_createdAt_idx" ON "service_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_jobId_idx" ON "notification_logs"("jobId");

-- CreateIndex
CREATE INDEX "notification_logs_createdAt_idx" ON "notification_logs"("createdAt");

-- CreateIndex
CREATE INDEX "brand_ledger_entries_vendorId_entryDate_idx" ON "brand_ledger_entries"("vendorId", "entryDate");

-- CreateIndex
CREATE INDEX "brand_ledger_entries_vendorId_matchStatus_idx" ON "brand_ledger_entries"("vendorId", "matchStatus");

-- CreateIndex
CREATE INDEX "brand_ledger_entries_statementId_idx" ON "brand_ledger_entries"("statementId");

-- CreateIndex
CREATE INDEX "brand_ledger_entries_gapId_idx" ON "brand_ledger_entries"("gapId");

-- CreateIndex
CREATE INDEX "brand_statements_vendorId_statementDate_idx" ON "brand_statements"("vendorId", "statementDate");

-- CreateIndex
CREATE INDEX "ledger_gaps_vendorId_status_idx" ON "ledger_gaps"("vendorId", "status");

-- CreateIndex
CREATE INDEX "ledger_gaps_status_gapType_idx" ON "ledger_gaps"("status", "gapType");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_gaps_vendorId_number_key" ON "ledger_gaps"("vendorId", "number");

-- CreateIndex
CREATE INDEX "ledger_gap_evidence_gapId_idx" ON "ledger_gap_evidence"("gapId");

-- CreateIndex
CREATE INDEX "ledger_gap_notes_gapId_idx" ON "ledger_gap_notes"("gapId");

-- CreateIndex
CREATE INDEX "vendor_discount_terms_vendorId_kind_idx" ON "vendor_discount_terms"("vendorId", "kind");

-- CreateIndex
CREATE INDEX "vendor_discount_terms_vendorId_effectiveFrom_idx" ON "vendor_discount_terms"("vendorId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "brand_vendors_vendorId_idx" ON "brand_vendors"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_vendors_brandId_vendorId_key" ON "brand_vendors"("brandId", "vendorId");

-- CreateIndex
CREATE INDEX "count_events_storeId_businessDate_idx" ON "count_events"("storeId", "businessDate");

-- CreateIndex
CREATE INDEX "count_events_deviceId_idx" ON "count_events"("deviceId");

-- CreateIndex
CREATE INDEX "heartbeats_storeId_ts_idx" ON "heartbeats"("storeId", "ts" DESC);

-- CreateIndex
CREATE INDEX "heartbeats_storeId_businessDate_idx" ON "heartbeats"("storeId", "businessDate");

-- CreateIndex
CREATE INDEX "heartbeats_deviceId_idx" ON "heartbeats"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_devices_keyHash_key" ON "analytics_devices"("keyHash");

-- CreateIndex
CREATE INDEX "analytics_devices_isActive_idx" ON "analytics_devices"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_devices_storeId_agentId_key" ON "analytics_devices"("storeId", "agentId");

-- CreateIndex
CREATE INDEX "lms_products_is_active_idx" ON "lms_products"("is_active");

-- CreateIndex
CREATE INDEX "lms_products_brand_idx" ON "lms_products"("brand");

-- CreateIndex
CREATE INDEX "lms_products_category_idx" ON "lms_products"("category");

-- CreateIndex
CREATE INDEX "lms_products_stock_product_id_idx" ON "lms_products"("stock_product_id");

-- CreateIndex
CREATE INDEX "lms_scenarios_is_active_sort_order_idx" ON "lms_scenarios"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "lms_video_categories_sort_order_idx" ON "lms_video_categories"("sort_order");

-- CreateIndex
CREATE INDEX "lms_videos_category_id_idx" ON "lms_videos"("category_id");

-- CreateIndex
CREATE INDEX "lms_videos_lms_product_id_idx" ON "lms_videos"("lms_product_id");

-- CreateIndex
CREATE INDEX "lms_videos_is_active_sort_order_idx" ON "lms_videos"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "lms_quizzes_is_active_idx" ON "lms_quizzes"("is_active");

-- CreateIndex
CREATE INDEX "lms_quizzes_type_idx" ON "lms_quizzes"("type");

-- CreateIndex
CREATE INDEX "lms_quiz_questions_quiz_id_sort_order_idx" ON "lms_quiz_questions"("quiz_id", "sort_order");

-- CreateIndex
CREATE INDEX "lms_quiz_attempts_user_id_passed_idx" ON "lms_quiz_attempts"("user_id", "passed");

-- CreateIndex
CREATE INDEX "lms_quiz_attempts_quiz_id_idx" ON "lms_quiz_attempts"("quiz_id");

-- CreateIndex
CREATE INDEX "lms_quiz_attempts_user_id_completed_at_idx" ON "lms_quiz_attempts"("user_id", "completed_at");

-- CreateIndex
CREATE INDEX "lms_achievements_criteria_type_idx" ON "lms_achievements"("criteria_type");

-- CreateIndex
CREATE INDEX "lms_user_achievements_user_id_idx" ON "lms_user_achievements"("user_id");

-- CreateIndex
CREATE INDEX "lms_user_achievements_achievement_id_idx" ON "lms_user_achievements"("achievement_id");

-- CreateIndex
CREATE UNIQUE INDEX "lms_user_achievements_user_id_achievement_id_key" ON "lms_user_achievements"("user_id", "achievement_id");

-- CreateIndex
CREATE UNIQUE INDEX "lms_progress_user_id_key" ON "lms_progress"("user_id");

-- CreateIndex
CREATE INDEX "lms_progress_xp_idx" ON "lms_progress"("xp");

-- CreateIndex
CREATE INDEX "lms_activity_log_user_id_created_at_idx" ON "lms_activity_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "lms_activity_log_activity_type_idx" ON "lms_activity_log"("activity_type");

-- CreateIndex
CREATE INDEX "lms_announcements_is_active_created_at_idx" ON "lms_announcements"("is_active", "created_at");

-- CreateIndex
CREATE INDEX "lms_announcements_expires_at_idx" ON "lms_announcements"("expires_at");

-- CreateIndex
CREATE INDEX "lms_daily_tips_is_active_scheduled_for_idx" ON "lms_daily_tips"("is_active", "scheduled_for");

-- CreateIndex
CREATE INDEX "lms_courses_is_active_idx" ON "lms_courses"("is_active");

-- CreateIndex
CREATE INDEX "lms_course_levels_course_id_sort_order_idx" ON "lms_course_levels"("course_id", "sort_order");

-- CreateIndex
CREATE INDEX "lms_lessons_level_id_sort_order_idx" ON "lms_lessons"("level_id", "sort_order");

-- CreateIndex
CREATE INDEX "lms_lessons_is_active_idx" ON "lms_lessons"("is_active");

-- CreateIndex
CREATE INDEX "lms_lesson_questions_lesson_id_sort_order_idx" ON "lms_lesson_questions"("lesson_id", "sort_order");

-- CreateIndex
CREATE INDEX "lms_lesson_progress_user_id_completed_idx" ON "lms_lesson_progress"("user_id", "completed");

-- CreateIndex
CREATE INDEX "lms_lesson_progress_lesson_id_idx" ON "lms_lesson_progress"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "lms_lesson_progress_user_id_lesson_id_key" ON "lms_lesson_progress"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "lms_weekly_tests_is_active_week_number_idx" ON "lms_weekly_tests"("is_active", "week_number");

-- CreateIndex
CREATE INDEX "lms_weekly_tests_scheduled_for_idx" ON "lms_weekly_tests"("scheduled_for");

-- CreateIndex
CREATE INDEX "lms_weekly_test_questions_test_id_sort_order_idx" ON "lms_weekly_test_questions"("test_id", "sort_order");

-- CreateIndex
CREATE INDEX "lms_weekly_test_attempts_user_id_passed_idx" ON "lms_weekly_test_attempts"("user_id", "passed");

-- CreateIndex
CREATE INDEX "lms_weekly_test_attempts_test_id_idx" ON "lms_weekly_test_attempts"("test_id");

-- CreateIndex
CREATE INDEX "lms_weekly_test_attempts_user_id_completed_at_idx" ON "lms_weekly_test_attempts"("user_id", "completed_at");

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_reorderVendorId_fkey" FOREIGN KEY ("reorderVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialTransactionItem" ADD CONSTRAINT "SerialTransactionItem_serialItemId_fkey" FOREIGN KEY ("serialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialTransactionItem" ADD CONSTRAINT "SerialTransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorContact" ADD CONSTRAINT "VendorContact_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "VendorCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCredit" ADD CONSTRAINT "VendorCredit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_suggestedVendorId_fkey" FOREIGN KEY ("suggestedVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_suggestedBillId_fkey" FOREIGN KEY ("suggestedBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_confirmedVendorId_fkey" FOREIGN KEY ("confirmedVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssue" ADD CONSTRAINT "VendorIssue_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssue" ADD CONSTRAINT "VendorIssue_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssue" ADD CONSTRAINT "VendorIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssueNote" ADD CONSTRAINT "VendorIssueNote_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "VendorIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorIssueNote" ADD CONSTRAINT "VendorIssueNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondHandCycle" ADD CONSTRAINT "SecondHandCycle_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondHandCycle" ADD CONSTRAINT "SecondHandCycle_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondHandCycle" ADD CONSTRAINT "SecondHandCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_transferOrderId_fkey" FOREIGN KEY ("transferOrderId") REFERENCES "TransferOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_putawayById_fkey" FOREIGN KEY ("putawayById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundShipment" ADD CONSTRAINT "InboundShipment_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLineItem" ADD CONSTRAINT "InboundLineItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "InboundShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLineItem" ADD CONSTRAINT "InboundLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundLineItem" ADD CONSTRAINT "InboundLineItem_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSession" ADD CONSTRAINT "PosSession_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DailySettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySettlement" ADD CONSTRAINT "DailySettlement_cashVerifiedById_fkey" FOREIGN KEY ("cashVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementMatch" ADD CONSTRAINT "SettlementMatch_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DailySettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementMatch" ADD CONSTRAINT "SettlementMatch_bankTxnId_fkey" FOREIGN KEY ("bankTxnId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_matchedShipmentId_fkey" FOREIGN KEY ("matchedShipmentId") REFERENCES "InboundShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_matchedLineItemId_fkey" FOREIGN KEY ("matchedLineItemId") REFERENCES "InboundLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreBooking" ADD CONSTRAINT "PreBooking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreUpdate" ADD CONSTRAINT "StoreUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsActivityLog" ADD CONSTRAINT "OpsActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStockUpload" ADD CONSTRAINT "BrandStockUpload_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStockUpload" ADD CONSTRAINT "BrandStockUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStockItem" ADD CONSTRAINT "BrandStockItem_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "BrandStockUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStockItem" ADD CONSTRAINT "BrandStockItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSkuMapping" ADD CONSTRAINT "BrandSkuMapping_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSkuMapping" ADD CONSTRAINT "BrandSkuMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "service_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_logs" ADD CONSTRAINT "assembly_logs_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "VendorPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "VendorCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "ledger_gaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ledger_entries" ADD CONSTRAINT "brand_ledger_entries_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "brand_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_statements" ADD CONSTRAINT "brand_statements_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_statements" ADD CONSTRAINT "brand_statements_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gaps" ADD CONSTRAINT "ledger_gaps_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gaps" ADD CONSTRAINT "ledger_gaps_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gaps" ADD CONSTRAINT "ledger_gaps_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gap_evidence" ADD CONSTRAINT "ledger_gap_evidence_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "ledger_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gap_evidence" ADD CONSTRAINT "ledger_gap_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gap_notes" ADD CONSTRAINT "ledger_gap_notes_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "ledger_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_gap_notes" ADD CONSTRAINT "ledger_gap_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_discount_terms" ADD CONSTRAINT "vendor_discount_terms_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_discount_terms" ADD CONSTRAINT "vendor_discount_terms_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_discount_terms" ADD CONSTRAINT "vendor_discount_terms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_vendors" ADD CONSTRAINT "brand_vendors_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_vendors" ADD CONSTRAINT "brand_vendors_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_events" ADD CONSTRAINT "count_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_events" ADD CONSTRAINT "count_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "analytics_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "analytics_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_devices" ADD CONSTRAINT "analytics_devices_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_products" ADD CONSTRAINT "lms_products_stock_product_id_fkey" FOREIGN KEY ("stock_product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_videos" ADD CONSTRAINT "lms_videos_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "lms_video_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_videos" ADD CONSTRAINT "lms_videos_lms_product_id_fkey" FOREIGN KEY ("lms_product_id") REFERENCES "lms_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_questions" ADD CONSTRAINT "lms_quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "lms_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_attempts" ADD CONSTRAINT "lms_quiz_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_quiz_attempts" ADD CONSTRAINT "lms_quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "lms_quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_user_achievements" ADD CONSTRAINT "lms_user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_user_achievements" ADD CONSTRAINT "lms_user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "lms_achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_progress" ADD CONSTRAINT "lms_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_activity_log" ADD CONSTRAINT "lms_activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_course_levels" ADD CONSTRAINT "lms_course_levels_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "lms_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_lessons" ADD CONSTRAINT "lms_lessons_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "lms_course_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_lesson_questions" ADD CONSTRAINT "lms_lesson_questions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lms_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_lesson_progress" ADD CONSTRAINT "lms_lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_lesson_progress" ADD CONSTRAINT "lms_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lms_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_weekly_test_questions" ADD CONSTRAINT "lms_weekly_test_questions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lms_weekly_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_weekly_test_attempts" ADD CONSTRAINT "lms_weekly_test_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lms_weekly_test_attempts" ADD CONSTRAINT "lms_weekly_test_attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lms_weekly_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
