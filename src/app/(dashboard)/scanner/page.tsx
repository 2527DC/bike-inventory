"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ScannerPanel } from "@/components/scanner/scanner-panel";

/**
 * Search & Scanner. The body lives in `ScannerPanel`, which the Labels tab on
 * `/assembly?tab=labels` renders too (plan 1709, R29). This route stays reachable by URL.
 */
export default function ScannerPage() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">Search & Scanner</h1>
      </div>
      <ScannerPanel />
    </div>
  );
}
