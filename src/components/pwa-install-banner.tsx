"use client";

import { useState, useEffect } from "react";
import { Download, X, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already running in standalone PWA mode
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsStandalone(isStandaloneMode);
    if (isStandaloneMode) return;

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isAppleDevice);

    const hasDismissed = localStorage.getItem("bch_pwa_banner_dismissed");
    if (hasDismissed) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If iOS and not standalone and not dismissed, show iOS installation hint
    if (isAppleDevice && !isStandaloneMode && !hasDismissed) {
      setShowBanner(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    try {
      localStorage.setItem("bch_pwa_banner_dismissed", "true");
    } catch {
      // ignore
    }
  };

  if (isStandalone || !showBanner) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 max-w-md mx-auto animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between gap-3 p-3.5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600/30 text-indigo-400 rounded-xl">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold leading-tight">Install BCH OPS App</p>
            <p className="text-[11px] text-slate-300 leading-tight mt-0.5">
              {isIos
                ? "Tap Share ⎋ then 'Add to Home Screen' for full PWA experience"
                : "Add to home screen for fast offline access and barcode scanning"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isIos && deferredPrompt && (
            <Button
              size="sm"
              onClick={handleInstallClick}
              className="h-8 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 rounded-lg"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Install
            </Button>
          )}
          <button
            onClick={handleDismiss}
            aria-label="Dismiss banner"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
