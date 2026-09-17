"use client";

import { ScannerPanel } from "@/components/scanner/scanner-panel";

/** Barcode & labels as a tab of /assembly (plan 1709, R29, Q26). Same panel as /scanner. */
export function LabelsTab() {
  return (
    <div role="tabpanel" className="mx-auto max-w-2xl">
      <ScannerPanel />
    </div>
  );
}
