// ─── Prompted import: turn whatever the person picked into an ImportInput, IN THE BROWSER ───
// Plan 1310-ledger-prompted-import-without-file-storage, §3 Part A (R6, R7, Q2b, Q3).
//
// BROWSER-ONLY for `prepareImportInput` (File, createImageBitmap, canvas, btoa). The file never
// leaves this tab as a file: a workbook becomes cell text, a chat / .txt / .docx becomes text,
// a photo is shrunk and re-encoded, and only a PDF goes as itself (under 3 MB). Nothing here
// talks to the network, and nothing is stored anywhere (R6).
//
// `workbookToSheets` is the one pure piece — it takes the xlsx module as an argument so a Node
// script can test it on the sample workbooks without a DOM.
//
// Logging: kinds, extensions, sizes and counts only. Never a file name, a cell or the text.
import { unzipSync } from "fflate";
import type * as XLSXTypes from "xlsx";
import { createLogger } from "@/lib/logger";
import {
  IMPORT_ATTACHMENT_MAX_BYTES,
  IMPORT_SHEET_MAX_ROWS,
  IMPORT_SHEET_MAX_SHEETS,
  IMPORT_TEXT_MAX_CHARS,
  cellText,
  type ImportInput,
  type ImportSheet,
} from "./prompted-import";

const log = createLogger("ledger:import-input");

/** A refusal the person can act on — its message is shown as written. */
export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInputError";
  }
}

// ─── Limits local to the browser read (the wire limits live in prompted-import.ts) ─────────

/** importInputSchema's per-cell and per-row caps. */
const CELL_MAX_CHARS = 2000;
const ROW_MAX_COLS = 200;
/** Sheet cells as JSON (plan §3 Part A: "2 MB of JSON") — keeps the body well under Vercel's ~4.5 MB. */
const SHEET_JSON_MAX_CHARS = 2_000_000;
/** importInputSchema caps a file name at 200 and a sheet name at 100. */
const FILE_NAME_MAX = 200;
const SHEET_NAME_MAX = 100;
/** Anything bigger is not read at all: a phone tab that loads 200 MB into memory crashes. */
const READ_MAX_BYTES = 50 * 1024 * 1024;
/** Photos: long side and JPEG quality, then the smaller retry (plan §3 Part A). */
const IMAGE_PASSES: { maxEdge: number; quality: number }[] = [
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1600, quality: 0.7 },
];

const SHEET_EXT = ["xlsx", "xls", "csv"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp"];
const WHAT_WORKS =
  "What works: Excel (.xlsx .xls), CSV, text (.txt), WhatsApp chat (.txt or .zip), Word (.docx), images (PNG, JPG, WEBP), PDF — or paste the text instead.";

type ReadKind = "sheet" | "csv" | "txt" | "zip" | "docx" | "image" | "pdf";

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * What the person chose — a file, or text typed or pasted — as the ImportInput the import route
 * takes. Throws ImportInputError, with a sentence to show, for anything it cannot read.
 */
export async function prepareImportInput(source: { file: File } | { text: string }): Promise<ImportInput> {
  if ("text" in source) return pastedText(source.text);

  const file = source.file;
  const ext = extensionOf(file.name);
  const kind = readKindOf(file, ext);
  const ctx = { ext: ext || null, mime: file.type || null, bytes: file.size, kind };
  const started = Date.now();
  try {
    if (!kind) throw new ImportInputError(refusalFor(ext));
    if (file.size === 0) throw new ImportInputError("This file is empty — there is nothing to read.");
    if (file.size > READ_MAX_BYTES) {
      throw new ImportInputError(
        kind === "zip"
          ? `This zip is ${mb(file.size)} — it probably includes the photos. In WhatsApp, export the chat "Without media" and upload that.`
          : `This file is ${mb(file.size)} — too big to read here. Send the part that matters (one sheet, a few pages, a screenshot).`
      );
    }
    log.debug("reading input", ctx);
    const input = await readByKind(kind, file);
    log.debug("input ready", { ...ctx, out: input.kind, ms: Date.now() - started, ...inputCounts(input) });
    return input;
  } catch (e) {
    if (e instanceof ImportInputError) {
      log.warn("input refused", { ...ctx, ms: Date.now() - started });
      throw e;
    }
    // A parser's own message rarely helps the person; the name and a short reason go to the log.
    log.error("input could not be read", { ...ctx, error: e instanceof Error ? e.name : "unknown", reason: shortReason(e) });
    throw new ImportInputError(unreadableSentence(kind, e));
  }
}

async function readByKind(kind: ReadKind, file: File): Promise<ImportInput> {
  const fileName = clip(file.name, FILE_NAME_MAX) || "file";
  switch (kind) {
    case "sheet":
    case "csv": {
      const XLSX = await import("xlsx");
      const data = kind === "csv" ? await file.text() : await file.arrayBuffer();
      return { kind: "sheet", fileName, sheets: workbookToSheets(XLSX, data, kind === "csv") };
    }
    case "txt":
      return textInput(fileName, await file.text());
    case "zip":
      return textInput(fileName, chatFromZip(new Uint8Array(await file.arrayBuffer())));
    case "docx":
      return textInput(fileName, docxText(new Uint8Array(await file.arrayBuffer())));
    case "image":
      return { kind: "attachment", fileName, mediaType: "image/jpeg", base64: await shrinkImage(file, extensionOf(file.name)) };
    case "pdf": {
      if (file.size > IMPORT_ATTACHMENT_MAX_BYTES) {
        throw new ImportInputError("This PDF is over 3 MB. Send a photo of each page, or split the PDF.");
      }
      return { kind: "attachment", fileName, mediaType: "application/pdf", base64: base64FromBytes(new Uint8Array(await file.arrayBuffer())) };
    }
  }
}

// ─── Kind detection ───────────────────────────────────────────────────────────

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** By extension first; by MIME type when the name has none (a pasted image, a shared file). */
function readKindOf(file: File, ext: string): ReadKind | null {
  if (ext === "csv") return "csv";
  if (SHEET_EXT.includes(ext)) return "sheet";
  if (ext === "txt") return "txt";
  if (ext === "zip") return "zip";
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext) return null;
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/csv") return "csv";
  if (mime === "text/plain") return "txt";
  if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel") return "sheet";
  return null;
}

