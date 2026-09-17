"use client";

import { BinsManager } from "@/components/bins/bins-manager";

// /bins stays reachable by URL (bookmarks, links from inbound put-away). The screen itself lives
// in src/components/bins/bins-manager.tsx so the Bins tab of /stores renders the same thing
// (plan 1709-priority-build-and-stock-flow, R32).
export default function BinsPage() {
  return <BinsManager />;
}
