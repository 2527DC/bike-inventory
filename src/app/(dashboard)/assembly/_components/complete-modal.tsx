"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { AssemblyTask, Bin } from "./types";

const log = createLogger("assembly:complete-modal");

interface CompleteModalProps {
  task: AssemblyTask;
  onClose: () => void;
  onCompleted: (unitCode: string) => void;
}

/** Finish a build: photo (required), frame number, destination bin. */
export function CompleteModal({ task, onClose, onCompleted }: CompleteModalProps) {
  const [photoDataUrl, setPhotoDataUrl] = useState<string>("");
  const [frameNumber, setFrameNumber] = useState<string>("");
  const [destinationBinId, setDestinationBinId] = useState<string>("");
  const [availableBins, setAvailableBins] = useState<Bin[]>([]);
  const [completing, setCompleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load the warehouse's bins when the modal opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await apiTry<Bin[]>(`/api/bins?warehouseId=${encodeURIComponent(task.warehouse.id)}`);
      if (cancelled) return;
      if (error) {
        // Without `bins.view` the list is empty and the build stays in the assembly area.
        log.warn("bins load failed", { warehouseId: task.warehouse.id, message: error });
        return;
      }
      setAvailableBins(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [task.warehouse.id]);

  function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result as string);
    reader.onerror = () => log.warn("photo read failed", { taskId: task.id });
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCompleting(true);
    const { error, status } = await apiTry(`/api/assembly/tasks/${task.id}/complete`, {
      method: "POST",
      json: {
        photoUrl: photoDataUrl || undefined,
        destinationBinId: destinationBinId || undefined,
        frameNumber: frameNumber.trim() || undefined,
      },
    });
    setCompleting(false);
    if (error) {
      log.error("complete failed", { taskId: task.id, status });
      alert(error);
      return;
    }
    onCompleted(task.unit.unitCode);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            Finish Assembly & Verification
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Verify bike build for <strong>{task.unit.unitCode}</strong>.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-xs">
          <div>
            <label className="mb-1 block font-semibold text-slate-700">1. Bicycle Build Photo (Required)</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handlePhotoCapture}
              className="hidden"
            />
            {photoDataUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-slate-200">
                <img src={photoDataUrl} alt="Build preview" className="h-44 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotoDataUrl("")}
                  aria-label="Remove photo"
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 transition-colors hover:bg-slate-100"
              >
                <Camera className="h-6 w-6 text-slate-400" />
                <span className="font-medium text-slate-600">Take Photo or Upload</span>
              </button>
            )}
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700">2. Frame Number (Engraved on BB / Headtube)</label>
            <Input
              placeholder="e.g. SN-892019-2026"
              value={frameNumber}
              onChange={(e) => setFrameNumber(e.target.value)}
              className="font-mono text-xs uppercase"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700">3. Move To Destination Bin</label>
            <select
              value={destinationBinId}
              onChange={(e) => setDestinationBinId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800"
            >
              <option value="">Keep in current assembly area...</option>
              {availableBins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} ({b.name}) {b.isAssemblyArea ? "— Assembly Area" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" type="button" variant="outline" onClick={onClose} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={completing || !photoDataUrl}
              className="min-h-[44px] bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {completing ? "Completing..." : "Complete Build"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
