"use client";

// Step 5 — the receipt photo (plan Part D). One image per expense, from the camera or the
// gallery, uploaded HERE rather than at Submit so the review screen shows a real thumbnail
// and a slow upload never sits inside the batch transaction.
import { useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { uploadMedia } from "@/lib/media-upload";
import { compressImageFull } from "@/lib/media-compress";
import { createLogger } from "@/lib/logger";

const log = createLogger("expenses:upload");

// compressImageFull hands the original back untouched when the browser cannot decode it
// (HEIC, for one) or when re-encoding did not shrink it. Its own byte target is 220 KB, so an
// untouched file above that is a real fallback worth a warning; a small file that was simply
// skipped is not.
const COMPRESS_TARGET_BYTES = 220 * 1024;

interface PhotoStepProps {
  value: string | null;
  onChange: (url: string | null) => void;
  onNext: () => void;
  /** Changes the forward button's wording: a row picked from review is being saved back. */
  editing: boolean;
}

export function PhotoStep({ value, onChange, onNext, editing }: PhotoStepProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ""; // so the same file can be picked again after a failure
    if (!file) return;

    // The server enforces the same rule (upload-policy.ts); this is the message the person
    // sees before a round trip.
    if (!file.type.startsWith("image/")) {
      setError("Only a photo can be attached.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const { blob, ext, contentType } = await compressImageFull(file);
      if (blob === file && file.size > COMPRESS_TARGET_BYTES) {
        log.warn("compression fell back to the original", { ext, bytes: file.size });
      }
      const key = `expenses/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      log.debug("uploading receipt", { ext, bytes: blob.size });
      const url = await uploadMedia(blob, key, contentType || file.type || "image/jpeg");
      // A second pick replaces the first in client state. The first object stays in the
      // bucket until a bucket-wide cleanup exists — plan §5, deliberately out of scope.
      onChange(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed. Check your connection and try again.";
      log.error("upload failed", { bytes: file.size, message });
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-1">Receipt photo</p>
      <p className="text-xs text-slate-500 mb-3">Optional. One photo of the bill or receipt.</p>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      {value ? (
        <div className="relative w-40 h-40 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Receipt" className="w-40 h-40 object-cover rounded-xl border border-slate-200" />
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={uploading}
            aria-label="Remove photo"
            className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="w-full h-28 mb-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
          {uploading ? (
            <span className="flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</span>
          ) : (
            "No photo attached"
          )}
        </div>
      )}

      {/* The camera input forces the camera; the gallery input (no capture) opens the library.
          Neither carries `multiple`: one photo per expense (Q2c, Q4a). */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePick} className="hidden" />
      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading}
          className="min-h-[48px]"
        >
          <Camera className="h-4 w-4 mr-1.5" /> {value ? "Retake" : "Take photo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => galleryInputRef.current?.click()}
          disabled={uploading}
          className="min-h-[48px]"
        >
          <ImageIcon className="h-4 w-4 mr-1.5" /> {value ? "Choose another" : "From gallery"}
        </Button>
      </div>

      <Button type="button" size="lg" onClick={onNext} disabled={uploading} className="w-full min-h-[48px] mt-6">
        {editing ? "Save changes" : value ? "Continue" : "Continue without photo"}
      </Button>
    </div>
  );
}
