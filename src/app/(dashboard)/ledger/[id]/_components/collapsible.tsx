"use client";

// App.jsx:284-294
import { useState, type ReactNode } from "react";

export function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="iconbtn" style={{ fontSize: 12 }} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open && children}
    </div>
  );
}
