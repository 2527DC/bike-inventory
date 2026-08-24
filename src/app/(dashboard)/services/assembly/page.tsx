"use client";

import { useEffect, useState, useCallback, useRef } from "react";

const ASSEMBLY_TYPES = [
  { key: "A50", label: "50%", color: "bg-blue-500" },
  { key: "A85", label: "85%", color: "bg-purple-500" },
  { key: "FULL", label: "100%", color: "bg-green-500" },
] as const;

type AssemblyLog = {
  id: string;
  assemblyType: string;
  photos: string[];
  createdAt: string;
  mechanic: { name: string; emoji: string };
};

// Compress image to max 800px wide, JPEG 0.7 quality
function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob!], file.name, { type: "image/jpeg" })),
        "image/jpeg",
        0.85,
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

export default function AssemblyPage() {
  const [logs, setLogs] = useState<AssemblyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mechId, setMechId] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch("/api/auth/me").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (data.user) setMechId(data.user.id);
      }
    }).catch(() => {});
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!mechId) return;
    try {
      const res = await fetch(`/api/services/assembly?date=${today}&mechanicId=${mechId}`);
      if (res.ok) setLogs((await res.json()).logs);
      else {
        const err = await res.json().catch(() => ({ error: "Failed to load logs" }));
        setError(err.error || `Failed to load logs (${res.status})`);
      }
    } catch (e: any) {
      setError(`Network error: ${e.message}`);
    }
    setLoading(false);
  }, [today, mechId]);

  useEffect(() => {
    if (mechId) fetchLogs();
  }, [fetchLogs, mechId]);

  // Tap type button → open camera
  const handleTypeSelect = (type: string) => {
    setPendingType(type);
    setPreview(null);
    // Small delay to let state update before triggering file input
    setTimeout(() => fileRef.current?.click(), 50);
  };

  // Photo selected → compress, upload, save log
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingType) return;

    // Show preview
    setPreview(URL.createObjectURL(file));
    setSaving(true);

    try {
      // Compress
      const compressed = await compressImage(file);

      // Upload photo + save log in one API call
      const formData = new FormData();
      formData.append("file", compressed);
      formData.append("assemblyType", pendingType);

      const res = await fetch("/api/services/assembly", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        fetchLogs();
      } else {
        const err = await res.json().catch(() => ({ error: "Assembly log failed" }));
        setError(err.error || `Assembly log failed (${res.status})`);
      }
    } catch (e: any) {
      setError(`Upload error: ${e.message}`);
    }

    setSaving(false);
    setPendingType(null);
    setPreview(null);
    // Reset file input
    if (fileRef.current) fileRef.current.value = "";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-4xl animate-bounce">📦</div>
      </div>
    );
  }

  const pendingTypeConfig = pendingType ? ASSEMBLY_TYPES.find((t) => t.key === pendingType) : null;

  return (
    <div className="p-4 pb-24">
      {/* Hidden file input for camera */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoCapture}
      />

      {error && (
        <div className="mb-3 bg-red-600 rounded-xl p-3 flex items-start gap-2 shadow-lg">
          <span className="text-white text-sm font-bold flex-1">⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-white/70 font-bold text-sm">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">📦 Assembly</h2>
        <span className="text-gray-400 text-sm font-medium">{logs.length} today</span>
      </div>

      {/* Uploading overlay */}
      {saving && (
        <div className="mb-4 bg-gray-50 rounded-2xl p-4 border border-gray-200 text-center">
          {preview && <img src={preview} alt="Uploading" className="w-full rounded-xl mb-3" />}
          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-500 font-medium">Saving {pendingTypeConfig?.label} assembly...</span>
          </div>
        </div>
      )}

      {/* 3 big buttons — tap to open camera */}
      <div className="space-y-3 mb-6">
        {ASSEMBLY_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTypeSelect(t.key)}
            disabled={saving}
            className={`w-full ${t.color} text-white font-black text-2xl py-6 rounded-2xl active:scale-95 transition-transform shadow-sm disabled:opacity-50`}
          >
            📦 {t.label}
          </button>
        ))}
      </div>

      {/* Today's logs */}
      {logs.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-5xl mb-3">📦</div>
          <p className="text-gray-400">No assemblies logged today</p>
          <p className="text-gray-300 text-sm mt-1">Tap a button → take photo → logged</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const tc = ASSEMBLY_TYPES.find((t) => t.key === log.assemblyType);
            const time = new Date(log.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={log.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                {log.photos && log.photos.length > 0 && (
                  <img
                    src={`/api/services/assembly/photo?logId=${log.id}`}
                    alt="Assembly"
                    className="w-full rounded-lg mb-2"
                  />
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`${tc?.color} text-white text-xs font-bold px-2.5 py-1 rounded-full`}>
                      {tc?.label}
                    </span>
                    <span className="text-sm text-gray-500">{log.mechanic.emoji} {log.mechanic.name}</span>
                  </div>
                  <span className="text-xs text-gray-400">{time}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
