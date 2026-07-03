"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, X, Image as ImageIcon, Search, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { uploadMedia } from "@/lib/supabase";

const MAX_VIDEO_INPUT_BYTES = 500 * 1024 * 1024; // accept big originals; we compress before upload
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|3gp|quicktime)(\?|$)/i.test(url);
}

// Compress a video in the browser: downscale to ~720p and re-encode at a low bitrate so a
// 200–300MB phone clip becomes ~tens of MB. Audio is captured via Web Audio (routed only to the
// recorder, not the speakers) so processing is silent. Real-time (reports progress 0..1).
// Throws on unsupported browsers (e.g. some iOS Safari) so the caller can fall back to the original.
async function compressVideo(
  file: File,
  onProgress?: (p: number) => void
): Promise<{ blob: Blob; ext: string }> {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AudioCtx = w.AudioContext || w.webkitAudioContext;
  const canvasProto = HTMLCanvasElement.prototype as unknown as { captureStream?: unknown };
  if (typeof MediaRecorder === "undefined" || typeof canvasProto.captureStream !== "function" || !AudioCtx) {
    throw new Error("Video compression isn't supported on this browser");
  }

  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  video.muted = false;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read this video"));
  });

  const srcW = video.videoWidth || 1280;
  const srcH = video.videoHeight || 720;
  const MAX_EDGE = 1280; // ~720p on the long edge
  let tw = srcW, th = srcH;
  const longest = Math.max(srcW, srcH);
  if (longest > MAX_EDGE) { const s = MAX_EDGE / longest; tw = Math.round(srcW * s); th = Math.round(srcH * s); }
  tw -= tw % 2; th -= th % 2; // even dimensions
  tw = Math.max(2, tw); th = Math.max(2, th);

  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const cStream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);

  // Audio: tap the element's audio into the recorder WITHOUT connecting to the speakers.
  const actx = new AudioCtx();
  const srcNode = actx.createMediaElementSource(video);
  const dest = actx.createMediaStreamDestination();
  srcNode.connect(dest);
  dest.stream.getAudioTracks().forEach((t) => cStream.addTrack(t));
  try { await actx.resume(); } catch { /* ignore */ }

  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || "";
  const recorder = new MediaRecorder(cStream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 1_000_000, // ~1 Mbps → roughly 7–8 MB per minute
    audioBitsPerSecond: 96_000,
  });
  const outType = recorder.mimeType || mimeType || "video/webm";
  const ext = outType.includes("mp4") ? "mp4" : "webm";

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: outType }));
  });

  let raf = 0;
  const draw = () => {
    ctx.drawImage(video, 0, 0, tw, th);
    if (video.duration && onProgress) onProgress(Math.min(0.99, video.currentTime / video.duration));
    raf = requestAnimationFrame(draw);
  };

  recorder.start(1000);
  await video.play();
  draw();

  await new Promise<void>((resolve) => { video.onended = () => resolve(); });
  cancelAnimationFrame(raf);
  if (recorder.state !== "inactive") recorder.stop();
  const blob = await finished;
  onProgress?.(1);
  try { srcNode.disconnect(); await actx.close(); } catch { /* ignore */ }
  URL.revokeObjectURL(video.src);

  // Never upload something bigger than the original.
  if (blob.size === 0 || blob.size >= file.size) {
    return { blob: file, ext: (file.name.split(".").pop() || "mp4").toLowerCase() };
  }
  return { blob, ext };
}

interface VendorOption {
  id: string;
  name: string;
  code: string;
}
interface BillOption {
  id: string;
  billNo: string;
  amount: number;
}

const ISSUE_TYPES = [
  "QUALITY",
  "SHORTAGE",
  "DAMAGE",
  "WRONG_ITEM",
  "BILLING_ERROR",
  "DELIVERY_DELAY",
  "OTHER",
] as const;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const ISSUE_TYPE_COLORS: Record<string, string> = {
  QUALITY: "bg-red-100 text-red-700 border-red-200",
  SHORTAGE: "bg-orange-100 text-orange-700 border-orange-200",
  DAMAGE: "bg-red-100 text-red-700 border-red-200",
  WRONG_ITEM: "bg-purple-100 text-purple-700 border-purple-200",
  BILLING_ERROR: "bg-blue-100 text-blue-700 border-blue-200",
  DELIVERY_DELAY: "bg-yellow-100 text-yellow-700 border-yellow-200",
  OTHER: "bg-slate-100 text-slate-700 border-slate-200",
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700 border-slate-200",
  MEDIUM: "bg-blue-100 text-blue-700 border-blue-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  URGENT: "bg-red-100 text-red-700 border-red-200",
};

// Downscale + re-encode an image to JPEG so phone-camera photos (often 5–12 MB) land well under
// the upload limit. Falls back to the original file if the browser can't decode it (e.g. HEIC).
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < 900 * 1024) return file; // already small enough
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    const MAX = 1600;
    let { width, height } = img;
    if (width > MAX || height > MAX) {
      const s = MAX / Math.max(width, height);
      width = Math.round(width * s);
      height = Math.round(height * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file; // couldn't decode (e.g. HEIC) — upload the original and let the server validate
  }
}

