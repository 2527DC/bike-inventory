"use client";

import { useState, useEffect, useCallback } from "react";
import { apiTry } from "@/lib/api-client";

let globalBinTracking: boolean | null = null;
const listeners = new Set<(val: boolean) => void>();

export function useBinTracking() {
  const [enabled, setEnabled] = useState<boolean>(globalBinTracking ?? false);
  const [loading, setLoading] = useState<boolean>(globalBinTracking === null);

  useEffect(() => {
    const handler = (val: boolean) => setEnabled(val);
    listeners.add(handler);

    if (globalBinTracking === null) {
      apiTry<{ enabled: boolean }>("/api/settings/bin-tracking").then((res) => {
        if (res.data) {
          globalBinTracking = res.data.enabled;
          listeners.forEach((l) => l(res.data!.enabled));
        }
        setLoading(false);
      });
    } else {
      setEnabled(globalBinTracking);
      setLoading(false);
    }

    return () => {
      listeners.delete(handler);
    };
  }, []);

  const toggleBinTracking = useCallback(async (newVal: boolean) => {
    // Optimistic update
    globalBinTracking = newVal;
    listeners.forEach((l) => l(newVal));

    try {
      const res = await fetch("/api/settings/bin-tracking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newVal }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update bin tracking");
      }
      return true;
    } catch (err) {
      // Revert on failure
      const revert = !newVal;
      globalBinTracking = revert;
      listeners.forEach((l) => l(revert));
      throw err;
    }
  }, []);

  return { isBinTrackingEnabled: enabled, loading, toggleBinTracking };
}
