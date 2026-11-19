"use client";

import { useState } from "react";
import {
  FileText,
  Sparkles,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Plus,
  X,
  ExternalLink,
  Building,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExtractedVendorInvoice, ExtractedInvoiceLineItem } from "@/lib/invoice-extraction/types";
import type { VendorOption } from "./vendor-section";

const log = createLogger("purchase-orders:invoice-review");

interface Props {
  vendors: VendorOption[];
  onSuccess: (result: { purchaseOrderId: string; poNumber: string; zohoBillId: string | null; zohoBillNumber: string | null }) => void;
}

export function InvoiceReviewModal({ vendors, onSuccess }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extracted data state
  const [invoiceData, setInvoiceData] = useState<ExtractedVendorInvoice | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [referenceNumber, setReferenceNumber] = useState<string>("");
  const [lineItems, setLineItems] = useState<ExtractedInvoiceLineItem[]>([]);
  const [pushToZoho, setPushToZoho] = useState<boolean>(true);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    poNumber: string;
    purchaseOrderId: string;
    zohoBillNumber: string | null;
    zohoBillId: string | null;
  } | null>(null);

  // Calculations
  const subTotal = lineItems.reduce((acc, li) => acc + (li.rate || 0) * (li.quantity || 0), 0);
  const taxTotal = lineItems.reduce((acc, li) => acc + (li.taxAmount || 0), 0);
  const grandTotal = subTotal + taxTotal;

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setExtracting(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/purchase-orders/invoice-extract", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to extract invoice data with AI");
      }

      const data = json.data as ExtractedVendorInvoice & { fileBase64?: string };
      setInvoiceData(data);
      setInvoiceNumber(data.invoice.invoiceNumber || "");
      setInvoiceDate(data.invoice.invoiceDate || new Date().toISOString().split("T")[0]);
      setDueDate(data.invoice.dueDate || "");
      setReferenceNumber(data.invoice.referenceNumber || "");
      setLineItems(data.lineItems || []);
      setFileBase64(data.fileBase64 || null);

      // Match vendor from list
      if (data.matchedVendor) {
        setSelectedVendorId(data.matchedVendor.id);
      } else {
        // Try finding matching vendor by name or GSTIN in passed vendors prop
        const found = vendors.find(
          (v) =>
            (data.vendor.gstin && v.name.toLowerCase().includes(data.vendor.gstin.toLowerCase())) ||
            v.name.toLowerCase().includes(data.vendor.name.toLowerCase()) ||
            data.vendor.name.toLowerCase().includes(v.name.toLowerCase())
        );
        if (found) setSelectedVendorId(found.id);
      }
    } catch (err) {
      log.error("AI extraction error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Failed to extract invoice");
    } finally {
      setExtracting(false);
    }
  };

  const updateLineItem = (id: string, updates: Partial<ExtractedInvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== id) return li;
        const updated = { ...li, ...updates };
        const qty = updated.quantity || 0;
        const rate = updated.rate || 0;
        const gst = updated.gstPercent || 0;
        const calculatedTax = (rate * qty * gst) / 100;
        const taxAmount = updates.taxAmount !== undefined ? updates.taxAmount : calculatedTax;
        const total = rate * qty + taxAmount;
        return { ...updated, taxAmount, total };
      })
    );
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const addLineItem = () => {
    const newItem: ExtractedInvoiceLineItem = {
      id: `line-${Date.now()}`,
      name: "New Item",
      hsn: "87116090",
      quantity: 1,
      rate: 0,
      gstPercent: 5,
      taxAmount: 0,
      total: 0,
    };
    setLineItems((prev) => [...prev, newItem]);
  };

  const handleSaveAndPush = async () => {
    if (!selectedVendorId) {
      setError("Please select a vendor before proceeding.");
      return;
    }
    if (!invoiceNumber.trim()) {
      setError("Invoice number is required.");
      return;
    }
    if (lineItems.length === 0) {
      setError("Invoice must contain at least one line item.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        vendorId: selectedVendorId,
        invoiceNumber,
        invoiceDate,
        dueDate: dueDate || invoiceDate,
        referenceNumber,
        lineItems,
        totals: {
          subTotal,
          taxTotal,
          grandTotal,
        },
        pushToZoho,
        fileBase64,
        fileName: file?.name,
      };

      const { data, error: apiError } = await apiTry<{
        purchaseOrderId: string;
        poNumber: string;
        vendorBillId: string;
        zohoBillId: string | null;
        zohoBillNumber: string | null;
        notice: string | null;
      }>("/api/purchase-orders/create-from-invoice", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (apiError || !data) {
        throw new Error(apiError || "Failed to create invoice");
      }

      setSuccessInfo({
        poNumber: data.poNumber,
        purchaseOrderId: data.purchaseOrderId,
        zohoBillNumber: data.zohoBillNumber,
        zohoBillId: data.zohoBillId,
      });

      onSuccess(data);
    } catch (err) {
      log.error("saving invoice error", { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  const selectedVendor = vendors.find((v) => v.id === selectedVendorId);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setError(null);
            setSuccessInfo(null);
          }}
          className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow"
        >
          <Sparkles className="h-4 w-4" />
          Upload Vendor Invoice (AI)
        </Button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 my-8 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  AI Vendor Invoice Extraction & Zoho Books Sync
                </h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {error && (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-sm flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium">{error}</div>
                </div>
              )}

              {successInfo ? (
                <div className="py-12 px-6 text-center space-y-4">
                  <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 mb-2">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    Invoice Created Successfully!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto text-sm">
                    Purchase Order <span className="font-semibold text-gray-900 dark:text-gray-100">{successInfo.poNumber}</span> has been raised.
                  </p>
                  {successInfo.zohoBillNumber ? (
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      Zoho Books Bill created: <span className="font-bold">{successInfo.zohoBillNumber}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-amber-600 dark:text-amber-400">
                      Zoho Bill was not pushed (integration inactive or skipped).
                    </div>
                  )}

                  <div className="pt-6 flex justify-center gap-3">
                    <Button
                      onClick={() => {
                        setIsOpen(false);
                        window.location.href = `/purchase-orders/${successInfo.purchaseOrderId}`;
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                    >
                      View Purchase Order
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" onClick={() => setIsOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : !invoiceData ? (
                /* Step 1: Upload Dropzone */
                <div className="space-y-4">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer.files[0];
                      if (dropped) handleFileSelect(dropped);
                    }}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-10 text-center hover:border-blue-500 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 transition-colors cursor-pointer"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".pdf,.png,.jpg,.jpeg,.webp";
                      input.onchange = (e) => {
                        const target = e.target as HTMLInputElement;
                        if (target.files?.[0]) handleFileSelect(target.files[0]);
                      };
                      input.click();
                    }}
                  >
                    {extracting ? (
                      <div className="py-8 space-y-3">
                        <Loader2 className="h-10 w-10 text-blue-600 animate-spin mx-auto" />
                        <div className="text-base font-medium text-gray-900 dark:text-gray-100">
                          AI is analyzing invoice and extracting line items...
                        </div>
                        <div className="text-xs text-gray-500">
                          Reading vendor details, HSN codes, rates, and tax calculations
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 mx-auto">
                          <Upload className="h-6 w-6" />
                        </div>
                        <div>
                          <span className="font-semibold text-blue-600 hover:underline">Click to upload</span> or drag and drop invoice PDF/image
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          PDF, PNG, JPG up to 25MB (e.g. EMotorad, Cultsport, Hero Tax Invoices)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Step 2: Invoice Review & Edit */
                <div className="space-y-6">
                  {/* Vendor & Header Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Vendor Box */}
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5" />
                          Vendor / Supplier
                        </label>
                        {selectedVendor?.id ? (
                          <Badge variant="success" className="text-[10px]">
                            Matched in DB
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">
                            Select Vendor
                          </Badge>
                        )}
                      </div>
                      <select
                        value={selectedVendorId}
                        onChange={(e) => setSelectedVendorId(e.target.value)}
                        className="w-full text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 p-2 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Choose matching vendor --</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      {invoiceData.vendor.gstin && (
                        <div className="text-xs text-gray-500">
                          Invoice GSTIN: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{invoiceData.vendor.gstin}</span>
                        </div>
                      )}
                    </div>

                    {/* Invoice Meta Box */}
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Invoice No *
                          </label>
                          <Input
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                            className="h-8 text-sm font-medium mt-1"
                            placeholder="e.g. 27-EM-2627-14004"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Invoice Date *
                          </label>
                          <Input
                            type="date"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                            className="h-8 text-sm mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Due Date
                          </label>
                          <Input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className="h-8 text-sm mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Order / Ref No
                          </label>
                          <Input
                            value={referenceNumber}
                            onChange={(e) => setReferenceNumber(e.target.value)}
                            className="h-8 text-sm mt-1"
                            placeholder="e.g. ORD/2627/666"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Line Items Table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        Line Items ({lineItems.length})
                      </h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addLineItem}
                        className="h-7 text-xs gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        Add Line
                      </Button>
                    </div>

                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 uppercase tracking-wider font-semibold border-b border-gray-200 dark:border-gray-700">
                          <tr>
                            <th className="py-2.5 px-3">Item Description</th>
                            <th className="py-2.5 px-2 w-24">HSN</th>
                            <th className="py-2.5 px-2 w-20 text-right">Qty</th>
                            <th className="py-2.5 px-2 w-28 text-right">Unit Rate (₹)</th>
                            <th className="py-2.5 px-2 w-20 text-right">GST %</th>
                            <th className="py-2.5 px-2 w-24 text-right">Tax (₹)</th>
                            <th className="py-2.5 px-3 w-28 text-right">Total (₹)</th>
                            <th className="py-2.5 px-2 w-10 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-800 font-medium">
                          {lineItems.map((li) => (
                            <tr key={li.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                              <td className="p-2">
                                <Input
                                  value={li.name}
                                  onChange={(e) => updateLineItem(li.id!, { name: e.target.value })}
                                  className="h-7 text-xs font-medium"
                                />
                                {li.matchedProductName && (
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 truncate max-w-xs">
                                    Catalog: {li.matchedProductName}
                                  </div>
                                )}
                              </td>
                              <td className="p-2">
                                <Input
                                  value={li.hsn || ""}
                                  onChange={(e) => updateLineItem(li.id!, { hsn: e.target.value })}
                                  className="h-7 text-xs"
                                  placeholder="HSN"
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  value={li.quantity}
                                  onChange={(e) => updateLineItem(li.id!, { quantity: parseInt(e.target.value) || 1 })}
                                  className="h-7 text-xs text-right"
                                  min={1}
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={li.rate}
                                  onChange={(e) => updateLineItem(li.id!, { rate: parseFloat(e.target.value) || 0 })}
                                  className="h-7 text-xs text-right"
                                />
                              </td>
                              <td className="p-2">
                                <select
                                  value={li.gstPercent}
                                  onChange={(e) => updateLineItem(li.id!, { gstPercent: parseFloat(e.target.value) || 0 })}
                                  className="h-7 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 w-full text-right"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                  <option value={28}>28%</option>
                                </select>
                              </td>
                              <td className="p-2 text-right text-gray-600 dark:text-gray-400 font-mono">
                                {li.taxAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="p-2 text-right font-bold text-gray-900 dark:text-gray-100 font-mono">
                                {li.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="p-2 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeLineItem(li.id!)}
                                  className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals Summary */}
                  <div className="flex flex-col sm:flex-row items-end justify-between gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={pushToZoho}
                          onChange={(e) => setPushToZoho(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          Push Bill to Zoho Books
                        </span>
                      </label>
                      <span className="text-xs text-gray-500">
                        (Posts to Purchases → Bills with original PDF attached)
                      </span>
                    </div>

                    <div className="w-full sm:w-72 space-y-1.5 text-right text-xs">
                      <div className="flex justify-between text-gray-600 dark:text-gray-400">
                        <span>Taxable Subtotal:</span>
                        <span className="font-mono font-medium">
                          ₹{subTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-600 dark:text-gray-400">
                        <span>Tax Total:</span>
                        <span className="font-mono font-medium">
                          ₹{taxTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-gray-100 pt-1 border-t border-gray-200 dark:border-gray-700">
                        <span>Grand Total:</span>
                        <span className="font-mono text-blue-600 dark:text-blue-400">
                          ₹{grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {invoiceData && !successInfo && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50">
                <Button
                  variant="outline"
                  onClick={() => {
                    setInvoiceData(null);
                    setFile(null);
                  }}
                  disabled={saving}
                >
                  Upload Different Invoice
                </Button>

                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveAndPush}
                    disabled={saving || !selectedVendorId || lineItems.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2 font-semibold shadow"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {pushToZoho ? "Create Bill in Zoho Books & Save" : "Save Purchase Order Only"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
