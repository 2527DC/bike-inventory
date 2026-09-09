"use client";

// The screen's writes. The ledger app mutated one JSON document through `update(fn)`
// (App.jsx:67-75); here every mutation is one API call, and the parent re-fetches the view.
// Errors are shown with `alert()` — the app's own idiom (App.jsx:1303, 1310) — so a refused
// write reads the same way a refused import did there.
import { apiTry, type ApiInit } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type {
  LedgerEntryWrite,
  LedgerGapWrite,
  LedgerProfileWrite,
  LedgerViewEntry,
} from "@/lib/brand-ledger/view-types";

const log = createLogger("ledger:ui");

/** Run one write; true when it landed. The server's sentence is shown on refusal. */
async function write(url: string, init: ApiInit): Promise<boolean> {
  const { error, status } = await apiTry(url, init);
  if (error) {
    log.warn("ledger write refused", { url, method: init.method, status });
    alert(error);
    return false;
  }
  return true;
}

export const ledgerApi = {
  profile: (vendorId: string, body: LedgerProfileWrite) =>
    write(`/api/ledger/vendors/${vendorId}/profile`, { method: "PUT", json: body }),

  addEntry: (vendorId: string, body: LedgerEntryWrite) =>
    write(`/api/ledger/vendors/${vendorId}/entries`, { method: "POST", json: body }),

  /**
   * The app's × deleted any row (App.jsx:617-627). Here a hand-added row deletes; a row that
   * came from a statement or the import is marked IGNORED instead — the brand's record stays
   * intact (plan D3).
   */
  removeEntry: (vendorId: string, entry: LedgerViewEntry) =>
    entry.source === "MANUAL"
      ? write(`/api/ledger/vendors/${vendorId}/entries?entryId=${encodeURIComponent(entry.id)}`, {
          method: "DELETE",
        })
      : write(`/api/ledger/entries/${entry.id}/review`, {
          method: "PUT",
          json: { matchStatus: "IGNORED" },
        }),

  addGap: (vendorId: string, body: LedgerGapWrite) =>
    write(`/api/ledger/vendors/${vendorId}/gaps`, { method: "POST", json: body }),

  updateGap: (gapId: string, body: Partial<LedgerGapWrite>) =>
    write(`/api/ledger/gaps/${gapId}`, { method: "PUT", json: body }),

  deleteGap: (gapId: string) => write(`/api/ledger/gaps/${gapId}`, { method: "DELETE" }),

  addNote: (gapId: string, text: string) =>
    write(`/api/ledger/gaps/${gapId}/notes`, { method: "POST", json: { text } }),
};
