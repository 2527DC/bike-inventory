"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Share2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface IssueNote {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string };
}

interface IssueDetail {
  id: string;
  issueNo: string;
  issueSource: string;
  issueType: string;
  description: string;
  status: string;
  priority: string;
  photoUrls?: string[];
  docLink?: string | null;
  suggestedResolution?: string;
  resolution?: string;
  resolvedAt?: string;
  createdAt: string;
  vendor: {
    id: string;
    name: string;
    code: string;
    whatsappNumber?: string | null;
    phone?: string | null;
    contacts?: { name: string; phone?: string | null; whatsapp?: string | null }[];
  } | null;
  clientName?: string;
  clientPhone?: string;
  bill?: { id: string; billNo: string; amount: number } | null;
  createdBy: { id: string; name: string };
  notes?: IssueNote[];
}

const ISSUE_TYPE_COLORS: Record<string, string> = {
  QUALITY: "bg-red-100 text-red-700",
  SHORTAGE: "bg-orange-100 text-orange-700",
  DAMAGE: "bg-red-100 text-red-700",
  WRONG_ITEM: "bg-purple-100 text-purple-700",
  BILLING_ERROR: "bg-blue-100 text-blue-700",
  DELIVERY_DELAY: "bg-yellow-100 text-yellow-700",
  OTHER: "bg-slate-100 text-slate-700",
};

const PRIORITY_VARIANT: Record<string, "default" | "info" | "warning" | "danger"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const STATUS_VARIANT: Record<string, "default" | "info" | "warning" | "success"> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CLOSED: "default",
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|3gp|quicktime)(\?|$)/i.test(url);
}

