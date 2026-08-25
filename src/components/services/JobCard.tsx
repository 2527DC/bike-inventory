"use client";

import { useState, useEffect } from "react";
import { JOB_STATUS, JOB_TYPE, STATUS_FLOW } from "@/lib/services/constants";
import { getWhatsAppUrl, getPickupReminderUrl } from "@/lib/services/whatsapp";
import { errorMessage } from "@/lib/utils";

type Job = {
  id: string;
  tokenNumber: string;
  status: string;
  jobType: string;
  bikeType: string;
  complaint: string | null;
  partsNeeded: string | null;
  holdReason: string | null;
  estimatedHrs: number;
  amount: number | null;
  isEcycle: boolean;
  priority: number;
  receivedAt: string;
  promisedAt: string | null;
  zohoInvoiceId?: string | null;
  notes?: string | null;
  photos?: string[];
  afterPhotos?: string[];
  customer: { name: string; phone: string };
  mechanic: { name: string; emoji: string } | null;
};

export default function JobCard({
  job,
  onStatusChange,
  onRefresh,
  showActions = true,
  largePhotos = false,
  onAddParts,
  hideDeliverFlow = false,
  showUndo = false,
  readyBikeCount = 0,
}: {
  job: Job;
  onStatusChange?: (jobId: string, newStatus: string) => void;
  onRefresh?: () => void;
  showActions?: boolean;
  largePhotos?: boolean;
  onAddParts?: (jobId: string, currentAmount: number | null) => void;
  hideDeliverFlow?: boolean;
  showUndo?: boolean;
  readyBikeCount?: number;
}) {
  const statusConfig = JOB_STATUS[job.status as keyof typeof JOB_STATUS];
  const typeConfig = JOB_TYPE[job.jobType as keyof typeof JOB_TYPE];
  const nextStatuses = STATUS_FLOW[job.status] || [];

  const timeSince = (date: string) => {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className={`job-card rounded-2xl p-4 mb-3 shadow-sm border-l-4 ${statusConfig?.bgLight || "bg-white"}`}
      style={{ borderLeftColor: statusConfig?.hex || "#9ca3af" }}>
      {/* Top row: token + status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{typeConfig?.emoji || "🔧"}</span>
          <div>
            <span className="font-bold text-lg">{job.tokenNumber}</span>
            {job.priority > 0 && <span className="ml-1 text-red-500">🔴</span>}
          </div>
        </div>
        <span className={`status-pill px-3 py-1 rounded-full text-sm font-semibold text-white ${statusConfig?.color || "bg-gray-400"}`}>
          {statusConfig?.emoji} {statusConfig?.label}
        </span>
      </div>

      {/* Bike photos */}
      {job.photos && job.photos.length > 0 && (
        <BlobPhotos jobId={job.id} count={job.photos.length} large={largePhotos} onRefresh={onRefresh} />
      )}

      {/* Bike + Customer */}
      <div className="mb-2">
        <div className="text-lg font-semibold">🚲 {job.bikeType}</div>
        <div className="flex items-center justify-between">
          <div className="text-gray-600">👤 {job.customer.name}</div>
          {job.customer.phone && job.customer.phone !== "0000000000" && (
            <a
              href={`tel:+91${job.customer.phone}`}
              className="flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 font-bold px-3 py-1.5 rounded-full text-xs active:scale-95 transition-transform"
            >
              📞 Call
            </a>
          )}
        </div>
        {job.complaint && (
          <div className="text-gray-500 text-sm mt-1">💬 {job.complaint}</div>
        )}
        {job.partsNeeded ? (
          <div className="mt-2 bg-orange-50 border border-orange-200 rounded-xl p-2.5">
            <div className="text-xs font-bold text-orange-700 mb-1">🔧 Parts & Services</div>
            {job.partsNeeded.split(", ").map((item, i) => (
              <div key={i} className="text-sm text-orange-800 py-0.5">• {item}</div>
            ))}
          </div>
        ) : job.amount != null && job.amount > 0 && job.status !== "DELIVERED" && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-2 flex items-center justify-between">
            <span className="text-xs font-bold text-red-600">⚠️ No breakdown added</span>
            <span className="text-xs text-red-500">Use "Add Parts" to update</span>
          </div>
        )}
        {job.holdReason && job.status === "PARTS_NEEDED" && (
          <div className="text-red-600 text-sm mt-1 font-medium">📌 Hold: {job.holdReason}</div>
        )}
      </div>

      {/* Promised delivery / pickup status */}
      {job.promisedAt && job.status !== "DELIVERED" && (() => {
        const promised = new Date(job.promisedAt);
        const now = new Date();
        const todayStart = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        todayStart.setHours(0, 0, 0, 0);
        const promisedDay = new Date(promised.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        promisedDay.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((promisedDay.getTime() - todayStart.getTime()) / 86400000);
        const isOverdue = diffDays < 0;
        const isDueToday = diffDays === 0;
        const dateStr = promised.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
        const absDays = Math.abs(diffDays);

        // READY + overdue = client hasn't picked up
        if (job.status === "READY" && isOverdue) {
          const readyDate = job.receivedAt; // use readyAt if available
          const daysSinceReady = job.promisedAt ? absDays : 0;
          return (
            <div className="bg-purple-600 text-white rounded-xl px-3 py-2 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">📞 Not picked up — {absDays} day{absDays > 1 ? "s" : ""} past due</span>
                <span className="text-sm font-bold">Due: {dateStr}</span>
              </div>
            </div>
          );
        }

        // READY + due today = ready for pickup today
        if (job.status === "READY" && isDueToday) {
          return (
            <div className="bg-green-600 text-white rounded-xl px-3 py-2 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">✅ Ready — pickup due today</span>
                <span className="text-sm font-bold">{dateStr}</span>
              </div>
            </div>
          );
        }

        // Pending/Hold + overdue = work not done, past deadline
        if (isOverdue) {
          return (
            <div className="bg-red-600 text-white rounded-xl px-3 py-2 mb-2 animate-pulse">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">🚨 OVERDUE by {absDays} day{absDays > 1 ? "s" : ""}</span>
                <span className="text-sm font-bold">Due: {dateStr}</span>
              </div>
            </div>
          );
        }
        if (isDueToday) {
          return (
            <div className="bg-orange-500 text-white rounded-xl px-3 py-2 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black">⚠️ DUE TODAY</span>
                <span className="text-sm font-bold">{dateStr}</span>
              </div>
            </div>
          );
        }
        return (
          <div className="bg-blue-50 rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-blue-700">📅 Due: {dateStr}</span>
            <span className="text-xs text-blue-500">{diffDays} day{diffDays > 1 ? "s" : ""} left</span>
          </div>
        );
      })()}

      {/* Amount — prominent display */}
      {job.amount != null && (
        <div className="bg-green-50 rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-green-700">💰 Payable</span>
          <span className="text-lg font-black text-green-800">₹{job.amount.toLocaleString("en-IN")}</span>
        </div>
      )}

      {/* Bottom row: mechanic + time */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-2">
          {job.mechanic ? (
            <span className="bg-gray-100 px-2 py-1 rounded-full">
              {job.mechanic.emoji} {job.mechanic.name}
            </span>
          ) : (
            <span className="bg-red-50 text-red-500 px-2 py-1 rounded-full">❓ Unassigned</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-gray-400 text-xs">{timeSince(job.receivedAt)}</div>
          <div className="text-gray-400 text-[10px]">
            {new Date(job.receivedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })}{" "}
            {new Date(job.receivedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
          </div>
        </div>
      </div>

      {/* Bill number — shown when billing has entered it */}
      {job.zohoInvoiceId && job.status === "READY" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-green-600">🧾 Zoho Bill</div>
            <div className="text-green-800 font-mono font-bold text-base">{job.zohoInvoiceId}</div>
          </div>
          <span className="text-green-600 text-xs font-bold bg-green-100 px-2 py-1 rounded-full">BILLED</span>
        </div>
      )}

      {/* After-service photos */}
      {job.afterPhotos && job.afterPhotos.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-bold text-purple-700 mb-1">📸 After Service Photos</div>
          <BlobPhotos jobId={job.id} count={job.afterPhotos.length} large={largePhotos} onRefresh={onRefresh} photoType="after" />
        </div>
      )}

      {/* Upload after-service photo — for paid service active jobs */}
      {showActions && ["RSVC", "SND", "ECYC"].includes(job.jobType) && job.status !== "DELIVERED" && (
        <AfterPhotoUpload jobId={job.id} afterCount={job.afterPhotos?.length || 0} onDone={onRefresh} />
      )}

      {/* Action buttons — for non-DELIVERED transitions */}
      {showActions && nextStatuses.length > 0 && onStatusChange && (
        <div className="flex gap-2 mt-3">
          {nextStatuses
            .filter((s) => s !== "DELIVERED") // DELIVERED handled by review flow below
            .filter((s) => s !== "RECEIVED" || (showUndo && job.status === "READY")) // Undo only for managers
            .map((next) => {
              const nextConfig = JOB_STATUS[next as keyof typeof JOB_STATUS];
              return (
                <button
                  key={next}
                  onClick={() => onStatusChange(job.id, next)}
                  className={`tap-target flex-1 ${nextConfig?.color} text-white font-bold py-3 rounded-xl text-lg active:scale-95 transition-transform`}
                >
                  {nextConfig?.emoji} {nextConfig?.label}
                </button>
              );
            })}
        </div>
      )}

      {/* Add Parts button for active jobs — including READY for walk-in spares */}
      {showActions && onAddParts && job.status !== "DELIVERED" && (
        <button
          onClick={() => onAddParts(job.id, job.amount)}
          className="w-full mt-2 bg-orange-50 text-orange-700 font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-transform border border-orange-200"
        >
          🔩 Add Parts / Update Bill
        </button>
      )}

      {/* Staff notes for active jobs */}
      {showActions && !hideDeliverFlow && job.status !== "DELIVERED" && (
        <JobNotes jobId={job.id} notes={job.notes || ""} />
      )}

      {/* Show saved notes read-only for mechanics */}
      {job.notes && hideDeliverFlow && (
        <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl p-2.5">
          <div className="text-xs font-bold text-yellow-700 mb-0.5">📝 Notes</div>
          <div className="text-sm text-yellow-800">{job.notes}</div>
        </div>
      )}

      {/* Pickup reminder for READY jobs sitting 3+ days */}
      {job.status === "READY" && !hideDeliverFlow && (() => {
        if (!job.promisedAt && !statusConfig) return null;
        const readyTime = job.promisedAt ? new Date(job.promisedAt).getTime() : new Date(job.receivedAt).getTime();
        const daysSince = Math.floor((Date.now() - readyTime) / 86400000);
        if (daysSince < 3 || job.customer.phone === "0000000000") return null;
        return (
          <button
            onClick={() => {
              const url = getPickupReminderUrl(job.customer.phone, job.customer.name, job.tokenNumber, daysSince, readyBikeCount || 40);
              if (url) window.open(url, "_blank");
            }}
            className="w-full mt-2 bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-transform animate-pulse"
          >
            📢 Send Pickup Reminder ({daysSince} days waiting)
          </button>
        );
      })()}

      {/* Review + Deliver flow for READY jobs — hidden for mechanics */}
      {job.status === "READY" && showActions && onRefresh && !hideDeliverFlow && (
        <ReviewAndDeliver job={job} onRefresh={onRefresh} />
      )}

      {/* Mechanic sees a message instead */}
      {job.status === "READY" && hideDeliverFlow && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-sm font-medium text-green-700">✅ Marked Ready — staff will handle delivery</p>
        </div>
      )}

      {/* Review link for delivered jobs */}
      {job.status === "DELIVERED" && !hideDeliverFlow && (
        <div className="mt-3">
          <button
            onClick={() => {
              const reviewUrl = `${window.location.origin}/review/${job.tokenNumber}`;
              const msg = `Hi ${job.customer.name}! 🚲 Your bike service (${job.tokenNumber}) is complete. Please leave a review: ${reviewUrl}`;
              const waUrl = `https://wa.me/91${job.customer.phone}?text=${encodeURIComponent(msg)}`;
              window.open(waUrl, "_blank");
            }}
            className="w-full bg-green-100 text-green-700 font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-transform"
          >
            📱 Send Review Link via WhatsApp
          </button>
        </div>
      )}
    </div>
  );
}

// Fullscreen image viewer with pinch-to-zoom on mobile
function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const startDist = { current: 0 };
  const startScale = { current: 1 };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    // Temporarily allow zoom on the viewport
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta?.getAttribute("content") || "";
    meta?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes");
    return () => {
      document.body.style.overflow = "";
      meta?.setAttribute("content", original);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      startDist.current = Math.sqrt(dx * dx + dy * dy);
      startScale.current = scale;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && startDist.current > 0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const newScale = Math.min(5, Math.max(1, startScale.current * (dist / startDist.current)));
      setScale(newScale);
    }
  };

  const handleTouchEnd = () => {
    startDist.current = 0;
  };

  return (
    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
      {/* Close button — always on top */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 z-[110]">
        <div className="flex items-center gap-3">
          <span className="text-white/50 text-xs">Pinch to zoom · Double-tap</span>
          {scale > 1 && (
            <button onPointerDown={(e) => { e.stopPropagation(); setScale(1); }} className="text-white/70 text-xs font-bold bg-white/10 px-2 py-1 rounded-full">Reset</button>
          )}
        </div>
        <button
          onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
          className="bg-white/30 text-white w-12 h-12 rounded-full text-xl font-bold"
        >
          ✕
        </button>
      </div>
      <div
        className="flex-1 overflow-hidden flex items-center justify-center"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={url}
          alt="Full size"
          className="object-contain transition-transform duration-100"
          style={{ transform: `scale(${scale})`, transformOrigin: "center center", maxWidth: "100%", maxHeight: "100%" }}
          onDoubleClick={() => setScale(scale > 1 ? 1 : 3)}
        />
      </div>
    </div>
  );
}

