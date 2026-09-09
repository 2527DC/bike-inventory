"use client";

// App.jsx:431-444
import { useState } from "react";

export function ProgressNote({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        style={{ flex: 1, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
        placeholder="Add progress note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="iconbtn"
        disabled={!text.trim()}
        onClick={() => {
          onAdd(text.trim());
          setText("");
        }}
      >
        Add
      </button>
    </div>
  );
}