function refusalFor(ext: string): string {
  if (ext === "doc") return "Old Word files (.doc) can't be read here — open it and save it as .docx, or copy the text and paste it.";
  return `This kind of file can't be read here${ext ? ` (.${ext})` : ""}. ${WHAT_WORKS}`;
}

function unreadableSentence(kind: ReadKind | null, e: unknown): string {
  const reason = e instanceof Error ? e.message : "";
  if (/password|encrypt/i.test(reason)) return "This file is password-protected. Open it, remove the password, save it, and upload it again.";
  if (kind === "sheet" || kind === "csv") return "This Excel file could not be read — it may be damaged. Open it and save it again as .xlsx, or export it as CSV.";
  if (kind === "zip" || kind === "docx") return "This file could not be opened — it may be damaged or not really a .zip / .docx. Export it again, or paste the text instead.";
  return "This file could not be read — it may be damaged. Try saving it again, or send a screenshot instead.";
}

// ─── Sheets — the pure, testable part ────────────────────────────────────────

type XlsxLike = Pick<typeof XLSXTypes, "read" | "utils">;

/**
 * A workbook's bytes (xlsx/xls) or text (csv) → cell text per sheet, ready for the wire.
 *
 * - Row N here is row N in Excel: the range is read from A1, so the review page's row numbers
 *   match what the person sees, even when the sheet's data starts lower down.
 * - Date cells: SheetJS 0.18 builds them in local time from an 1899 base date, and in India
 *   that date's offset (Madras time, +5:21:10) has seconds the correction drops — every date
 *   arrives 10 s before midnight of the DAY BEFORE ("1/4/25" → 3 Jan 23:59:50). The error is
 *   always under a minute, so a Date is rounded to the nearest minute before `cellText` reads
 *   its local day. Checked on LUCIFER and CULTSPORT in Asia/Kolkata, UTC and New York.
 * - CSV is read as text (`raw`): xlsx would otherwise turn "05/04/2025" into 4 May, US order,
 *   before the plan's day-first rule ever sees it.
 * - Empty sheets are dropped; more than IMPORT_SHEET_MAX_ROWS rows on one sheet, or more than
 *   IMPORT_SHEET_MAX_SHEETS sheets with data, is REFUSED with a sentence — never cut silently.
 */
