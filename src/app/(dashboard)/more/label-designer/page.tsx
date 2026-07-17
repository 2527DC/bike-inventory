"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Save, RotateCcw, Eye, EyeOff, GripVertical,
  Bold, AlignLeft, AlignCenter, AlignRight, Minus, Plus, Printer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  type LabelTemplate, type LabelElement,
  DEFAULT_TEMPLATE, loadTemplate, saveTemplate, formatFieldValue,
} from "@/lib/label-template";

const SAMPLE_PRODUCT = {
  name: "HERO SPRINT 26T MTB",
  sku: "7653",
  mrp: 12499,
  sellingPrice: 10999,
  brand: "HERO",
};

const LABEL_SIZES = [
  { label: "50 x 25mm", w: 50, h: 25 },
  { label: "50 x 38mm", w: 50, h: 38 },
  { label: "38 x 25mm", w: 38, h: 25 },
  { label: "75 x 50mm", w: 75, h: 50 },
];

export default function LabelDesignerPage() {
  const [template, setTemplate] = useState<LabelTemplate>(DEFAULT_TEMPLATE);
  const [saved, setSaved] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [barcodeImg, setBarcodeImg] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTemplate(loadTemplate());
  }, []);

  // Generate barcode preview
  const generateBarcode = useCallback(async () => {
    try {
      const res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: SAMPLE_PRODUCT.sku, type: "code128" }),
      });
      if (res.ok) {
        const data = await res.json();
        setBarcodeImg(data.image);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => { generateBarcode(); }, [generateBarcode]);

  function updateElement(id: string, updates: Partial<LabelElement>) {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    }));
    setSaved(false);
  }

  function handleSave() {
    saveTemplate(template);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    setTemplate(DEFAULT_TEMPLATE);
    saveTemplate(DEFAULT_TEMPLATE);
  }

  // Drag and drop reorder
  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setTemplate((t) => {
      const els = [...t.elements];
      const [moved] = els.splice(dragIdx, 1);
      els.splice(idx, 0, moved);
      return { ...t, elements: els };
    });
    setDragIdx(idx);
    setSaved(false);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  function handlePrintPreview() {
    if (!printRef.current) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const doc = win.document;
    doc.open();
    doc.write(`<html><head><title>Label Preview</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; }
        @media print {
          @page { size: ${template.width}mm ${template.height}mm; margin: 0; }
          body { width: ${template.width}mm; height: ${template.height}mm; }
        }
      </style>
    </head><body></body></html>`);
    doc.close();
    const body = doc.body;
    body.innerHTML = printRef.current.querySelector(".label-inner")?.innerHTML || "";
    body.style.padding = `${template.padding}mm`;
    body.style.width = `${template.width}mm`;
    body.style.height = `${template.height}mm`;
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.justifyContent = "center";
    win.print();
  }

  const visibleElements = template.elements.filter((el) => el.visible);

  // Scale factor for preview (1mm ≈ 3.78px, we scale up for visibility)
  const scale = 4;

  return (
    <div className="pb-20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
          <h1 className="text-lg font-bold text-slate-900">Label Designer</h1>
        </div>
        <div className="flex gap-1.5">
          <button onClick={handlePrintPreview}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 focus-ring">
            <Printer className="h-3.5 w-3.5" /> Test
          </button>
          <button onClick={handleReset}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 focus-ring">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button onClick={handleSave}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium focus-ring ${
              saved ? "bg-green-600 text-white" : "bg-slate-900 text-white"
            }`}>
            <Save className="h-3.5 w-3.5" /> {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {/* Label Size Selector */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Label Size</p>
        <div className="flex gap-2">
          {LABEL_SIZES.map((s) => (
            <button key={s.label} onClick={() => { setTemplate((t) => ({ ...t, width: s.w, height: s.h })); setSaved(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors focus-ring ${
                template.width === s.w && template.height === s.h
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Preview */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Preview</p>
        <div className="bg-slate-100 rounded-xl p-4 flex items-center justify-center">
          <div ref={printRef}>
            <div className="label-inner bg-white border border-slate-300 shadow-sm flex flex-col justify-center overflow-hidden"
              style={{
                width: `${template.width * scale}px`,
                height: `${template.height * scale}px`,
                padding: `${template.padding * scale}px`,
              }}>
              {visibleElements.map((el) => {
                if (el.type === "barcode") {
                  return (
                    <div key={el.id} className="flex justify-center" style={{ margin: `${scale * 0.5}px 0` }}>
                      {barcodeImg ? (
                        <img src={barcodeImg} alt="barcode" style={{ height: `${template.barcodeHeight * scale}px`, objectFit: "contain" }} />
                      ) : (
                        <div className="bg-slate-200 flex items-center justify-center text-[8px] text-slate-400"
                          style={{ height: `${template.barcodeHeight * scale}px`, width: "80%" }}>
                          BARCODE
                        </div>
                      )}
                    </div>
                  );
                }
                const value = formatFieldValue(el.field, SAMPLE_PRODUCT);
                if (!value) return null;
                // MRP and Offer Price on same line when both adjacent
                return (
                  <p key={el.id} style={{
                    fontSize: `${el.fontSize * scale * 0.3}px`,
                    fontWeight: el.bold ? "bold" : "normal",
                    textAlign: el.align,
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {value}
                  </p>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Barcode Height */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <p className="text-xs text-slate-600">Barcode Height</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { setTemplate((t) => ({ ...t, barcodeHeight: Math.max(4, t.barcodeHeight - 1) })); setSaved(false); }}
            aria-label="Decrease barcode height" className="p-1 rounded bg-slate-100 hover:bg-slate-200 focus-ring"><Minus className="h-3 w-3" /></button>
          <span className="text-xs font-mono tabular-nums w-8 text-center">{template.barcodeHeight}mm</span>
          <button onClick={() => { setTemplate((t) => ({ ...t, barcodeHeight: Math.min(20, t.barcodeHeight + 1) })); setSaved(false); }}
            aria-label="Increase barcode height" className="p-1 rounded bg-slate-100 hover:bg-slate-200 focus-ring"><Plus className="h-3 w-3" /></button>
        </div>
      </div>

      {/* Element Editor (drag to reorder) */}
      <div>
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Elements (drag to reorder)</p>
        <div className="space-y-1.5">
          {template.elements.map((el, idx) => (
            <Card key={el.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`transition-colors ${dragIdx === idx ? "border-blue-400 bg-blue-50/30" : ""} ${!el.visible ? "opacity-50" : ""}`}>
              <CardContent className="p-2.5">
                <div className="flex items-center gap-2">
                  {/* Drag Handle */}
                  <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none">
                    <GripVertical className="h-4 w-4" />
                  </div>

                  {/* Visibility Toggle */}
                  <button onClick={() => updateElement(el.id, { visible: !el.visible })}
                    aria-label={el.visible ? `Hide ${el.label}` : `Show ${el.label}`}
                    className={`shrink-0 p-1 rounded focus-ring ${el.visible ? "text-green-600" : "text-slate-300"}`}>
                    {el.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>

                  {/* Label */}
                  <span className="text-xs font-medium text-slate-700 flex-1 min-w-0">{el.label}</span>

                  {/* Controls (only for text elements) */}
                  {el.type === "text" && el.visible && (
                    <div className="flex items-center gap-1">
                      {/* Font Size */}
                      <button onClick={() => updateElement(el.id, { fontSize: Math.max(4, el.fontSize - 1) })}
                        aria-label="Decrease font size" className="p-0.5 rounded bg-slate-100 hover:bg-slate-200 focus-ring"><Minus className="h-2.5 w-2.5" /></button>
                      <span className="text-[11px] font-mono tabular-nums w-5 text-center">{el.fontSize}</span>
                      <button onClick={() => updateElement(el.id, { fontSize: Math.min(14, el.fontSize + 1) })}
                        aria-label="Increase font size" className="p-0.5 rounded bg-slate-100 hover:bg-slate-200 focus-ring"><Plus className="h-2.5 w-2.5" /></button>

                      {/* Bold */}
                      <button onClick={() => updateElement(el.id, { bold: !el.bold })}
                        aria-label="Toggle bold" aria-pressed={el.bold}
                        className={`p-1 rounded focus-ring ${el.bold ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <Bold className="h-3 w-3" />
                      </button>

                      {/* Alignment */}
                      <button onClick={() => updateElement(el.id, { align: "left" })}
                        aria-label="Align left" aria-pressed={el.align === "left"}
                        className={`p-1 rounded focus-ring ${el.align === "left" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <AlignLeft className="h-3 w-3" />
                      </button>
                      <button onClick={() => updateElement(el.id, { align: "center" })}
                        aria-label="Align center" aria-pressed={el.align === "center"}
                        className={`p-1 rounded focus-ring ${el.align === "center" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <AlignCenter className="h-3 w-3" />
                      </button>
                      <button onClick={() => updateElement(el.id, { align: "right" })}
                        aria-label="Align right" aria-pressed={el.align === "right"}
                        className={`p-1 rounded focus-ring ${el.align === "right" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <AlignRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