// Private blob photo loader — fetches temporary download URLs with delete support
function BlobPhotos({ jobId, count, large = false, onRefresh, photoType = "inward" }: { jobId: string; count: number; large?: boolean; onRefresh?: () => void; photoType?: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [viewingUrl, setViewingUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/services/upload?jobId=${jobId}&type=${photoType}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setUrls(data.photos || []);
        }
      })
      .finally(() => setLoaded(true));
  }, [jobId, count]);

  const handleDelete = async (index: number) => {
    if (!confirm("Delete this photo?")) return;
    setDeleting(index);
    try {
      const res = await fetch("/api/services/upload/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, index, type: photoType }),
      });
      if (res.ok) {
        const data = await res.json();
        setUrls(data.photos || []);
        if (onRefresh) onRefresh();
      }
    } catch { /* ignore */ }
    setDeleting(null);
  };

  if (!loaded) {
    return (
      <div className={large ? "mb-3" : "flex gap-2 mb-2"}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={large ? "w-[75vw] h-[56vw] rounded-xl bg-gray-100 animate-pulse mb-2" : "w-16 h-16 rounded-xl bg-gray-100 animate-pulse flex-shrink-0"} />
        ))}
      </div>
    );
  }

  if (urls.length === 0) return null;

  if (large) {
    return (
      <div className="mb-3">
        {viewingUrl && <PhotoViewer url={viewingUrl} onClose={() => setViewingUrl(null)} />}
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {urls.map((url, i) => (
            <div key={i} className="relative flex-shrink-0 snap-center">
              <img
                src={url}
                alt={`Bike ${i + 1}`}
                className="w-[80vw] rounded-xl object-cover border border-gray-200 cursor-zoom-in"
                onClick={() => setViewingUrl(url)}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(i); }}
                disabled={deleting === i}
                className="absolute top-2 right-2 bg-red-500 text-white w-7 h-7 rounded-full text-xs font-bold shadow-lg active:scale-90 transition-transform disabled:opacity-50"
              >
                {deleting === i ? "..." : "✕"}
              </button>
            </div>
          ))}
        </div>
        {urls.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-1.5">
            {urls.map((_, i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-gray-300" />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-2 overflow-x-auto hide-scrollbar">
      {viewingUrl && <PhotoViewer url={viewingUrl} onClose={() => setViewingUrl(null)} />}
      {urls.map((url, i) => (
        <div key={i} className="relative flex-shrink-0">
          <img src={url} alt={`Bike ${i + 1}`} className="w-16 h-16 rounded-xl object-cover border border-gray-200 cursor-zoom-in" onClick={() => setViewingUrl(url)} />
          <button
            onClick={() => handleDelete(i)}
            disabled={deleting === i}
            className="absolute -top-1 -right-1 bg-red-500 text-white w-5 h-5 rounded-full text-[10px] font-bold shadow active:scale-90 transition-transform disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// Deliver flow: Enter invoice number → match amount → QR + review → deliver
function ReviewAndDeliver({
  job,
  onRefresh,
}: {
  job: Job;
  onRefresh: () => void;
}) {
  // Skip Zoho for walk-in customers (QFX, free service etc with no real phone)
  const isWalkIn = job.customer.phone === "0000000000";
  const isQuickFix = job.jobType === "QFX";
  const hasBill = !!job.zohoInvoiceId;
  // QFX jobs skip straight to review (no Zoho check needed)
  const [step, setStep] = useState<"ask" | "zoho" | "verifying" | "paid" | "unpaid" | "review" | "delivered">(isQuickFix ? "review" : "ask");
  const [rating, setRating] = useState(0); // 0 = not yet rated — avoids auto-5★ placeholder reviews
  const [googleReview, setGoogleReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [zohoInvoiceId, setZohoInvoiceId] = useState<string | null>(job.zohoInvoiceId || null);
  const [verifyResult, setVerifyResult] = useState<{ isPaid: boolean; total: number; balance: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-verify payment when bill exists
  const verifyPayment = async () => {
    setStep("verifying");
    setError(null);
    try {
      const res = await fetch(`/api/services/zoho?invoiceNumber=${encodeURIComponent(job.zohoInvoiceId!)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.invoice) {
          setVerifyResult(data.invoice);
          setStep(data.invoice.isPaid ? "paid" : "unpaid");
          return;
        }
      }
      // If Zoho check fails, fall back to manual
      setError(`Zoho check failed (${res.status}) — enter manually`);
      setStep("zoho");
    } catch (e) {
      setError(`Zoho connection error: ${errorMessage(e)}`);
      setStep("zoho");
    }
  };

  const submitReviewAndDeliver = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Save review
      const revRes = await fetch("/api/services/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenNumber: job.tokenNumber,
          rating,
          googleReview,
        }),
      });
      if (!revRes.ok) {
        const errData = await revRes.json().catch(() => ({ error: "Review save failed" }));
        // "Already reviewed" is fine — continue to delivery
        if (errData.error !== "Already reviewed") {
          setError(errData.error || `Review save failed (${revRes.status})`);
          setSubmitting(false);
          return;
        }
      }
      // Mark delivered with Zoho invoice
      const delRes = await fetch("/api/services/jobs/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          newStatus: "DELIVERED",
          zohoInvoiceId: zohoInvoiceId || undefined,
        }),
      });
      if (delRes.ok) {
        // Delivered. Show a success step with an explicit "send message" button
        // instead of auto-hijacking the screen with a WhatsApp tab on every delivery.
        setSubmitting(false);
        setStep("delivered");
        return;
      } else {
        const err = await delRes.json().catch(() => ({ error: "Delivery update failed" }));
        setError(err.error || `Delivery update failed (${delRes.status})`);
        setSubmitting(false);
        return;
      }
    } catch (e) {
      setError(`Network error: ${errorMessage(e)}`);
      setSubmitting(false);
      return;
    }
  };

  // Send the delivery confirmation WhatsApp on demand (was previously auto-opened on every delivery)
  const sendDeliveryWhatsApp = () => {
    const waUrl = getWhatsAppUrl(job.customer.phone, "DELIVERED", job.customer.name, job.tokenNumber);
    if (waUrl) {
      window.open(waUrl, "_blank");
      fetch("/api/services/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          tokenNumber: job.tokenNumber,
          customerPhone: job.customer.phone,
          customerName: job.customer.name,
          messageType: "DELIVERED",
        }),
      }).catch(() => {});
    }
    onRefresh();
  };

  const errorBanner = error ? (
    <div className="mt-2 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
      <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
      <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
    </div>
  ) : null;

  if (step === "ask") {
    return (
      <div className="mt-3">
        {errorBanner}
        <button
          onClick={() => {
            if (isWalkIn) setStep("review");
            else if (hasBill) verifyPayment();
            else setStep("zoho");
          }}
          className="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-lg active:scale-95 transition-transform"
        >
          ✅ Ready to Deliver
        </button>
      </div>
    );
  }

  if (step === "verifying") {
    return (
      <div className="mt-3 text-center py-6">
        <div className="text-3xl animate-bounce mb-2">🔍</div>
        <p className="text-gray-500 font-medium">Checking payment in Zoho...</p>
      </div>
    );
  }

  if (step === "paid") {
    return (
      <div className="mt-3">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-base text-green-800">{job.zohoInvoiceId}</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✅ PAID</span>
          </div>
          <div className="text-green-700 text-lg font-bold">
            ₹{verifyResult?.total?.toLocaleString("en-IN")}
          </div>
        </div>
        <button
          onClick={() => setStep("review")}
          className="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-lg active:scale-95 transition-transform"
        >
          ✅ Payment Confirmed — Continue
        </button>
        <button onClick={() => setStep("ask")} className="w-full mt-2 text-gray-400 text-sm font-medium py-2">
          Cancel
        </button>
      </div>
    );
  }

  if (step === "unpaid") {
    return (
      <div className="mt-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-bold text-base text-red-800">{job.zohoInvoiceId}</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">❌ {verifyResult?.status?.toUpperCase()}</span>
          </div>
          <div className="text-red-700 text-lg font-bold">
            ₹{verifyResult?.balance?.toLocaleString("en-IN")} due
          </div>
        </div>
        <p className="text-red-600 text-sm font-medium text-center mb-3">
          Payment not received yet. Ask customer to pay first.
        </p>
        <button
          onClick={() => verifyPayment()}
          className="w-full bg-gray-800 text-white font-bold py-3 rounded-xl text-base active:scale-95 transition-transform"
        >
          🔄 Check Again
        </button>
        <button onClick={() => setStep("ask")} className="w-full mt-2 text-gray-400 text-sm font-medium py-2">
          Cancel
        </button>
      </div>
    );
  }

  if (step === "zoho") {
    return (
      <div className="mt-3">
        <ZohoInvoiceCheck
          jobAmount={job.amount}
          onMatched={(invoiceId) => {
            setZohoInvoiceId(invoiceId);
            setStep("review");
          }}
        />
        <button
          onClick={() => setStep("ask")}
          className="w-full mt-2 text-gray-400 text-sm font-medium py-2"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (step === "delivered") {
    return (
      <div className="mt-3">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3 text-center">
          <div className="text-3xl mb-1">🏁</div>
          <p className="font-bold text-green-800">Delivered!</p>
        </div>
        {!isWalkIn && job.customer.phone !== "0000000000" && (
          <button
            onClick={sendDeliveryWhatsApp}
            className="w-full bg-green-100 text-green-700 font-bold py-3 rounded-xl text-base mb-2 active:scale-95 transition-transform"
          >
            📱 Send WhatsApp confirmation
          </button>
        )}
        <button
          onClick={onRefresh}
          className="w-full bg-gray-800 text-white font-bold py-3 rounded-xl text-base active:scale-95 transition-transform"
        >
          Done
        </button>
      </div>
    );
  }

  // Review step — full-screen QR + confirmation
  return (
    <div className="mt-3">
      {errorBanner}
      {/* QR Code — maximum size */}
      <div className="bg-white rounded-2xl p-2 mb-3 border border-gray-200">
        <img
          src="/google-review-qr-cropped.png"
          alt="Google Review QR Code"
          className="w-full rounded-xl"
        />
      </div>

      {/* Star rating */}
      <div className="flex justify-center gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => setRating(star)}
            className="text-3xl active:scale-95 transition-transform"
          >
            {star <= rating ? "⭐" : "☆"}
          </button>
        ))}
      </div>

      {/* Google review confirmation */}
      <label className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-200 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={googleReview}
          onChange={(e) => setGoogleReview(e.target.checked)}
          className="w-5 h-5 rounded accent-green-600"
        />
        <span className="font-semibold text-gray-800 text-sm">Customer gave Google Review</span>
      </label>

      {rating === 0 && (
        <p className="text-center text-xs text-gray-400 mb-2">Tap a star to rate before delivering</p>
      )}
      <button
        onClick={submitReviewAndDeliver}
        disabled={submitting || rating === 0}
        className="w-full bg-green-500 text-white font-bold py-3 rounded-xl text-base disabled:bg-gray-300 active:scale-95 transition-transform"
      >
        {submitting ? "Saving..." : "✅ Mark Delivered"}
      </button>

      <button
        onClick={() => setStep("ask")}
        className="w-full mt-2 text-gray-400 text-sm font-medium py-2"
      >
        Back
      </button>
    </div>
  );
}

// Zoho invoice checker — manual invoice number entry only, with amount matching
type Invoice = {
  id: string;
  number: string;
  customerName: string;
  date: string;
  total: number;
  balance: number;
  status: string;
  isPaid: boolean;
};

// After-service photo upload button
function AfterPhotoUpload({ jobId, afterCount, onDone }: { jobId: string; afterCount: number; onDone?: () => void }) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    // Compress
    const compressed = await new Promise<File>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1200;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          resolve(new File([blob!], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.85);
      };
      img.src = URL.createObjectURL(file);
    });

    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("jobId", jobId);
    formData.append("type", "after");
    try {
      await fetch("/api/services/upload", { method: "POST", body: formData });
      if (onDone) onDone();
    } catch { /* ignore */ }
    setUploading(false);
  };

  if (afterCount >= 7) return null;

  return (
    <div className="mt-2">
      <input
        id={`after-photo-${jobId}`}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <input
        id={`after-gallery-${jobId}`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => document.getElementById(`after-photo-${jobId}`)?.click()}
          disabled={uploading}
          className="flex-1 bg-purple-50 text-purple-700 font-bold py-2 rounded-xl text-sm active:scale-95 transition-transform border border-purple-200 disabled:opacity-50"
        >
          {uploading ? "⏳ Uploading..." : "📸 After Photo"}
        </button>
        <button
          onClick={() => document.getElementById(`after-gallery-${jobId}`)?.click()}
          disabled={uploading}
          className="flex-1 bg-purple-50 text-purple-700 font-bold py-2 rounded-xl text-sm active:scale-95 transition-transform border border-purple-200 disabled:opacity-50"
        >
          🖼️ Gallery
        </button>
      </div>
    </div>
  );
}

// Inline notes for staff
function JobNotes({ jobId, notes: initial }: { jobId: string; notes: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/services/jobs/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, notes: text }),
    }).catch(() => {});
    setSaving(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full mt-2 bg-yellow-50 text-yellow-700 font-bold py-2 rounded-xl text-sm active:scale-95 transition-transform border border-yellow-200">
        📝 {initial ? "View / Edit Notes" : "Add Notes"}
      </button>
    );
  }

  return (
    <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
      <div className="text-xs font-bold text-yellow-700 mb-1">📝 Notes</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Client didn't answer, will call back..."
        rows={2}
        className="w-full border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:border-yellow-500 focus:outline-none resize-none mb-2"
      />
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex-1 bg-yellow-500 text-white font-bold py-2 rounded-lg text-sm disabled:bg-gray-300">
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={() => { setText(initial); setOpen(false); }}
          className="px-4 bg-gray-100 text-gray-600 font-bold py-2 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ZohoInvoiceCheck({
  jobAmount,
  onMatched,
}: {
  jobAmount: number | null;
  onMatched: (invoiceId: string) => void;
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNum, setInvoiceNum] = useState("");
  const [amountMismatch, setAmountMismatch] = useState(false);

  const searchByNumber = async () => {
    if (!invoiceNum.trim()) return;
    setLoading(true);
    setError(null);
    setInvoice(null);
    setAmountMismatch(false);

    const res = await fetch(
      `/api/services/zoho?invoiceNumber=${encodeURIComponent(invoiceNum.trim())}`
    );

    if (res.ok) {
      const data = await res.json();
      if (data.invoice) {
        setInvoice(data.invoice);
        // Check amount match
        if (jobAmount != null && Math.abs(data.invoice.total - jobAmount) > 1) {
          setAmountMismatch(true);
        }
      } else {
        setError("Invoice not found");
      }
    } else {
      setError("Invoice not found");
    }
    setLoading(false);
  };

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="text-sm font-bold text-gray-700 mb-3">🧾 Enter Zoho Invoice Number</div>

      {/* Invoice number input */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={invoiceNum}
          onChange={(e) => setInvoiceNum(e.target.value)}
          placeholder="e.g. INV/25/017869"
          autoFocus
          className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-base font-medium focus:border-gray-800 focus:outline-none"
          onKeyDown={(e) => e.key === "Enter" && searchByNumber()}
        />
        <button
          onClick={searchByNumber}
          disabled={loading || !invoiceNum.trim()}
          className="bg-gray-800 text-white font-bold px-5 py-3 rounded-xl text-base active:scale-95 transition-transform disabled:bg-gray-300"
        >
          {loading ? "..." : "🔍"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-500 font-medium text-center py-2 bg-red-50 rounded-lg mb-2">
          {error}
        </div>
      )}

      {/* Invoice result */}
      {invoice && (
        <div className="bg-white rounded-xl p-4 border border-gray-100">
          <div className="flex justify-between items-center mb-1">
            <span className="font-bold text-base">{invoice.number}</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                invoice.isPaid
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {invoice.isPaid ? "✅ PAID" : "❌ UNPAID"}
            </span>
          </div>
          <div className="text-xs text-gray-500 mb-1">
            {invoice.customerName} • {invoice.date}
          </div>
          <div className="text-lg font-bold text-gray-800">
            ₹{invoice.total.toLocaleString("en-IN")}
          </div>

          {/* Amount mismatch warning — highly visible */}
          {amountMismatch && (
            <div className="mt-3 bg-red-600 text-white rounded-xl p-4 animate-pulse">
              <div className="text-center mb-2">
                <span className="text-2xl font-black">⚠️ AMOUNT MISMATCH ⚠️</span>
              </div>
              <div className="flex justify-between items-center bg-red-700 rounded-lg p-3">
                <div className="text-center flex-1">
                  <div className="text-xs font-medium opacity-80">Job Quote</div>
                  <div className="text-xl font-black">₹{jobAmount?.toLocaleString("en-IN")}</div>
                </div>
                <div className="text-2xl font-bold px-2">≠</div>
                <div className="text-center flex-1">
                  <div className="text-xs font-medium opacity-80">Invoice</div>
                  <div className="text-xl font-black">₹{invoice.total.toLocaleString("en-IN")}</div>
                </div>
              </div>
              <div className="text-center text-sm font-bold mt-2">
                Difference: ₹{Math.abs(invoice.total - (jobAmount || 0)).toLocaleString("en-IN")}
              </div>
            </div>
          )}

          {/* Not paid warning */}
          {!invoice.isPaid && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-sm text-red-600 font-medium">
              ❌ Invoice is unpaid (₹{invoice.balance.toLocaleString("en-IN")} due)
            </div>
          )}

          {invoice.isPaid && (
            <button
              onClick={() => onMatched(invoice.id)}
              className={`w-full mt-3 text-white font-bold py-3 rounded-xl text-base active:scale-95 transition-transform ${amountMismatch ? "bg-orange-600" : "bg-green-500"}`}
            >
              {amountMismatch ? "⚠️ MISMATCH — Continue Anyway" : "✅ Bill Matched — Continue"}
            </button>
          )}
        </div>
      )}

      {/* Job quote reference */}
      {jobAmount != null && (
        <div className="mt-3 text-center text-sm text-gray-400">
          Job quote: ₹{jobAmount.toLocaleString("en-IN")}
        </div>
      )}
    </div>
  );
}
