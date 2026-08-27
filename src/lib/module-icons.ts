"use client";

// Maps the `icon` string stored on a module row to a real lucide component.
//
// The DB stores an icon NAME rather than a component because a database cannot hold a React
// component, and shipping the entire lucide library to the client to look one up dynamically
// would be far heavier than this explicit map. Adding a module with a new icon means adding one
// line here; an unknown name falls back rather than crashing the sidebar.

import {
  LayoutDashboard,
  Package,
  ArrowDownCircle,
  Truck,
  ArrowRightLeft,
  ClipboardCheck,
  Bike,
  QrCode,
  CreditCard,
  Building2,
  ShoppingCart,
  Tag,
  AlertCircle,
  RefreshCw,
  FileText,
  Receipt,
  HandCoins,
  BarChart3,
  Users,
  ShieldCheck,
  Settings,
  MessageSquare,
  Cloud,
  ClipboardList,
  IndianRupee,
  Wrench,
  Activity,
  GraduationCap,
  BookOpen,
  Trophy,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Package,
  ArrowDownCircle,
  Truck,
  ArrowRightLeft,
  ClipboardCheck,
  Bike,
  QrCode,
  CreditCard,
  Building2,
  ShoppingCart,
  Tag,
  AlertCircle,
  RefreshCw,
  FileText,
  Receipt,
  HandCoins,
  BarChart3,
  Users,
  ShieldCheck,
  Settings,
  MessageSquare,
  Cloud,
  ClipboardList,
  IndianRupee,
  Wrench,
  Activity,
  GraduationCap,
  BookOpen,
  Trophy,
};

export function moduleIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Package;
}
