"use client";

// Shared by the delivery detail screen and the focused walk-out screen (plan 1609 §1.8), so
// both load the delivery the same way and read the same "contact saved" flag.

import { useCallback, useEffect, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { DeliveryData } from "./types";

const log = createLogger("deliveries:detail");

/** Loads `GET /api/deliveries/[id]`. A failed refetch keeps the last good data on screen. */
export function useDelivery(id: string) {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A promise chain rather than an async body: state is set inside the callback, which is what
  // react-hooks/set-state-in-effect asks for when an effect kicks off the first load.
  const refetch = useCallback(
    () =>
      apiTry<DeliveryData>(`/api/deliveries/${id}`).then((res) => {
        if (res.error) {
          log.warn("delivery load failed", { deliveryId: id, status: res.status });
          setError(res.error);
        } else {
          setError(null);
          setData(res.data);
        }
        setLoading(false);
      }),
    [id]
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/**
 * The "contact saved" flag lives in localStorage under `contact-saved-<id>` so it survives a
 * refresh. Phase 2 replaces it with a database save (R35); until then both screens share it.
 */
export function useContactSaved(id: string) {
  const contactKey = `contact-saved-${id}`;
  const [contactSaved, setContactSaved] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(contactKey) === "1";
    } catch (e) {
      log.warn("contact-saved flag unreadable", { deliveryId: id, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  });

  const markContactSaved = () => {
    setContactSaved(true);
    try {
      localStorage.setItem(contactKey, "1");
    } catch (e) {
      log.warn("contact-saved flag not stored", { deliveryId: id, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return { contactSaved, markContactSaved };
}
