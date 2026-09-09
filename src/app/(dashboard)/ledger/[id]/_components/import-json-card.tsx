"use client";

// The one-time "Import JSON" card (plan 0909-vendor-ledger-screens, R8/R9). Shown by
// BrandPage only while the vendor has no ledger rows. Styled with the ledger app's own
// classes so it sits inside `.bch-ledger` like the rest of the screen. Setup tooling: flip
// LEDGER_JSON_IMPORT_ENABLED in src/lib/brand-ledger/import-json.ts and it is gone.

import { useRef, useState } from "react";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { LedgerBrandView } from "@/lib/brand-ledger/view-types";

const log = createLogger("ledger:import-json:ui");

interface BrandOption {
  id: string;
  name: string;
  entries: number;
  gaps: number;
}

interface ImportCounts {
  entries: number;
  gaps: number;
  notes: number;
  unlinkedAudits: number[];
}

/** Read the brand list out of the export in the browser — no upload until confirmed. */
function readBrands(doc: unknown): BrandOption[] | null {
  if (!doc || typeof doc !== "object") return null;
  const brands = (doc as { brands?: unknown }).brands;
  if (!Array.isArray(brands)) return null;
  const out: BrandOption[] = [];
  for (const b of brands) {
    if (!b || typeof b !== "object") return null;
    const { id, name, entries, gaps } = b as { id?: unknown; name?: unknown; entries?: unknown; gaps?: unknown };
    if (typeof id !== "string" || typeof name !== "string") return null;
    out.push({
      id,
      name,
      entries: Array.isArray(entries) ? entries.length : 0,
      gaps: Array.isArray(gaps) ? gaps.length : 0,
    });
  }
  return out;
}

export function ImportJsonCard({
  vendorId,
  brand,
  reload,
}: {
  vendorId: string;
  brand: LedgerBrandView;
  reload: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandId, setBrandId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const chosen = brands.find((b) => b.id === brandId) ?? null;

  const onPick = async (f: File | null) => {
    setErr("");
    setFile(null);
    setBrands([]);
    setBrandId("");
    if (!f) return;
    try {
      const doc: unknown = JSON.parse(await f.text());
      const list = readBrands(doc);
      if (!list || list.length === 0) {
        setErr('Not a ledger export — it has no "brands" array');
        return;
      }
      setFile(f);
      setBrands(list);
      // Preselect the brand whose name matches the vendor, when one does.
      const guess = list.find((b) => brand.name.toLowerCase().includes(b.id.toLowerCase()));
      setBrandId(guess?.id ?? list[0].id);
    } catch (e) {
      log.warn("export unreadable in the browser", { fileName: f.name, reason: e instanceof Error ? e.message : String(e) });
      setErr("The file is not valid JSON");
    }
  };

  const submit = async () => {
    if (!file || !chosen) return;
    setBusy(true);
    setErr("");
    const form = new FormData();
    form.append("file", file);
    form.append("brandId", chosen.id);
    const { data, error } = await apiTry<ImportCounts>(`/api/ledger/vendors/${vendorId}/import-json`, {
      method: "POST",
      body: form,
      timeoutMs: 90_000,
    });
    setBusy(false);
    if (error || !data) {
      log.warn("import failed", { vendorId, brandId: chosen.id, error });
      setErr(error ?? "Import failed");
      alert("Import failed: " + (error ?? "unknown error"));
      return;
    }
    log.info("import done", { vendorId, brandId: chosen.id, ...data });
    const unlinked = data.unlinkedAudits.length ? `\n${data.unlinkedAudits.length} audit link(s) pointed at a missing gap: #${data.unlinkedAudits.join(", #")}` : "";
    alert(`Imported ✓ ${data.entries} entries · ${data.gaps} gaps · ${data.notes} notes${unlinked}`);
    if (fileRef.current) fileRef.current.value = "";
    reload();
  };

  return (
    <div className="card form">
      <h3>Import JSON</h3>
      <p className="smallmuted">
        One-time setup: load the ledger app&apos;s <b>Data → Export JSON</b> file and pick which
        brand in it is {brand.name}. The file is read once and not kept. This card is removed
        after setup.
      </p>
      <div>
        <label>Export file</label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </div>
      {brands.length > 0 && (
        <div>
          <label>Brand in the file</label>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={busy}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {b.name} · {b.entries} entries · {b.gaps} gaps
              </option>
            ))}
          </select>
        </div>
      )}
      {chosen && (
        <p className="smallmuted">
          Import <b>{chosen.name}</b> into <b>{brand.name}</b>: {chosen.entries} entries, {chosen.gaps} gaps.
        </p>
      )}
      {err && <p className="smallmuted" style={{ color: "var(--red)" }}>{err}</p>}
      <div className="formactions">
        <button
          className="iconbtn primary"
          disabled={busy || !file || !chosen}
          onClick={() => {
            if (!chosen) return;
            if (confirm(`Import ${chosen.name} (${chosen.entries} entries, ${chosen.gaps} gaps) into ${brand.name}? This runs once.`)) void submit();
          }}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
