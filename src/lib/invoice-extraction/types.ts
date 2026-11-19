export interface ExtractedInvoiceLineItem {
  id?: string;
  name: string;
  hsn: string | null;
  quantity: number;
  rate: number;
  gstPercent: number;
  taxAmount: number;
  total: number;
  matchedProductId?: string | null;
  matchedProductName?: string | null;
}

export interface ExtractedVendorInvoice {
  vendor: {
    name: string;
    gstin: string | null;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  invoice: {
    invoiceNumber: string;
    invoiceDate: string; // YYYY-MM-DD
    dueDate?: string | null; // YYYY-MM-DD
    referenceNumber?: string | null;
    taxType: "IGST" | "CGST_SGST";
  };
  lineItems: ExtractedInvoiceLineItem[];
  totals: {
    subTotal: number;
    taxTotal: number;
    grandTotal: number;
  };
  matchedVendor?: {
    id: string;
    name: string;
    gstin: string | null;
    zohoVendorId: string | null;
  } | null;
  aiModel?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
}