export function workbookToSheets(XLSX: XlsxLike, data: ArrayBuffer | string, isCsv: boolean): ImportSheet[] {
  // The whole sheet is read (the file is already capped at READ_MAX_BYTES): a cut-off by xlsx's
  // `sheetRows` would either drop rows past a blank stretch silently, or refuse a short ledger
  // whose balance formula was dragged down to row 10,000.
  const wb =
    typeof data === "string" || isCsv
      ? XLSX.read(typeof data === "string" ? data : new TextDecoder("utf-8").decode(data), { type: "string", raw: true })
      : XLSX.read(data, { type: "array", cellDates: true });
  if (wb.SheetNames.length === 0) throw new ImportInputError("This workbook has no sheets.");

  const sheets: ImportSheet[] = [];
  let clippedCols = 0;
  let clippedCells = 0;

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ws || !ref) continue;

    const range = XLSX.utils.decode_range(ref);
    range.s.r = 0;
    range.s.c = 0;
    if (range.e.c >= ROW_MAX_COLS) {
      clippedCols = Math.max(clippedCols, range.e.c + 1 - ROW_MAX_COLS);
      range.e.c = ROW_MAX_COLS - 1;
    }

    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, range, blankrows: true });
    const rows: string[][] = grid.map((r) => {
      const cells = (Array.isArray(r) ? r : []).map((v) => {
        const text = cellText(v instanceof Date ? nearestMinute(v) : v);
        if (text.length > CELL_MAX_CHARS) {
          clippedCells++;
          return text.slice(0, CELL_MAX_CHARS);
        }
        return text;
      });
      // Trailing blanks carry nothing and every row was padded to the sheet's width.
      let end = cells.length;
      while (end > 0 && cells[end - 1] === "") end--;
      return cells.slice(0, end);
    });

    let last = rows.length;
    while (last > 0 && rows[last - 1].length === 0) last--;
    rows.length = last;
    if (rows.length === 0) continue;

    if (rows.length > IMPORT_SHEET_MAX_ROWS) {
      throw new ImportInputError(
        `Sheet "${name}" has ${rows.length.toLocaleString("en-IN")} rows — at most ${IMPORT_SHEET_MAX_ROWS.toLocaleString("en-IN")} can be read at a time. Split it into parts (by year or by month) and import each one.`
      );
    }
    sheets.push({ name: clip(name, SHEET_NAME_MAX), rows });
  }

  if (sheets.length === 0) throw new ImportInputError("Every sheet in this workbook is empty — there is nothing to read.");
  if (sheets.length > IMPORT_SHEET_MAX_SHEETS) {
    throw new ImportInputError(
      `This workbook has ${sheets.length} sheets with data — at most ${IMPORT_SHEET_MAX_SHEETS} can be read at a time. Delete the sheets you don't need, or save the one that matters as its own file.`
    );
  }
  const jsonChars = JSON.stringify(sheets).length;
  if (jsonChars > SHEET_JSON_MAX_CHARS) {
    throw new ImportInputError(
      `This workbook holds ${mb(jsonChars)} of cells — at most ${mb(SHEET_JSON_MAX_CHARS)} can be sent at once. Delete the sheets or columns you don't need, or split it into parts.`
    );
  }
  if (clippedCols || clippedCells) {
    // Schema limits; a real ledger never reaches them, so this is worth a line in the log.
    log.warn("sheet cells clipped to the wire limits", { clippedCols, clippedCells, sheets: sheets.length });
  }
  return sheets;
}

function nearestMinute(d: Date): Date {
  const t = d.getTime();
  return Number.isNaN(t) ? d : new Date(Math.round(t / 60_000) * 60_000);
}

// ─── Text: pasted, .txt, chat .zip, .docx ────────────────────────────────────

function pastedText(raw: string): ImportInput {
  const input = textInput(null, raw);
  log.debug("pasted text ready", { chars: input.kind === "text" ? input.text.length : 0 });
  return input;
}

function textInput(fileName: string | null, raw: string): ImportInput {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) {
    throw new ImportInputError(fileName ? "There is no text in this file." : "There is no text to read — paste or type something first.");
  }
  if (text.length > IMPORT_TEXT_MAX_CHARS) {
    throw new ImportInputError(
      `This text is ${text.length.toLocaleString("en-IN")} characters — at most ${IMPORT_TEXT_MAX_CHARS.toLocaleString("en-IN")} can be read at once. Split it into parts (for a chat, export a shorter period).`
    );
  }
  return { kind: "text", fileName, text };
}

