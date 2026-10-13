"use client";

// The vendor list for the Vendor panels and the bulk bar — one request however many panels open.
// Loaded the first time a panel needs it, not on page load: a person who only skips and parks
// lines never asks for it.
import { useEffect, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { Vendor } from "./types";

const log = createLogger("accounts:reconcile");

/**
 * A 403 from a picker's own module names the missing grant — never an empty list (§2.3: today a
 * person without vendors.view gets an empty picker, silently).
 */
export const NO_VENDORS = "You can see bank lines but not vendors — ask an admin for Vendors view.";
export const NO_BILLS = "You can see bank lines but not bills — ask an admin for Bills view.";

interface VendorsState {
  vendors: Vendor[];
  error: string;
  loading: boolean;
}

let shared: Promise<{ vendors: Vendor[]; error: string }> | null = null;

async function fetchVendors(): Promise<{ vendors: Vendor[]; error: string }> {
  const { data, error, status } = await apiTry<Vendor[]>("/api/vendors?limit=500");
  if (error) {
    log.error("vendor list load failed", { status, message: error });
    shared = null; // the next panel to open asks again
    return { vendors: [], error: status === 403 ? NO_VENDORS : error };
  }
  return { vendors: data ?? [], error: "" };
}

/** Forget the cached list. The page calls it on mount, so a vendor added since is offered. */
export function resetVendors(): void {
  shared = null;
}

export function useVendors(): VendorsState {
  const [state, setState] = useState<VendorsState>({ vendors: [], error: "", loading: true });
  useEffect(() => {
    let alive = true;
    if (!shared) shared = fetchVendors();
    void shared.then((r) => {
      if (alive) setState({ ...r, loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Vendors whose name or code contains the search, case-insensitive. */
export function filterVendors(vendors: Vendor[], search: string): Vendor[] {
  const q = search.trim().toLowerCase();
  if (!q) return vendors;
  return vendors.filter((v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q));
}
