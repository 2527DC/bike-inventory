"use client";

import { useState, useEffect, useCallback } from "react";
import { usePermissions } from "@/lib/use-permissions";
import {
  AlertCircle,
  Search,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Phone,
  Barcode,
  Bike,
  ShieldAlert,
  Calendar,
  Filter,
  RefreshCw,
  Eye,
  Camera,
  Check,
  X,
  PlusCircle,
  TrendingUp,
  Award,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("complaints:ui");

interface ComplaintItem {
  id: string;
  ticketNo: string;
  customerName: string;
  customerPhone: string;
  description: string;
  photoUrl: string | null;
  isAssemblyFault: boolean;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  unit: {
    id: string;
    unitCode: string;
    product: {
      id: string;
      name: string;
      sku: string;
      brand: { name: string } | null;
      category: { name: string } | null;
    };
    warehouse: { id: string; name: string };
    bin: { id: string; code: string; name: string } | null;
    assembledBy: { id: string; name: string; email: string } | null;
  };
  faultMechanic: { id: string; name: string; email: string } | null;
  attributedBy: { id: string; name: string } | null;
}

interface UnitLookupResult {
  id: string;
  unitCode: string;
  frameNumber: string | null;
  status: string;
  product: {
    id: string;
    name: string;
    sku: string;
    brand: { id: string; name: string } | null;
    category: { id: string; name: string } | null;
  };
  warehouse: { id: string; name: string };
  bin: { id: string; code: string; name: string } | null;
  assembledBy: { id: string; name: string; email: string } | null;
  complaints: Array<{
    id: string;
    ticketNo: string;
    customerName: string;
    description: string;
    isAssemblyFault: boolean;
    status: string;
    createdAt: string;
  }>;
}

export default function ComplaintsPage() {
  const { canCreate, canApprove: canApproveCheck, canEdit } = usePermissions();
  const canLogComplaint = canCreate("complaints");
  const canApproveFault = canApproveCheck("complaints");
  const canEditComplaint = canEdit("complaints");

  const [activeTab, setActiveTab] = useState<"intake" | "queue" | "analytics">("queue");

  // Queue state
  const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [faultFilter, setFaultFilter] = useState("ALL");

  // Counter intake state
  const [unitCodeInput, setUnitCodeInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [matchedUnit, setMatchedUnit] = useState<UnitLookupResult | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [description, setDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState<ComplaintItem | null>(null);

  // Attribution modal state
  const [selectedComplaint, setSelectedComplaint] = useState<ComplaintItem | null>(null);
  const [isFault, setIsFault] = useState(false);
  const [faultMechanicId, setFaultMechanicId] = useState("");
  const [mechanicsList, setMechanicsList] = useState<Array<{ id: string; name: string }>>([]);
  const [attributing, setAttributing] = useState(false);
  const [attrError, setAttrError] = useState("");

  const fetchComplaints = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (faultFilter === "FAULT") params.set("isAssemblyFault", "true");
    if (faultFilter === "NOT_FAULT") params.set("isAssemblyFault", "false");
    if (search.trim()) params.set("search", search.trim());

    const { data, error } = await apiTry<{ items: ComplaintItem[]; total: number }>(
      `/api/complaints?${params.toString()}`
    );
    if (!error && data) {
      setComplaints(data.items || []);
    } else {
      log.error("Failed to load complaints", { error });
    }
    setLoading(false);
  }, [statusFilter, faultFilter, search]);

  useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  // Load mechanics for attribution dropdown
  useEffect(() => {
    apiTry<{ items: Array<{ id: string; name: string }> }>("/api/users?limit=100").then(({ data }) => {
      if (data?.items) {
        setMechanicsList(data.items);
      }
    });
  }, []);

  const handleLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!unitCodeInput.trim()) return;

    setLookupLoading(true);
    setLookupError("");
    setMatchedUnit(null);

    const code = unitCodeInput.trim().toUpperCase();
    const { data, error } = await apiTry<UnitLookupResult>(`/api/complaints/lookup?code=${encodeURIComponent(code)}`);

    if (error || !data) {
      setLookupError(error || "No bicycle found with this unit code. Check the frame sticker.");
    } else {
      setMatchedUnit(data);
    }
    setLookupLoading(false);
  };

  const handleCreateComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedUnit) return;
    if (!customerName.trim() || !customerPhone.trim() || !description.trim()) {
      setSubmitError("Please fill out customer name, phone, and issue description");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    const { data, error } = await apiTry<ComplaintItem>("/api/complaints", {
      method: "POST",
      json: {
        unitCode: matchedUnit.unitCode,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        description: description.trim(),
        photoUrl: photoUrl.trim() || null,
      },
    });

    setSubmitting(false);

    if (error || !data) {
      setSubmitError(error || "Failed to log complaint");
    } else {
      setSubmitSuccess(data);
      // Reset form
      setUnitCodeInput("");
      setMatchedUnit(null);
      setCustomerName("");
      setCustomerPhone("");
      setDescription("");
      setPhotoUrl("");
      fetchComplaints();
    }
  };

  const openAttribution = (c: ComplaintItem) => {
    setSelectedComplaint(c);
    setIsFault(c.isAssemblyFault);
    setFaultMechanicId(c.faultMechanic?.id || c.unit.assembledBy?.id || "");
    setAttrError("");
  };

  const handleSaveAttribution = async () => {
    if (!selectedComplaint) return;
    setAttributing(true);
    setAttrError("");

    const { data, error } = await apiTry<ComplaintItem>(
      `/api/complaints/${selectedComplaint.id}/attribute-fault`,
      {
        method: "POST",
        json: {
          isAssemblyFault: isFault,
          faultMechanicId: isFault ? faultMechanicId : null,
        },
      }
    );

    setAttributing(false);
    if (error || !data) {
      setAttrError(error || "Failed to save attribution");
    } else {
      setSelectedComplaint(null);
      fetchComplaints();
    }
  };

  const handleStatusChange = async (id: string, newStatus: "RESOLVED" | "DISMISSED" | "OPEN") => {
    const { error } = await apiTry(`/api/complaints/${id}`, {
      method: "PATCH",
      json: { status: newStatus },
    });
    if (!error) {
      fetchComplaints();
    }
  };

  // Stats
  const totalComplaints = complaints.length;
  const openComplaints = complaints.filter((c) => c.status === "OPEN").length;
  const assemblyFaults = complaints.filter((c) => c.isAssemblyFault).length;
  const resolvedComplaints = complaints.filter((c) => c.status === "RESOLVED").length;

  // Mechanics Analytics aggregation
  const mechanicStatsMap = new Map<
    string,
    { id: string; name: string; totalComplaints: number; assemblyFaults: number }
  >();

  complaints.forEach((c) => {
    const m = c.faultMechanic || c.unit.assembledBy;
    if (m) {
      const existing = mechanicStatsMap.get(m.id) || {
        id: m.id,
        name: m.name,
        totalComplaints: 0,
        assemblyFaults: 0,
      };
      existing.totalComplaints += 1;
      if (c.isAssemblyFault) existing.assemblyFaults += 1;
      mechanicStatsMap.set(m.id, existing);
    }
  });

  const mechanicStats = Array.from(mechanicStatsMap.values()).sort(
    (a, b) => b.assemblyFaults - a.assemblyFaults
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl shadow-sm">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Cycle Complaints & Quality Audit
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Log post-sale customer issues by frame sticker code (U-xxxxxx) and attribute assembly quality faults.
              </p>
            </div>
          </div>
        </div>

        {canLogComplaint && (
          <Button
            onClick={() => {
              setActiveTab("intake");
              setSubmitSuccess(null);
            }}
            className="bg-slate-900 hover:bg-slate-800 text-white gap-2 h-10 shadow-sm"
          >
            <PlusCircle className="h-4 w-4" /> Log New Complaint
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-slate-200/80 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Complaints</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{totalComplaints}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Recorded in database</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200/80 bg-amber-50/40 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Open Issues</p>
            <p className="text-2xl font-black text-amber-900 mt-1">{openComplaints}</p>
            <p className="text-[11px] text-amber-600 mt-0.5">Pending resolution</p>
          </CardContent>
        </Card>

        <Card className="border-rose-200/80 bg-rose-50/40 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-rose-700 uppercase tracking-wider">Assembly Faults</p>
            <p className="text-2xl font-black text-rose-900 mt-1">{assemblyFaults}</p>
            <p className="text-[11px] text-rose-600 mt-0.5">Attributed to mechanics</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/80 bg-emerald-50/40 shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Resolved</p>
            <p className="text-2xl font-black text-emerald-900 mt-1">{resolvedComplaints}</p>
            <p className="text-[11px] text-emerald-600 mt-0.5">Service closed</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-6">
        <button
          onClick={() => setActiveTab("queue")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === "queue"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-700"
          }`}
        >
          <Filter className="h-4 w-4" /> Complaints Queue ({totalComplaints})
        </button>

        <button
          onClick={() => setActiveTab("intake")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === "intake"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-700"
          }`}
        >
          <Barcode className="h-4 w-4" /> Frame Sticker Intake
        </button>

        <button
          onClick={() => setActiveTab("analytics")}
          className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 ${
            activeTab === "analytics"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-400 hover:text-slate-700"
          }`}
        >
          <Award className="h-4 w-4" /> Mechanic Quality Audit
        </button>
      </div>

      {/* TAB 1: COUNTER INTAKE */}
      {activeTab === "intake" && (
        <div className="max-w-2xl mx-auto space-y-6">
          {submitSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-emerald-900">Complaint Ticket Created!</h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Ticket reference <span className="font-mono font-bold text-emerald-800">{submitSuccess.ticketNo}</span> has been logged for unit{" "}
                  <span className="font-bold">{submitSuccess.unit.unitCode}</span>.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSubmitSuccess(null)}
                    className="text-xs h-8 bg-white"
                  >
                    Log Another
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setActiveTab("queue")}
                    className="text-xs h-8 bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    View in Queue
                  </Button>
                </div>
              </div>
            </div>
          )}

          <Card className="border-slate-200/90 shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Barcode className="h-5 w-5 text-indigo-600" /> 1. Scan or Type Frame Unit Code
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Enter the unique barcode/QR code printed on the bicycle frame sticker (e.g. U-000001).
                </p>

                <form onSubmit={handleLookup} className="flex gap-2 mt-3">
                  <Input
                    value={unitCodeInput}
                    onChange={(e) => setUnitCodeInput(e.target.value.toUpperCase())}
                    placeholder="Enter U-xxxxxx..."
                    className="font-mono font-semibold uppercase tracking-wider text-base"
                    disabled={lookupLoading}
                  />
                  <Button type="submit" disabled={lookupLoading || !unitCodeInput.trim()} className="shrink-0 gap-1.5">
                    {lookupLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Search
                  </Button>
                </form>
                {lookupError && <p className="text-xs font-medium text-rose-600 mt-2">{lookupError}</p>}
              </div>

              {/* Matched bicycle card */}
              {matchedUnit && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
                        <Bike className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                          {matchedUnit.unitCode}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">{matchedUnit.product.name}</h4>
                        <p className="text-xs text-slate-500">
                          {matchedUnit.product.brand?.name || "No Brand"} · {matchedUnit.product.category?.name || "General"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="default" className="text-xs font-mono">
                      {matchedUnit.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 text-xs">
                    <div>
                      <span className="text-slate-400">Assembled By:</span>
                      <p className="font-semibold text-slate-800 flex items-center gap-1 mt-0.5">
                        <Wrench className="h-3.5 w-3.5 text-slate-500" />
                        {matchedUnit.assembledBy?.name || "Unassigned"}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">Warehouse:</span>
                      <p className="font-semibold text-slate-800 mt-0.5">{matchedUnit.warehouse.name}</p>
                    </div>
                  </div>

                  {matchedUnit.complaints?.length > 0 && (
                    <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
                      ⚠️ This bicycle already has <span className="font-bold">{matchedUnit.complaints.length}</span> past complaint(s).
                    </div>
                  )}
                </div>
              )}

              {/* Complaint Form */}
              {matchedUnit && (
                <form onSubmit={handleCreateComplaint} className="space-y-4 pt-2 border-t border-slate-200">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <User className="h-5 w-5 text-indigo-600" /> 2. Customer & Issue Details
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Customer Name *</label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Full name"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Customer Phone *</label>
                      <Input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+91 9876543210"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Complaint Description *</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe what the customer reported (e.g. Brake cable loose, gears slipping, handlebar misalignment)..."
                      className="w-full rounded-md border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[90px]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Photo Reference (Optional)</label>
                    <Input
                      value={photoUrl}
                      onChange={(e) => setPhotoUrl(e.target.value)}
                      placeholder="https://... or photo URL"
                    />
                  </div>

                  {submitError && <p className="text-xs font-medium text-rose-600">{submitError}</p>}

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-11"
                  >
                    {submitting ? "Logging Complaint Ticket..." : "Submit Complaint Ticket"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: QUEUE */}
      {activeTab === "queue" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticket, customer, unit code..."
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open Only</option>
                <option value="RESOLVED">Resolved</option>
                <option value="DISMISSED">Dismissed</option>
              </select>

              <select
                value={faultFilter}
                onChange={(e) => setFaultFilter(e.target.value)}
                className="h-9 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="ALL">All Types</option>
                <option value="FAULT">Assembly Faults Only</option>
                <option value="NOT_FAULT">General Issues</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchComplaints}
                disabled={loading}
                className="h-9 text-xs gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">Loading complaints...</div>
          ) : complaints.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No complaints found</p>
              <p className="text-xs text-slate-400 mt-0.5">Everything looks clean or matches no filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {complaints.map((c) => (
                <Card
                  key={c.id}
                  className={`border-slate-200/90 shadow-sm transition-all hover:border-slate-300 ${
                    c.isAssemblyFault ? "border-l-4 border-l-rose-500" : ""
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                            {c.ticketNo}
                          </span>
                          <span className="font-mono text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                            {c.unit.unitCode}
                          </span>
                          <Badge
                            variant={
                              c.status === "OPEN"
                                ? "warning"
                                : c.status === "RESOLVED"
                                ? "success"
                                : "default"
                            }
                            className="text-[10px]"
                          >
                            {c.status}
                          </Badge>
                          {c.isAssemblyFault ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> Assembly Fault
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              General Issue
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 mt-2">
                          {c.unit.product.name}
                          <span className="text-slate-400 font-normal text-xs ml-1.5">
                            ({c.unit.product.brand?.name || "BCH"} · {c.unit.product.category?.name || "Cycle"})
                          </span>
                        </h4>

                        <p className="text-xs text-slate-700 mt-1 bg-slate-50 p-2 rounded-lg border border-slate-100">
                          {c.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-y-1 gap-x-4 mt-2.5 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-slate-400" /> {c.customerName}
                          </span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-slate-400" /> {c.customerPhone}
                          </span>
                          <span className="flex items-center gap-1">
                            <Wrench className="h-3 w-3 text-slate-400" /> Builder:{" "}
                            <span className="font-medium text-slate-700">
                              {c.unit.assembledBy?.name || "Unknown"}
                            </span>
                          </span>
                          {c.isAssemblyFault && c.faultMechanic && (
                            <span className="text-rose-700 font-semibold">
                              Attributed: {c.faultMechanic.name}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-slate-400">
                            <Calendar className="h-3 w-3" /> {new Date(c.createdAt).toLocaleDateString("en-IN")}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex sm:flex-col gap-1.5 shrink-0 self-end sm:self-auto">
                        {canApproveFault && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAttribution(c)}
                            className="text-xs h-8 gap-1 border-rose-200 hover:bg-rose-50 hover:text-rose-800"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" /> Attribute Fault
                          </Button>
                        )}

                        {canEditComplaint && c.status === "OPEN" && (
                          <Button
                            size="sm"
                            onClick={() => handleStatusChange(c.id, "RESOLVED")}
                            className="text-xs h-8 bg-emerald-700 hover:bg-emerald-800 text-white gap-1"
                          >
                            <Check className="h-3.5 w-3.5" /> Resolve
                          </Button>
                        )}

                        {canEditComplaint && c.status === "OPEN" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStatusChange(c.id, "DISMISSED")}
                            className="text-xs h-8 text-slate-500 hover:bg-slate-100"
                          >
                            Dismiss
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MECHANIC QUALITY AUDIT */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          <div className="bg-slate-900 text-white p-5 rounded-xl shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Mechanic Quality & Reliability Index</h3>
              <p className="text-xs text-slate-300 mt-1">
                Objective attribution of complaints to mechanics to guide training and avoid recurring build defects.
              </p>
            </div>
            <Award className="h-8 w-8 text-amber-400 shrink-0" />
          </div>

          <Card className="border-slate-200/90 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Mechanic</th>
                      <th className="px-4 py-3 text-center">Complaints Linked</th>
                      <th className="px-4 py-3 text-center">Confirmed Assembly Faults</th>
                      <th className="px-4 py-3 text-center">Quality Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mechanicStats.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400">
                          No mechanic complaint records yet.
                        </td>
                      </tr>
                    ) : (
                      mechanicStats.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
                            <div className="p-1.5 bg-slate-100 rounded-full">
                              <User className="h-3.5 w-3.5 text-slate-600" />
                            </div>
                            {m.name}
                          </td>
                          <td className="px-4 py-3 text-center font-semibold text-slate-700">{m.totalComplaints}</td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full font-bold ${
                                m.assemblyFaults > 0
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {m.assemblyFaults}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {m.assemblyFaults === 0 ? (
                              <Badge variant="success" className="text-[10px]">
                                Flawless
                              </Badge>
                            ) : m.assemblyFaults <= 2 ? (
                              <Badge variant="warning" className="text-[10px]">
                                Attention Needed
                              </Badge>
                            ) : (
                              <Badge variant="danger" className="text-[10px]">
                                High Fault Rate
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Attribution Modal */}
      {selectedComplaint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" /> Quality Fault Attribution
              </h3>
              <button
                onClick={() => setSelectedComplaint(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="font-bold text-slate-900">{selectedComplaint.unit.product.name}</p>
                <p className="text-slate-500 font-mono mt-0.5">Unit: {selectedComplaint.unit.unitCode}</p>
                <p className="text-slate-700 italic mt-1.5">"{selectedComplaint.description}"</p>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFault}
                    onChange={(e) => setIsFault(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    Confirm as Mechanic Assembly Fault
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 pl-6">
                  Check this if the issue arose due to faulty assembly or improper adjustment during workshop build.
                </p>
              </div>

              {isFault && (
                <div className="pt-2 pl-6 space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">Attributed Mechanic *</label>
                  <select
                    value={faultMechanicId}
                    onChange={(e) => setFaultMechanicId(e.target.value)}
                    className="w-full h-9 rounded-md border border-slate-300 text-xs px-2.5 font-medium bg-white"
                  >
                    <option value="">Select Mechanic...</option>
                    {mechanicsList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.id === selectedComplaint.unit.assembledBy?.id ? "(Built this bike)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {attrError && <p className="text-xs font-medium text-rose-600 mt-2">{attrError}</p>}
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => setSelectedComplaint(null)}
                disabled={attributing}
                className="flex-1 text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveAttribution}
                disabled={attributing}
                className="flex-1 text-xs bg-slate-900 hover:bg-slate-800 text-white"
              >
                {attributing ? "Saving..." : "Save Attribution"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
