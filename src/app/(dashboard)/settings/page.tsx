"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { usePermissions } from "@/lib/use-permissions";
import { moduleIcon } from "@/lib/module-icons";

// The Settings index.
//
// The `settings` module used to point straight at /more/alerts, which stopped making sense
// once it had children: clicking "Settings" in the sidebar landed on the Alerts page rather
// than on a list of settings. This is that list.
//
// Entries are permission-filtered. Frontend checks are cosmetic — every page and API behind
// these links re-checks — but a card that leads to a 403 is still worse than no card.

interface Entry {
  href: string;
  title: string;
  description: string;
  icon: string;
  module: string;
  action?: "view" | "edit";
}

const ENTRIES: Entry[] = [
  {
    href: "/settings/storage",
    title: "Storage",
    description: "Where uploaded photos and videos are kept — S3 or the server filesystem",
    icon: "HardDrive",
    module: "settings_storage",
  },
  {
    href: "/settings/integrations",
    title: "Integrations",
    description: "Zoho Books, Zakya POS and Zoho Inventory connections",
    icon: "Cloud",
    module: "zoho",
  },
  {
    href: "/more/alerts",
    title: "Alerts",
    description: "Who gets notified, and the numbers alerts are sent to",
    icon: "AlertCircle",
    module: "settings",
  },
  {
    href: "/more/bins",
    title: "Bins & Locations",
    description: "Warehouse bins and storage locations",
    icon: "Package",
    module: "settings",
  },
  {
    href: "/more/app-logic",
    title: "App Logic",
    description: "How each screen behaves, and which API it calls",
    icon: "ClipboardList",
    module: "settings",
  },
  {
    href: "/more/label-designer",
    title: "Label Designer",
    description: "Barcode and shelf label layouts",
    icon: "QrCode",
    module: "settings",
  },
  {
    href: "/more/whatsapp-templates",
    title: "WhatsApp Templates",
    description: "Customer messaging templates",
    icon: "MessageSquare",
    module: "whatsapp_templates",
  },
];

export default function SettingsPage() {
  const { can, loading } = usePermissions();

  // Render nothing rather than an empty state while grants are still unknown — otherwise
  // the page flashes "no settings available" to someone who has plenty.
  const visible = loading ? [] : ENTRIES.filter((e) => can(e.module, e.action || "view"));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Settings</h1>
        <p className="text-[11px] text-slate-500">Configure how the application behaves</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-slate-500">
              You do not have access to any settings areas.
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Ask an administrator to grant them at Team → Roles &amp; Permissions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) => {
            const Icon = moduleIcon(entry.icon);
            return (
              <Link key={entry.href} href={entry.href} className="block focus-ring rounded-xl">
                <Card className="hover:border-slate-300 transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon className="h-4.5 w-4.5 text-slate-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                      <p className="text-[11px] text-slate-500 truncate">{entry.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
