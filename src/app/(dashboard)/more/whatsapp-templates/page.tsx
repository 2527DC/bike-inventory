"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Save, RotateCcw, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonList } from "@/components/ui/skeleton";

const PLACEHOLDERS: Record<string, string[]> = {
  scheduled: ["{{customerName}}", "{{productName}}", "{{deliveryDate}}"],
  dispatched: [
    "{{customerName}}", "{{productName}}", "{{vehicleNo}}",
    "{{trackingLink}}", "{{lineItems}}", "{{accessories}}",
  ],
  delivered: ["{{customerName}}", "{{reviewLink}}"],
};

const DEFAULTS: Record<string, string> = {
  scheduled: `Hello {{customerName}},

Your order from Bharath Cycle Hub has been scheduled for delivery.

Product: {{productName}}
Delivery Date: {{deliveryDate}}

Please share your delivery location on WhatsApp so our rider can reach you.

Thank you!
- Bharath Cycle Hub`,

  dispatched: `Hello {{customerName}},

Your {{productName}} is on the way!

Vehicle No: {{vehicleNo}}
Track: {{trackingLink}}

Items:
{{lineItems}}

Free Accessories:
{{accessories}}

Thank you for choosing Bharath Cycle Hub!`,

  delivered: `Hello {{customerName}},

Thank you for your purchase from Bharath Cycle Hub!

We'd love to hear about your experience. Please leave us a review:
{{reviewLink}}

Thank you!
- Bharath Cycle Hub`,
};

export default function WhatsAppTemplatesPage() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"scheduled" | "dispatched" | "delivered">("dispatched");

  useEffect(() => {
    fetch("/api/whatsapp-templates")
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setTemplates(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/alerts/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappTemplates: templates }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleReset = (type: string) => {
    setTemplates((prev) => ({ ...prev, [type]: DEFAULTS[type] }));
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
          <h1 className="text-lg font-bold text-slate-900">WhatsApp Templates</h1>
        </div>
        <SkeletonList count={4} type="card" />
      </div>
    );
  }

  const TABS = [
    { key: "scheduled" as const, label: "Scheduled" },
    { key: "dispatched" as const, label: "Dispatched" },
    { key: "delivered" as const, label: "Delivered" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">WhatsApp Templates</h1>
          <p className="text-xs text-slate-500">Customize delivery messages sent to customers</p>
        </div>
      </div>

      <Card className="mb-3 bg-green-50 border-green-200">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle className="h-4 w-4 text-green-600" />
            <p className="text-xs font-semibold text-green-900">Template Placeholders</p>
          </div>
          <p className="text-[11px] text-green-700">
            Use these placeholders in your messages. They get replaced with actual values when sending.
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {PLACEHOLDERS[activeTab].map((p) => (
              <span key={p} className="text-[11px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-mono">{p}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-3">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-colors focus-ring ${
              activeTab === tab.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Template Editor */}
      <div className="mb-3">
        <label htmlFor="template-editor" className="block text-sm font-medium text-slate-700 mb-1.5">
          Message template
        </label>
        <textarea
          id="template-editor"
          value={templates[activeTab] || ""}
          onChange={(e) => setTemplates((prev) => ({ ...prev, [activeTab]: e.target.value }))}
          rows={12}
          className="w-full border border-slate-200 rounded-lg p-3 text-xs text-slate-800 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          placeholder={`Enter ${activeTab} message template...`}
        />
      </div>

      {/* Reset to Default */}
      <button onClick={() => handleReset(activeTab)}
        className="flex items-center gap-1.5 min-h-[44px] text-xs text-slate-500 mb-4 hover:text-slate-700 focus-ring rounded-lg">
        <RotateCcw className="h-3 w-3" /> Reset to default
      </button>

      {/* Save */}
      <button onClick={handleSave} disabled={saving}
        className="w-full flex items-center justify-center gap-2 min-h-[48px] bg-green-600 text-white py-3 rounded-lg text-sm font-medium disabled:opacity-50 focus-ring">
        <Save className="h-4 w-4" />
        {saving ? "Saving..." : saved ? "Saved!" : "Save All Templates"}
      </button>
    </div>
  );
}
