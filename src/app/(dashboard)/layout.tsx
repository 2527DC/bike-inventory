"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Header } from "@/components/header";
import { BottomNav } from "@/components/bottom-nav";
import { AppSidebar } from "@/components/app-sidebar";
import type { Role } from "@/types";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    redirect("/login");
  }

  if (!(session?.user as { userId?: string })?.userId) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar (lg+) */}
      <AppSidebar className="hidden lg:flex" />

      <div className="flex flex-col flex-1 min-w-0 min-h-screen">
        {/* Mobile top header (hidden on desktop — sidebar carries branding/user) */}
        <div className="lg:hidden">
          <Header />
        </div>

        <main className="flex-1 pb-nav lg:pb-10">
          <div className="max-w-lg lg:max-w-6xl xl:max-w-7xl mx-auto px-4 py-4 lg:px-8 lg:py-6">{children}</div>
        </main>

        {/* Mobile bottom nav (hidden on desktop) */}
        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