/** The `_chat.txt` in a WhatsApp export, else the largest .txt. Only that one file is inflated. */
function chatFromZip(bytes: Uint8Array): string {
  const candidates: { name: string; size: number }[] = [];
  unzipSync(bytes, {
    filter: (f) => {
      if (/\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX")) candidates.push({ name: f.name, size: f.originalSize });
      return false;
    },
  });
  if (candidates.length === 0) {
    throw new ImportInputError("This zip holds no .txt chat export. Unzip it and upload the file inside, or export the chat again from WhatsApp.");
  }
  const chosen = candidates.find((c) => /_chat\.txt$/i.test(c.name)) ?? [...candidates].sort((a, b) => b.size - a.size)[0];
  const entries = unzipSync(bytes, { filter: (f) => f.name === chosen.name });
  const data = entries[chosen.name];
  if (!data) throw new ImportInputError("The chat inside this zip could not be opened. Export the chat again from WhatsApp.");
  return new TextDecoder("utf-8").decode(data);
}

/** A .docx's body text: paragraphs → lines, table cells → tabs, tags stripped, entities decoded. */
function docxText(bytes: Uint8Array): string {
  const entries = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const doc = entries["word/document.xml"];
  if (!doc) throw new ImportInputError("This isn't a Word document that can be read (no text inside). Copy the text and paste it instead.");
  const xml = new TextDecoder("utf-8").decode(doc);
  const text = xml
    // Deleted tracked changes and field codes are not text a reader sees.
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, "")
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    // A table cell's last paragraph ends the cell, not the line.
    .replace(/<\/w:p>\s*<\/w:tc>/g, "</w:tc>")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(?:br|cr)\/>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, code: string) => {
    switch (code) {
      case "lt": return "<";
      case "gt": return ">";
      case "amp": return "&";
      case "quot": return '"';
      case "apos": return "'";
    }
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

// ─── Images: decode, shrink, JPEG ────────────────────────────────────────────

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** createImageBitmap first; <img> as the fallback — Safari decodes HEIC there when it can. */
async function decodeImage(file: File, ext: string): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch (e) {
      log.debug("createImageBitmap could not decode, trying <img>", { ext, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    log.warn("image could not be decoded in this browser", { ext, error: e instanceof Error ? e.name : "unknown" });
    if (ext === "heic" || ext === "heif" || /hei[cf]/i.test(file.type)) {
      throw new ImportInputError("This phone photo format (HEIC) can't be read in this browser — save it as JPG or take a screenshot, then upload that");
    }
    throw new ImportInputError("This image could not be opened — it may be damaged. Take a screenshot of it and upload that instead.");
  }
}

async function encodeJpeg(img: Decoded, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImportInputError("This browser could not prepare the image. Try another browser, or upload a screenshot.");
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size === 0) throw new ImportInputError("This browser could not prepare the image. Try another browser, or upload a screenshot.");
    return blob;
  } finally {
    // iOS keeps canvas memory until the size is zeroed.
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function shrinkImage(file: File, ext: string): Promise<string> {
  const img = await decodeImage(file, ext);
  try {
    for (const pass of IMAGE_PASSES) {
      const blob = await encodeJpeg(img, pass.maxEdge, pass.quality);
      log.debug("image encoded", { ext, from: file.size, to: blob.size, maxEdge: pass.maxEdge, quality: pass.quality, width: img.width, height: img.height });
      if (blob.size <= IMPORT_ATTACHMENT_MAX_BYTES) return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
    }
  } finally {
    img.release();
  }
  throw new ImportInputError("This image is still over 3 MB after shrinking it. Crop it to the part that matters, or take a screenshot instead.");
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Base64 with no data-URL prefix, built in 32 KB chunks so a 3 MB file cannot overflow the stack. */
export function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function mb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortReason(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
}

function inputCounts(input: ImportInput): Record<string, number> {
  if (input.kind === "sheet") return { sheets: input.sheets.length, rows: input.sheets.reduce((n, s) => n + s.rows.length, 0) };
  if (input.kind === "text") return { chars: input.text.length };
  return { base64Chars: input.base64.length };
}

/** "2 sheets · 812 rows", "4,210 characters of text", "PDF", "photo (shrunk to JPEG)". */
export function describeInput(input: ImportInput): string {
  if (input.kind === "sheet") {
    const rows = input.sheets.reduce((n, s) => n + s.rows.length, 0);
    const sheets = input.sheets.length;
    return `${sheets} sheet${sheets === 1 ? "" : "s"} · ${rows.toLocaleString("en-IN")} row${rows === 1 ? "" : "s"}`;
  }
  if (input.kind === "text") return `${input.text.length.toLocaleString("en-IN")} characters of text`;
  return input.mediaType === "application/pdf" ? "PDF" : "photo (shrunk to JPEG)";
}

/** Bytes this input adds to the request body — what the person is told will be sent. */
export function inputWireBytes(input: ImportInput): number {
  return new TextEncoder().encode(JSON.stringify(input)).length;
}