export default function VendorIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const isAdmin = role === "ADMIN" || role === "CEO";
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const [resolutionText, setResolutionText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // Admin-only brand (vendor) reassignment
  const [brandEditing, setBrandEditing] = useState(false);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; name: string; code: string }[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  async function openBrandEdit() {
    setBrandError(null);
    setSelectedVendorId(issue?.vendor?.id || "");
    setBrandEditing(true);
    if (vendorOptions.length === 0) {
      try {
        const res = await fetch("/api/vendors?limit=500");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setVendorOptions(json.data.map((v: { id: string; name: string; code: string }) => ({ id: v.id, name: v.name, code: v.code })));
        }
      } catch { /* ignore */ }
    }
  }

  async function saveBrand() {
    if (!selectedVendorId || selectedVendorId === issue?.vendor?.id) { setBrandEditing(false); return; }
    setSavingBrand(true);
    setBrandError(null);
    try {
      const res = await fetch(`/api/vendor-issues/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: selectedVendorId }),
      });
      const json = await res.json();
      if (json.success) { setIssue(json.data); setBrandEditing(false); }
      else setBrandError(json.error || "Failed to change brand");
    } catch (e) {
      setBrandError(e instanceof Error ? e.message : "Failed to change brand");
    }
    setSavingBrand(false);
  }

  // On sharing an issue with the vendor, auto-move it from OPEN to IN PROGRESS.
  async function markIssueShared() {
    if (!issue || issue.status !== "OPEN") return;
    try {
      const res = await fetch("/api/vendor-issues/mark-shared", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [issue.id] }),
      });
      const json = await res.json();
      if (json.success && (json.data?.updatedIds || []).length) {
        setIssue((prev) => (prev ? { ...prev, status: "IN_PROGRESS" } : prev));
      }
    } catch { /* ignore — the share itself still worked */ }
  }

  async function addNote() {
    if (!issue || !noteText.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/vendor-issues/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: noteText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setIssue((prev) => (prev ? { ...prev, notes: [data.data, ...(prev.notes || [])] } : prev));
        setNoteText("");
      }
    } catch {
      /* ignore */
    }
    setAddingNote(false);
  }

  useEffect(() => {
    fetch(`/api/vendor-issues/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setIssue(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function updateStatus(newStatus: string, resolution?: string) {
    setUpdating(true);
    try {
      const body: Record<string, string> = { status: newStatus };
      if (resolution) body.resolution = resolution;
      const res = await fetch(`/api/vendor-issues/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setIssue(data.data);
        setShowResolution(false);
        setResolutionText("");
      }
    } catch {
      // silent
    }
    setUpdating(false);
  }

  // Resolve the contact number to open the chat with: the brand's (vendor) WhatsApp/phone for a
  // brand issue, or the client's phone for a client issue. Indian numbers → wa.me/91<last 10>.
  function contactDigits(): string {
    const primary = issue?.vendor?.contacts?.[0];
    const raw =
      issue?.issueSource === "CLIENT"
        ? issue?.clientPhone || ""
        : primary?.whatsapp || primary?.phone || issue?.vendor?.whatsappNumber || issue?.vendor?.phone || "";
    const digits = raw.replace(/\D/g, "");
    return digits ? digits.slice(-10) : "";
  }

  // Name to show on the share button — the brand's primary contact person if we have one.
  function contactLabel(): string {
    if (issue?.issueSource === "CLIENT") return "Client";
    return issue?.vendor?.contacts?.[0]?.name || issue?.vendor?.name || "Brand";
  }

  async function handleWhatsAppShare() {
    if (!issue) return;
    void markIssueShared();
    const source = issue.issueSource === "CLIENT"
      ? `Client: ${issue.clientName || "Unknown"}${issue.clientPhone ? ` (${issue.clientPhone})` : ""}`
      : `Brand: ${issue.vendor?.name || "Unknown"} (${issue.vendor?.code || ""})`;

    const greetName = issue.issueSource !== "CLIENT" ? issue.vendor?.contacts?.[0]?.name : undefined;
    let text = greetName ? `Hi ${greetName},\n\n` : "";
    text += `*Ops Issue ${issue.issueNo}*\n`;
    text += `Source: ${source}\n`;
    text += `Type: ${issue.issueType.replace(/_/g, " ")}\n`;
    text += `Priority: ${issue.priority}\n`;
    text += `Status: ${issue.status.replace(/_/g, " ")}\n\n`;
    text += `*Description:*\n${issue.description}\n`;
    if (issue.suggestedResolution) text += `\n*Suggested Resolution:*\n${issue.suggestedResolution}\n`;
    if (issue.resolution) text += `\n*Resolution:*\n${issue.resolution}\n`;
    if (issue.docLink) text += `\n*Document:* ${issue.docLink}\n`;
    if (issue.bill) text += `\nBill: ${issue.bill.billNo}\n`;
    text += `\nCreated: ${new Date(issue.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;

    const digits = contactDigits();

    // If we know the contact's number, open THEIR chat directly with the message prefilled.
    // (A numbered wa.me deep link can't also carry image files, so photo links are appended.)
    if (digits) {
      if (issue.photoUrls && issue.photoUrls.length > 0) {
        text += `\n\n*Photos:*\n${issue.photoUrls.join("\n")}`;
      }
      window.open(`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`, "_blank");
      return;
    }

    // Videos always go as links (too large to attach reliably).
    const videoUrls = (issue.photoUrls || []).filter(isVideoUrl);
    const imageUrls = (issue.photoUrls || []).filter((u) => !isVideoUrl(u));
    if (videoUrls.length > 0) text += `\n\n*Videos:*\n${videoUrls.join("\n")}`;

    // No number on file → try native share with image files, else generic WhatsApp picker.
    if (imageUrls.length > 0 && navigator.share) {
      try {
        const files: File[] = [];
        for (const url of imageUrls) {
          const res = await fetch(url);
          const blob = await res.blob();
          const ext = url.split(".").pop()?.split("?")[0] || "jpg";
          files.push(new File([blob], `issue-${issue.issueNo}-${files.length + 1}.${ext}`, { type: blob.type }));
        }
        if (navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({ text, files });
          return;
        }
      } catch { /* fall through */ }
    }

    if (imageUrls.length > 0) {
      text += `\n\n*Photos:*\n${imageUrls.join("\n")}`;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-400">Issue not found</p>
        <Link
          href="/vendor-issues"
          className="text-sm text-blue-600 hover:underline mt-2 inline-block"
        >
          Back to Issues
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/vendor-issues" className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900">{issue.issueNo}</h1>
          <p className="text-xs text-slate-500">
            {issue.issueSource === "CLIENT" ? `Client: ${issue.clientName || "Unknown"}` : `Brand: ${issue.vendor?.name || "Unknown"}`}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[issue.status] || "default"}>
          {issue.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Info Card */}
      <Card className="mb-4">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Type:</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                ISSUE_TYPE_COLORS[issue.issueType] || ISSUE_TYPE_COLORS.OTHER
              }`}
            >
              {issue.issueType.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Priority:</span>
            <Badge variant={PRIORITY_VARIANT[issue.priority] || "default"}>
              {issue.priority}
            </Badge>
          </div>
          <div>
            <span className="text-xs text-slate-500">
              {issue.issueSource === "CLIENT" ? "Client:" : "Brand:"}
            </span>
            {issue.issueSource === "CLIENT" ? (
              <div>
                <p className="text-sm text-slate-900">{issue.clientName || "Unknown"}</p>
                {issue.clientPhone && <p className="text-xs text-slate-500">{issue.clientPhone}</p>}
              </div>
            ) : (
              <div>
                <p className="text-sm text-slate-900">{issue.vendor?.name} ({issue.vendor?.code})</p>
                {isAdmin && !brandEditing && (
                  <button onClick={openBrandEdit} className="mt-1 text-xs font-medium text-blue-600 hover:underline">
                    Change brand
                  </button>
                )}
                {isAdmin && brandEditing && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={selectedVendorId}
                      onChange={(e) => setSelectedVendorId(e.target.value)}
                      className="w-full h-9 px-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">Select correct brand…</option>
                      {vendorOptions.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                      ))}
                    </select>
                    {brandError && <p className="text-xs text-red-600">{brandError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={saveBrand}
                        disabled={savingBrand || !selectedVendorId}
                        className="flex-1 h-9 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
                      >
                        {savingBrand ? "Saving…" : "Save brand"}
                      </button>
                      <button
                        onClick={() => setBrandEditing(false)}
                        className="flex-1 h-9 rounded-lg border border-slate-200 text-sm font-medium text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {issue.bill && (
            <div>
              <span className="text-xs text-slate-500">Bill:</span>
              <Link
                href={`/bills/${issue.bill.id}`}
                className="text-sm text-blue-600 hover:underline ml-1"
              >
                {issue.bill.billNo}
              </Link>
            </div>
          )}
          {issue.docLink && (
            <div>
              <span className="text-xs text-slate-500">Document:</span>
              <a
                href={issue.docLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline ml-1 break-all"
              >
                {issue.docLink}
              </a>
            </div>
          )}
          <div>
            <span className="text-xs text-slate-500">Created by:</span>
            <p className="text-sm text-slate-700">{issue.createdBy.name}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Created:</span>
            <p className="text-sm text-slate-700">
              {new Date(issue.createdAt).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Photos & Videos */}
      {issue.photoUrls && issue.photoUrls.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-3">
            <p className="text-xs text-slate-500 mb-2">Photos &amp; Videos</p>
            <div className="flex gap-2 overflow-x-auto">
              {issue.photoUrls.map((url, i) =>
                isVideoUrl(url) ? (
                  <video
                    key={i}
                    src={url}
                    controls
                    playsInline
                    className="h-24 w-24 object-cover rounded-lg border border-slate-200 bg-black shrink-0"
                  />
                ) : (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <img
                      src={url}
                      alt={`Issue photo ${i + 1}`}
                      className="w-24 h-24 object-cover rounded-lg border border-slate-200"
                    />
                  </a>
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Description */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <p className="text-xs text-slate-500 mb-1">Description</p>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">
            {issue.description}
          </p>
        </CardContent>
      </Card>

      {/* Suggested Resolution */}
      {issue.suggestedResolution && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <CardContent className="p-3">
            <p className="text-xs text-amber-600 font-medium mb-1">Suggested Resolution</p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">
              {issue.suggestedResolution}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Resolution section */}
      {(issue.status === "RESOLVED" || issue.status === "CLOSED") &&
        issue.resolution && (
          <Card className="mb-4 border-green-200 bg-green-50/50">
            <CardContent className="p-3">
              <p className="text-xs text-green-600 font-medium mb-1">
                Resolution
              </p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">
                {issue.resolution}
              </p>
              {issue.resolvedAt && (
                <p className="text-[10px] text-slate-400 mt-2">
                  Resolved on:{" "}
                  {new Date(issue.resolvedAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </CardContent>
          </Card>
        )}

      {/* Resolution textarea (when transitioning to RESOLVED) */}
      {showResolution && (
        <Card className="mb-4">
          <CardContent className="p-3 space-y-2">
            <p className="text-sm font-medium text-slate-700">
              Resolution Details
            </p>
            <textarea
              placeholder="Describe how the issue was resolved..."
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              rows={3}
              className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => updateStatus("RESOLVED", resolutionText)}
                disabled={updating || !resolutionText.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {updating ? "Saving..." : "Confirm Resolved"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowResolution(false);
                  setResolutionText("");
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status transition buttons */}
      {issue.status !== "CLOSED" && !showResolution && (
        <div className="space-y-2 mb-4">
          {issue.status === "OPEN" && (
            <Button
              size="sm"
              onClick={() => updateStatus("IN_PROGRESS")}
              disabled={updating}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {updating ? "Updating..." : "In Progress"}
            </Button>
          )}
          {issue.status === "IN_PROGRESS" && (
            <Button
              size="sm"
              onClick={() => setShowResolution(true)}
              disabled={updating}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Mark Resolved
            </Button>
          )}
          {issue.status === "RESOLVED" && (
            <Button
              size="sm"
              onClick={() => updateStatus("CLOSED")}
              disabled={updating}
              className="w-full"
            >
              {updating ? "Updating..." : "Close Issue"}
            </Button>
          )}
          {issue.status !== "OPEN" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatus("OPEN")}
              disabled={updating}
              className="w-full"
            >
              {updating ? "Updating..." : "Reopen"}
            </Button>
          )}
        </div>
      )}
      {/* Follow-up notes timeline */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <p className="text-xs font-semibold text-slate-700 mb-2">Follow-up Notes</p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            placeholder="Add a follow-up note (e.g. Called Lux, will replace by Fri)…"
            className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 mb-2"
          />
          <Button
            size="sm"
            onClick={addNote}
            disabled={addingNote || !noteText.trim()}
            className="w-full mb-3"
          >
            {addingNote ? "Adding…" : "Add Note"}
          </Button>
          {issue.notes && issue.notes.length > 0 ? (
            <div className="space-y-2">
              {issue.notes.map((n) => (
                <div key={n.id} className="border-l-2 border-slate-200 pl-3 py-0.5">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {n.author?.name || "—"} ·{" "}
                    {new Date(n.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No notes yet. Add the first follow-up note above.</p>
          )}
        </CardContent>
      </Card>

      {/* WhatsApp Share */}
      <Button
        size="sm"
        onClick={handleWhatsAppShare}
        className="w-full bg-green-600 hover:bg-green-700 mb-1"
      >
        <Share2 className="w-4 h-4 mr-1.5" />
        {contactDigits() ? `Share on WhatsApp → ${contactLabel()}` : "Share on WhatsApp"}
      </Button>
      {!contactDigits() && issue.issueSource !== "CLIENT" && (
        <p className="text-[11px] text-amber-600 mb-4">
          No WhatsApp number saved for {issue.vendor?.name || "this brand"} — add one on the
          {" "}
          <Link href={`/vendors/${issue.vendor?.id}`} className="underline">brand page</Link>
          {" "}to message them directly.
        </p>
      )}
    </div>
  );
}
