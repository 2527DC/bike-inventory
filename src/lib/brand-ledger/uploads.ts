// ─── Ledger uploads: the file side of Part E ─────────────────────────────────
// Plan 0909-vendor-ledger-screens-and-ai-import, §3 Part E.1 / E.5. Every object lives under
// `ledger/<vendorId>/<kind>/` in whichever provider Settings → Storage names, and is served by
// the public URL the provider issued (Q1: the owner chose not to gate reads).
//
// Two rules that differ from the PO quotation store this is modelled on:
//   - `storeLedgerFile` THROWS when storage is not configured. A ledger upload exists to be
//     read back by an AI run, so "stored nowhere" is a failure, not a degraded success — and
//     the route checks storage BEFORE any AI spend.
//   - `deleteLedgerFile` THROWS when the provider refuses. The owner pressed Delete (R12) and
//     must know the object is still there; a warn line nobody reads is not that.
import type { LedgerUploadKind } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import { getStorage, LocalProvider, tryGetStorage } from "@/lib/storage";
import { buildKey } from "@/lib/storage/upload-policy";

const log = createLogger("ledger:uploads");

export const LEDGER_STORAGE_PREFIX = "ledger/";

/** `MAX_UPLOAD_BYTES` in upload-policy.ts, restated so this module reads on its own. */
export const MAX_LEDGER_UPLOAD_BYTES = 100 * 1024 * 1024;

/** What each kind may carry. A .zip is a WhatsApp export; its `_chat.txt` is read out of it. */
export const EXTENSIONS_BY_KIND: Record<LedgerUploadKind, readonly string[]> = {
  STATEMENT: ["pdf", "xlsx", "xls", "csv"],
  CHAT: ["txt", "zip"],
  SCREENSHOT: ["png", "jpg", "jpeg", "webp"],
  DOCUMENT: ["pdf", "png", "jpg", "jpeg", "webp"],
};

export const EVIDENCE_EXTENSIONS: readonly string[] = ["pdf", "png", "jpg", "jpeg", "webp"];

export const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function fileExtension(fileName: string): string {
  return (fileName.split(".").pop() || "").toLowerCase();
}

export function contentTypeFor(fileName: string): string {
  return CONTENT_TYPES[fileExtension(fileName)] ?? "application/octet-stream";
}

/** The sentence to refuse an upload with, or null when it is acceptable. */
export function checkLedgerFile(kind: LedgerUploadKind, fileName: string, size: number): string | null {
  const ext = fileExtension(fileName);
  const allowed = EXTENSIONS_BY_KIND[kind];
  if (!allowed.includes(ext)) {
    return `A ${kind.toLowerCase()} upload must be one of: ${allowed.map((e) => `.${e}`).join(", ")}`;
  }
  if (!size) return "The file is empty";
  if (size > MAX_LEDGER_UPLOAD_BYTES) return "File too large (100 MB limit)";
  return null;
}

export function checkEvidenceFile(fileName: string, size: number): string | null {
  const ext = fileExtension(fileName);
  if (!EVIDENCE_EXTENSIONS.includes(ext)) {
    return `Evidence must be one of: ${EVIDENCE_EXTENSIONS.map((e) => `.${e}`).join(", ")}`;
  }
  if (!size) return "The file is empty";
  if (size > MAX_LEDGER_UPLOAD_BYTES) return "File too large (100 MB limit)";
  return null;
}

async function putUnder(prefix: string, fileName: string, contentType: string, bytes: ArrayBuffer): Promise<string> {
  // getStorage() throws StorageNotConfiguredError — the route turns it into a 501 that points
  // at Settings → Storage. Nothing is stored halfway.
  const storage = await getStorage();
  const key = buildKey(prefix, fileName);
  const url = await storage.put(key, bytes, contentType);
  log.debug("ledger file stored", { key, provider: storage.key, bytes: bytes.byteLength });
  return url;
}

/** Store an upload under `ledger/<vendorId>/<kind>/`. Throws when storage is not configured. */
export async function storeLedgerFile(
  vendorId: string,
  kind: LedgerUploadKind,
  fileName: string,
  contentType: string,
  bytes: ArrayBuffer
): Promise<string> {
  return putUnder(`${LEDGER_STORAGE_PREFIX}${vendorId}/${kind.toLowerCase()}/`, fileName, contentType, bytes);
}

/** Store a claim's evidence under `ledger/<vendorId>/evidence/`. Same rules as above. */
export async function storeEvidenceFile(
  vendorId: string,
  fileName: string,
  contentType: string,
  bytes: ArrayBuffer
): Promise<string> {
  return putUnder(`${LEDGER_STORAGE_PREFIX}${vendorId}/evidence/`, fileName, contentType, bytes);
}

/**
 * Read a stored file back for an AI run. LOCAL reads off disk through the provider (the
 * `/api/media` route needs a session, which a server-side call has not got); S3 is a plain
 * fetch of the public URL, which is how every stored image is displayed. Null when the object
 * is gone, the URL was issued by another provider, or storage is no longer configured.
 */
export async function readLedgerFile(fileUrl: string): Promise<ArrayBuffer | null> {
  const storage = await tryGetStorage();
  if (!storage) {
    log.warn("ledger file not readable", { reason: "storage not configured" });
    return null;
  }
  const key = storage.keyFromUrl(fileUrl);
  if (!key) {
    log.warn("ledger file not readable", { reason: "url not issued by the live provider", provider: storage.key });
    return null;
  }
  try {
    if (storage instanceof LocalProvider) {
      const buf = await storage.read(key);
      if (!buf) {
        log.warn("ledger file not readable", { key, provider: storage.key, reason: "not found" });
        return null;
      }
      log.debug("ledger file read", { key, provider: storage.key, bytes: buf.byteLength });
      // A Buffer may be a view into a larger pooled ArrayBuffer; copy exactly its bytes.
      return new Uint8Array(buf).slice().buffer;
    }
    log.debug("-> GET stored ledger file", { key, provider: storage.key });
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      log.warn("ledger file not readable", { key, provider: storage.key, status: res.status });
      return null;
    }
    const bytes = await res.arrayBuffer();
    log.debug("ledger file read", { key, provider: storage.key, bytes: bytes.byteLength });
    return bytes;
  } catch (e) {
    log.warn("ledger file not readable", { key, provider: storage.key, reason: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Delete a stored object. Throws when the live provider refuses — the caller answers 502 so
 * the person who pressed Delete learns the file is still there. The one tolerated case is a
 * URL the live provider never issued (stored before the provider was switched): there is
 * nothing on the live provider to delete, so the row may go.
 */
export async function deleteLedgerFile(fileUrl: string): Promise<void> {
  const storage = await getStorage();
  const key = storage.keyFromUrl(fileUrl);
  if (!key) {
    log.warn("ledger file not on the live provider — row deleted, object left", { provider: storage.key });
    return;
  }
  await storage.delete(key);
  log.info("ledger file deleted", { key, provider: storage.key });
}
