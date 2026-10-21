"use client";

import { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, Download, ExternalLink, FileText, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  url: string | null;
  title: string;
  docNumber?: string | null;
  docDate?: string | null;
}

declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (params: { url: string; withCredentials?: boolean } | string) => {
        promise: Promise<{
          numPages: number;
          getPage: (pageNumber: number) => Promise<{
            getViewport: (params: { scale: number }) => { width: number; height: number };
            render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
              promise: Promise<void>;
            };
          }>;
        }>;
      };
    };
  }
}

export function DocumentViewerModal({
  open,
  onClose,
  url,
  title,
  docNumber,
  docDate,
}: DocumentViewerModalProps) {
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfRendered, setPdfRendered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);

  const isPdf = Boolean(url && (/\.pdf($|\?)/i.test(url) || url.includes("/pdf") || url.toLowerCase().includes("pdf")));
  const isImage = Boolean(url && (/\.(jpe?g|png|webp|gif|svg)($|\?)/i.test(url) || !isPdf));
  const filename = docNumber ? `${docNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}${isPdf ? ".pdf" : ".jpg"}` : (url?.split("/").pop() || "document");

  // Reset zoom & page when opened
  useEffect(() => {
    if (open) {
      setZoom(1);
      setCurrentPage(1);
      setPdfError(null);
      setPdfRendered(false);
    }
  }, [open, url]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  // Dynamically load PDF.js to render PDF on canvas for PWA support (especially Android/iOS PWA)
  useEffect(() => {
    if (!open || !url || !isPdf) return;

    let cancelled = false;
    setPdfLoading(true);
    setPdfError(null);

    async function initPdf() {
      try {
        if (!window.pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const existingScript = document.getElementById("pdfjs-script");
            if (existingScript) {
              existingScript.addEventListener("load", () => resolve());
              existingScript.addEventListener("error", () => reject(new Error("Failed to load PDF viewer engine")));
              return;
            }
            const script = document.createElement("script");
            script.id = "pdfjs-script";
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = () => {
              if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
              }
              resolve();
            };
            script.onerror = () => reject(new Error("Could not load PDF viewer engine"));
            document.head.appendChild(script);
          });
        }

        if (cancelled) return;

        const loadingTask = window.pdfjsLib!.getDocument({
          url: url!,
          withCredentials: true,
        });

        const pdf = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setPdfLoading(false);
      } catch (err) {
        if (cancelled) return;
        setPdfLoading(false);
        setPdfError(err instanceof Error ? err.message : "Failed to load PDF");
      }
    }

    void initPdf();

    return () => {
      cancelled = true;
    };
  }, [open, url, isPdf]);

  // Render current PDF page to canvas
  useEffect(() => {
    if (!open || !isPdf || !pdfDocRef.current || !canvasRef.current) return;

    let cancelled = false;

    async function renderPage() {
      try {
        const page = await pdfDocRef.current.getPage(currentPage);
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Base scale adapted to container width
        const containerWidth = canvas.parentElement?.clientWidth || 360;
        const rawViewport = page.getViewport({ scale: 1 });
        const scaleFactor = Math.min(2.5, Math.max(0.6, (containerWidth - 24) / rawViewport.width)) * zoom;
        const viewport = page.getViewport({ scale: scaleFactor });

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setPdfRendered(true);
      } catch (err) {
        if (!cancelled) {
          setPdfError(err instanceof Error ? err.message : "Failed to render PDF page");
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [open, isPdf, currentPage, zoom, numPages]);

  if (!open || !url) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Document Viewer"
    >
      <div
        className="relative w-full max-w-xl max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-blue-600 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900 truncate">{title}</h3>
            </div>
            {(docNumber || docDate) && (
              <p className="text-[11px] text-slate-500 tabular-nums truncate">
                {docNumber ? `No: ${docNumber}` : ""}
                {docNumber && docDate ? " · " : ""}
                {docDate ? new Date(docDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Zoom Controls */}
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            {zoom !== 1 && (
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg ml-1"
              aria-label="Close document viewer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center min-h-[300px] p-2 sm:p-4">
          {/* Image Document */}
          {isImage && (
            <div
              className="transition-transform duration-100 ease-out origin-center flex items-center justify-center w-full"
              style={{ transform: `scale(${zoom})` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={title}
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-sm"
              />
            </div>
          )}

          {/* PDF Document */}
          {isPdf && (
            <div className="w-full flex flex-col items-center justify-center">
              {pdfLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                  <p className="text-xs">Loading document...</p>
                </div>
              )}

              {/* Canvas based PDF rendering (works reliably in PWA on Android & iOS) */}
              <div
                className={`flex flex-col items-center justify-center w-full overflow-x-auto ${pdfLoading ? "hidden" : "block"}`}
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
              >
                <canvas
                  ref={canvasRef}
                  className="rounded-lg shadow-md max-w-full bg-white border border-slate-200"
                />
              </div>

              {/* Fallback iframe/object if PDF.js fails or is not available */}
              {pdfError && !pdfRendered && (
                <div className="w-full">
                  <object
                    data={url}
                    type="application/pdf"
                    className="w-full h-[60vh] rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex flex-col items-center justify-center p-6 text-center bg-white rounded-lg border border-slate-200">
                      <FileText className="h-10 w-10 text-slate-400 mb-2" />
                      <p className="text-sm font-semibold text-slate-800">PDF Document: {docNumber || title}</p>
                      <p className="text-xs text-slate-500 mt-1 mb-4 max-w-xs">
                        Embedded PDF preview is not supported directly by your PWA browser. Tap below to open or download the PDF in your device reader.
                      </p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        <a
                          href={url}
                          download={filename}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-ring min-h-[44px]"
                        >
                          <Download className="h-4 w-4" /> Download / Open PDF
                        </a>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 focus-ring min-h-[44px]"
                        >
                          <ExternalLink className="h-4 w-4" /> Open in Browser
                        </a>
                      </div>
                    </div>
                  </object>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-200 bg-white shrink-0">
          {/* PDF Page Controls */}
          {isPdf && numPages && numPages > 1 ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums font-medium">
                Page {currentPage} of {numPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-500 truncate max-w-[200px]">
              {filename}
            </div>
          )}

          {/* Action Links */}
          <div className="flex items-center gap-2 ml-auto">
            <a
              href={url}
              download={filename}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors min-h-[38px]"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors min-h-[38px]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open External
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
