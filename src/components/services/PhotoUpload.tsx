"use client";

import { useState, useEffect, useRef } from "react";

export default function PhotoUpload({
  jobId,
  photos,
  onUpload,
}: {
  jobId: string;
  photos: string[];
  onUpload: (photos: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [displayUrls, setDisplayUrls] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch viewable download URLs whenever photos change
  useEffect(() => {
    if (photos.length === 0) {
      setDisplayUrls([]);
      return;
    }
    fetch(`/api/services/upload?jobId=${jobId}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setDisplayUrls(data.photos || []);
        }
      });
  }, [jobId, photos.length]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("jobId", jobId);

    try {
      const res = await fetch("/api/services/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        onUpload(data.photos);
      } else {
        const data = await res.json().catch(() => ({ error: "Upload failed" }));
        setError(data.error || "Upload failed");
      }
    } catch {
      setError("Network error — try again");
    }
    setUploading(false);
  };

  return (
    <div>
      {/* Photo grid */}
      {displayUrls.length > 0 && (
        <div className="flex gap-2 mb-2 overflow-x-auto hide-scrollbar">
          {displayUrls.map((url, i) => (
            <img
              key={i}
              src={url}
              alt={`Bike photo ${i + 1}`}
              className="w-20 h-20 rounded-xl object-cover flex-shrink-0 border border-gray-200"
            />
          ))}
        </div>
      )}

      {/* Upload button */}
      {photos.length < 7 && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {uploading ? (
              <>⏳ Uploading...</>
            ) : (
              <>📷 {photos.length === 0 ? "Add Bike Photo" : "Add More"}</>
            )}
          </button>
          {error && (
            <p className="text-red-500 text-sm mt-1">❌ {error}</p>
          )}
        </>
      )}
    </div>
  );
}
