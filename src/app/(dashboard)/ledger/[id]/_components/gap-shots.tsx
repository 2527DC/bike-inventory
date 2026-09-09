"use client";

// App.jsx:762-793
// Screenshot evidence for a gap: thumbnails with date + source + what-it-proves, tap to zoom.
// The app read a static map (EVIDENCE[brand.id][n], evidence.gen.js); here the rows come with
// the gap (LedgerGapEvidence → gap.shots) and `url` is the stored file's public URL.
import { useState } from "react";
import type { LedgerViewGap, LedgerViewGapEvidence } from "@/lib/brand-ledger/view-types";

export function GapShots({ gap }: { gap: LedgerViewGap }) {
  const [zoom, setZoom] = useState<LedgerViewGapEvidence | null>(null);
  const shots = gap.shots;
  if (!shots || !shots.length) return null;
  return (
    <div className="gd-sec">
      <span className="gd-lbl">Screenshots ({shots.length})</span>
      <div className="shots">
        {shots.map((s, i) =>
          s.doc ? (
            <a
              key={s.id || i}
              className="shot doc"
              href={s.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="docicon">📄 PDF</div>
              <figcaption>
                <b>{s.date}</b> · {s.source}
                <span>{s.note}</span>
              </figcaption>
            </a>
          ) : (
            <figure
              key={s.id || i}
              className="shot"
              onClick={(e) => {
                e.stopPropagation();
                setZoom(s);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={s.note} loading="lazy" />
              <figcaption>
                <b>{s.date}</b> · {s.source}
                <span>{s.note}</span>
              </figcaption>
            </figure>
          )
        )}
      </div>
      {zoom && (
        <div
          className="lightbox"
          onClick={(e) => {
            e.stopPropagation();
            setZoom(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.note} />
          <div className="lb-cap">
            <b>{zoom.date}</b> · {zoom.source} — {zoom.note}
          </div>
          <div className="lb-close">tap anywhere to close</div>
        </div>
      )}
    </div>
  );
}