export default function NewVendorIssuePage() {
  const router = useRouter();

  const [issueSource, setIssueSource] = useState<"VENDOR" | "CLIENT">("VENDOR");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [bills, setBills] = useState<BillOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [issueType, setIssueType] = useState<string>("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [description, setDescription] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [billId, setBillId] = useState("");
  const [suggestedResolution, setSuggestedResolution] = useState("");
  const [docLink, setDocLink] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [compressPct, setCompressPct] = useState<number | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const vendorRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Zoho client search
  const [zohoSearching, setZohoSearching] = useState(false);
  const [zohoResults, setZohoResults] = useState<Array<{ id: string; name: string; phone: string | null; email: string | null; city: string | null }>>([]);
  const [showZohoResults, setShowZohoResults] = useState(false);

  const searchZohoClient = async () => {
    if (clientName.trim().length < 2) return;
    setZohoSearching(true);
    try {
      const res = await fetch(`/api/zoho/search-contacts?q=${encodeURIComponent(clientName.trim())}`);
      const json = await res.json();
      if (json.success) {
        setZohoResults(json.data || []);
        setShowZohoResults(true);
      }
    } catch { /* ignore */ }
    setZohoSearching(false);
  };

  useEffect(() => {
    fetch("/api/vendors?limit=100")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setVendors(res.data);
      })
      .catch(() => {});
  }, []);

  // Click outside to close vendor dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (vendorRef.current && !vendorRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredVendors = vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
      v.code.toLowerCase().includes(vendorSearch.toLowerCase())
  );

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        try {
          let blob: Blob = file;
          let ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          let contentType = file.type;

          if (isImage) {
            blob = await compressImage(file); // shrink camera photos before upload
            ext = "jpg";
            contentType = "image/jpeg";
          } else if (isVideo) {
            if (file.size > MAX_VIDEO_INPUT_BYTES) {
              setError("Video is too large (max 500MB). Please use a shorter clip.");
              continue;
            }
            // Compress in-browser (downscale + re-encode). Falls back to the original if the
            // device can't compress; if the untouched original is too big to upload, ask to trim.
            try {
              setCompressPct(0);
              const r = await compressVideo(file, (p) => setCompressPct(Math.round(p * 100)));
              blob = r.blob;
              ext = r.ext;
              contentType = blob.type || `video/${ext}`;
            } catch {
              if (file.size > 50 * 1024 * 1024) {
                setError("Couldn't compress this video on your device — please upload a shorter clip (under ~50MB).");
                setCompressPct(null);
                continue;
              }
              if (!ext) ext = "mp4";
            } finally {
              setCompressPct(null);
            }
          } else {
            setError("Only images and videos can be attached.");
            continue;
          }

          // Upload straight to storage (works for large videos — no serverless body limit).
          const path = `vendor-issues/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const url = await uploadMedia(blob, path, contentType);
          setPhotoUrls((prev) => [...prev, url]);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed. Check your connection and try again.");
        }
      }
    } finally {
      setUploadingPhoto(false);
      input.value = ""; // allow re-selecting the same file
    }
  }

  useEffect(() => {
    if (!vendorId) {
      setBills([]);
      setBillId("");
      return;
    }
    fetch(`/api/bills?vendorId=${vendorId}&limit=50`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setBills(res.data);
      })
      .catch(() => {});
  }, [vendorId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (issueSource === "VENDOR" && !vendorId) return;
    if (issueSource === "CLIENT" && !clientName.trim()) return;
    if (!issueType || !description.trim()) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/vendor-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueSource: issueSource,
          vendorId: issueSource === "VENDOR" ? vendorId : undefined,
          clientName: issueSource === "CLIENT" ? clientName.trim() : undefined,
          clientPhone: issueSource === "CLIENT" ? (clientPhone.trim() || undefined) : undefined,
          issueType,
          description: description.trim(),
          ticketNo: ticketNo.trim() || undefined,
          priority,
          billId: billId || undefined,
          photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
          suggestedResolution: suggestedResolution.trim() || undefined,
          docLink: docLink.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to create issue");
      router.push("/vendor-issues");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/vendor-issues" className="p-1">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">New Ops Issue</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Issue Source Toggle */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Issue Type</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setIssueSource("VENDOR"); setClientName(""); setClientPhone(""); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                issueSource === "VENDOR" ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-600"
              }`}>
              Brand Issue
            </button>
            <button type="button" onClick={() => { setIssueSource("CLIENT"); setVendorId(""); setVendorSearch(""); setBillId(""); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                issueSource === "CLIENT" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"
              }`}>
              Client Issue
            </button>
          </div>
        </div>

        {/* Client fields (only for CLIENT source) */}
        {issueSource === "CLIENT" && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client Name *</label>
              <div className="flex gap-2">
                <input type="text" placeholder="Customer name..." value={clientName}
                  onChange={(e) => { setClientName(e.target.value); setShowZohoResults(false); }}
                  className="flex h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <button type="button" onClick={searchZohoClient} disabled={zohoSearching || clientName.trim().length < 2}
                  className="h-10 px-3 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 text-xs font-medium disabled:opacity-40 flex items-center gap-1">
                  {zohoSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  Zoho
                </button>
              </div>
              {showZohoResults && (
                <div className="mt-1.5 border rounded-lg bg-white shadow-lg max-h-40 overflow-y-auto">
                  {zohoResults.length === 0 ? (
                    <p className="text-xs text-slate-400 p-3 text-center">No contacts found in Zoho</p>
                  ) : zohoResults.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => {
                        setClientName(c.name);
                        if (c.phone) setClientPhone(c.phone);
                        setShowZohoResults(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-b-0">
                      <p className="font-medium text-slate-800">{c.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {c.phone || "No phone"}{c.city ? ` · ${c.city}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client Phone (optional)</label>
              <input type="tel" placeholder="Phone number..." value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
            </div>
          </>
        )}

        {/* Vendor (searchable) — only for VENDOR source */}
        {issueSource === "VENDOR" && (
        <div ref={vendorRef} className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Brand *
          </label>
          <input
            type="text"
            placeholder="Search brand..."
            value={vendorSearch}
            onChange={(e) => {
              setVendorSearch(e.target.value);
              setShowVendorDropdown(true);
              if (!e.target.value) { setVendorId(""); setBillId(""); }
            }}
            onFocus={() => setShowVendorDropdown(true)}
            className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          {vendorId && (
            <button
              type="button"
              onClick={() => { setVendorId(""); setVendorSearch(""); setBillId(""); }}
              className="absolute right-2 top-8 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {showVendorDropdown && filteredVendors.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredVendors.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setVendorId(v.id);
                    setVendorSearch(`${v.name} (${v.code})`);
                    setShowVendorDropdown(false);
                    setBillId("");
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                    vendorId === v.id ? "bg-slate-100 font-medium" : ""
                  }`}
                >
                  {v.name} <span className="text-slate-400">({v.code})</span>
                </button>
              ))}
            </div>
          )}
          {showVendorDropdown && vendorSearch && filteredVendors.length === 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm text-slate-400">
              No vendors found
            </div>
          )}
        </div>
        )}

        {/* Issue Type */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Issue Type *
          </label>
          <div className="flex flex-wrap gap-2">
            {ISSUE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setIssueType(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  issueType === type
                    ? ISSUE_TYPE_COLORS[type]
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {type.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Priority *
          </label>
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  priority === p
                    ? PRIORITY_COLORS[p]
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Description *
          </label>
          <textarea
            placeholder="Describe the issue in detail..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Ticket Number */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ticket Number (optional)
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Brand's ticket / reference no. (e.g. eMotorad)"
            value={ticketNo}
            onChange={(e) => setTicketNo(e.target.value)}
            className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          <p className="mt-1 text-xs text-slate-400">Shown in the WhatsApp message so the brand can match it to their ticket.</p>
        </div>

        {/* Photos / Videos */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Photos / Videos (optional)
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {photoUrls.map((url, i) => (
              <div key={i} className="relative w-20 h-20">
                {isVideoUrl(url) ? (
                  <video src={url} className="w-20 h-20 object-cover rounded-lg border bg-black" muted playsInline />
                ) : (
                  <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border" />
                )}
                <button
                  type="button"
                  onClick={() => setPhotoUrls((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          {/* Camera input forces the camera; gallery input (no capture) opens the photo/video library. */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoUpload}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handlePhotoUpload}
            className="hidden"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? "Uploading..." : (<><Camera className="w-4 h-4 mr-1" />Take Photo</>)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              <ImageIcon className="w-4 h-4 mr-1" />
              Upload Photo / Video
            </Button>
          </div>
          {compressPct !== null && (
            <div className="mt-2">
              <p className="text-xs text-slate-500 mb-1">Compressing video… {compressPct}% — keep this screen open</p>
              <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${compressPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Suggested Resolution */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Suggested Resolution (optional)
          </label>
          <textarea
            placeholder="What resolution do you suggest?"
            value={suggestedResolution}
            onChange={(e) => setSuggestedResolution(e.target.value)}
            rows={2}
            className="flex w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Document link (optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Document link (optional)
          </label>
          <input
            type="url"
            placeholder="Paste a Drive/Sheet/photo link for the brand to verify…"
            value={docLink}
            onChange={(e) => setDocLink(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>

        {/* Bill (optional, only when vendor selected) */}
        {issueSource === "VENDOR" && vendorId && bills.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Related Bill (optional)
            </label>
            <select
              value={billId}
              onChange={(e) => setBillId(e.target.value)}
              className="flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">No bill</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.billNo}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={(issueSource === "VENDOR" ? !vendorId : !clientName.trim()) || !issueType || !description.trim() || submitting}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {submitting ? "Creating..." : "Create Issue"}
        </Button>
      </form>
    </div>
  );
}
