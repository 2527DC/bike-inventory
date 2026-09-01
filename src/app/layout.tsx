import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SessionProvider } from "@/components/session-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// Inter, self-hosted — NOT next/font/google.
//
// `Inter({ subsets: ["latin"] })` downloads the font from fonts.googleapis.com AT BUILD
// TIME, so every build needs to reach Google. Three builds in a row failed here with
//
//   next/font: error: Failed to fetch `Inter` from Google Fonts
//
// on nothing worse than a flaky connection, and CI would fail the same way for the same
// reason — a build that cannot run offline is a build that fails for reasons unrelated to
// the code being built.
//
// This is the same file Google would have served: the latin subset of the Inter VARIABLE
// font, 48 KB, covering weights 100-900 in one file, so nothing is lost by self-hosting
// it. next/font/local applies the identical treatment — a CSS variable, preload, and a
// size-adjusted fallback to stop layout shift — with no network call.
//
// To update it, download the latin `.woff2` that
// https://fonts.googleapis.com/css2?family=Inter:wght@100..900 serves to a modern browser
// and replace the file. That is a deliberate, occasional act rather than something every
// build depends on.
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  // Metrics for the fallback face while the web font loads. Without this the browser swaps
  // from a differently-proportioned system font and the page visibly reflows.
  fallback: ["system-ui", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "BCH OPS",
  description: "Bicycle store inventory and accounts management",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BCH OPS",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="min-h-full bg-slate-50 font-sans antialiased">
        <SessionProvider>
          <ServiceWorkerRegister />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
