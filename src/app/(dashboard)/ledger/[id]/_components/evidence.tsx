"use client";

// App.jsx:726-759
// Render a curated evidence string with its chat dates, L-line refs and "quotes" highlighted,
// split into labelled source blocks (CHAT / ACCOUNTS-GROUP / OWNER / REVERSE-CALC).
import type { ReactNode } from "react";

export function Evidence({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text
    .split(/(?=\bCHAT:|\bACCOUNTS-GROUP:|\bOWNER\b|\bREVERSE-CALC:)/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const blocks = parts.length ? parts : [text];
  const hl = (s: string, ki: number): ReactNode[] => {
    // highlight "quotes", L<line> refs, and dates (DD-Mon-YY / DD/MM/YY)
    const re =
      /("[^"]*"|'[^']*'|L\d+(?:\s*[→\-/,]\s*\d+)*|\b\d{1,2}[-/](?:[A-Za-z]{3,}|\d{1,2})[-/]\d{2,4}\b)/g;
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const tok = m[0];
      const cls = tok[0] === '"' || tok[0] === "'" ? "ev-q" : /^L\d/.test(tok) ? "ev-ref" : "ev-date";
      out.push(
        <span key={`${ki}-${idx++}`} className={cls}>
          {tok}
        </span>
      );
      last = m.index + tok.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  return (
    <div className="evblocks">
      {blocks.map((b, i) => {
        const mk = b.match(/^(CHAT:|ACCOUNTS-GROUP:|REVERSE-CALC:|OWNER[^:]{0,18}:?)/);
        const label = mk ? mk[1].replace(/:$/, "") : null;
        const body = mk ? b.slice(mk[1].length).trim() : b;
        return (
          <div key={i} className="evline">
            {label && <span className="ev-tag">{label}</span>}
            <span>{hl(body, i)}</span>
          </div>
        );
      })}
    </div>
  );
}
