"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

interface Bill {
  id: string;
  billNo: string;
  billDate: string;
  amount: number;
  paidAmount: number;
  status: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
  cdTermsDays: number;
  cdPercentage: number;
  bills: Bill[];
}

interface VendorCdSummary {
  vendorName: string;
  vendorCode: string;
  cdTermsDays: number;
  cdPercentage: number;
  withinWindow: { count: number; totalDiscount: number; bills: string[] };
  cdUsed: { count: number; totalDiscount: number };
  cdExpired: { count: number; totalMissed: number; bills: string[] };
}

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function CdSummaryPage() {
  const [vendors, setVendors] = useState<VendorCdSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ earned: 0, missed: 0, eligible: 0 });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Fetch vendors with CD terms
      const vendorRes = await fetch("/api/vendors?limit=200");
      const vendorData = await vendorRes.json();
      if (!vendorData.success) return;

      const cdVendors = (vendorData.data as Vendor[]).filter(
        (v) => v.cdTermsDays && v.cdPercentage
      );

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const summaries: VendorCdSummary[] = [];
      let totalEarned = 0;
      let totalMissed = 0;
      let totalEligible = 0;

      for (const vendor of cdVendors) {
        // Fetch bills for this vendor from last 90 days
        const billRes = await fetch(
          `/api/bills?vendorId=${vendor.id}&limit=200`
        );
        const billData = await billRes.json();
        if (!billData.success) continue;

        const bills = (billData.data as Bill[]).filter(
          (b) => new Date(b.billDate) >= ninetyDaysAgo
        );

        const withinWindow: { count: number; totalDiscount: number; bills: string[] } = {
          count: 0,
          totalDiscount: 0,
          bills: [],
        };
        const cdUsed: { count: number; totalDiscount: number } = {
          count: 0,
          totalDiscount: 0,
        };
        const cdExpired: { count: number; totalMissed: number; bills: string[] } = {
          count: 0,
          totalMissed: 0,
          bills: [],
        };

        for (const bill of bills) {
          const billDate = new Date(bill.billDate);
          const cdDeadline = new Date(billDate);
          cdDeadline.setDate(cdDeadline.getDate() + vendor.cdTermsDays);
          cdDeadline.setHours(0, 0, 0, 0);

          const discount = Math.round(
            (bill.amount * vendor.cdPercentage) / 100
          );

          // Check if bill has been fully paid (CD was used)
          if (bill.status === "PAID") {
            // If paid within CD window, count as CD used
            cdUsed.count++;
            cdUsed.totalDiscount += discount;
            totalEarned += discount;
          } else if (today <= cdDeadline) {
            // Still within CD window
            withinWindow.count++;
            withinWindow.totalDiscount += discount;
            withinWindow.bills.push(bill.billNo);
            totalEligible += discount;
          } else {
            // CD expired
            cdExpired.count++;
            cdExpired.totalMissed += discount;
            cdExpired.bills.push(bill.billNo);
            totalMissed += discount;
          }
        }

        if (bills.length > 0) {
          summaries.push({
            vendorName: vendor.name,
            vendorCode: vendor.code,
            cdTermsDays: vendor.cdTermsDays,
            cdPercentage: vendor.cdPercentage,
            withinWindow,
            cdUsed,
            cdExpired,
          });
        }
      }

      setVendors(summaries);
      setTotals({ earned: totalEarned, missed: totalMissed, eligible: totalEligible });
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/reports"
          aria-label="Back"
          className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Link>
        <h1 className="text-lg font-bold text-slate-900">CD Discount Summary</h1>
      </div>

      {/* Totals */}
      {!loading && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-3">
              <p className="text-[11px] text-green-600 uppercase font-medium">Earned</p>
              <p className="text-xl font-bold text-green-700 tabular-nums">{fmt(totals.earned)}</p>
            </CardContent>
          </Card>
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-3">
              <p className="text-[11px] text-red-600 uppercase font-medium">Missed</p>
              <p className="text-xl font-bold text-red-700 tabular-nums">{fmt(totals.missed)}</p>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-3">
              <p className="text-[11px] text-blue-600 uppercase font-medium">Eligible</p>
              <p className="text-xl font-bold text-blue-700 tabular-nums">{fmt(totals.eligible)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-xs text-slate-400 mb-3">Last 90 days</p>

      {loading ? (
        <SkeletonList count={5} type="card" />
      ) : vendors.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">
          No vendors with CD terms configured
        </p>
      ) : (
        <div className="space-y-3">
          {vendors.map((v) => (
            <Card key={v.vendorCode}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{v.vendorName}</p>
                    <p className="text-xs text-slate-500 tabular-nums">
                      {v.cdPercentage}% in {v.cdTermsDays} days
                    </p>
                  </div>
                  <Badge variant="info" className="text-[11px]">
                    {v.vendorCode}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-2">
                  {/* Within window */}
                  <div className="bg-blue-50 rounded-lg p-2">
                    <p className="text-[11px] text-blue-600 font-medium">Eligible</p>
                    <p className="text-xl font-bold text-blue-700 tabular-nums">
                      {v.withinWindow.count}
                    </p>
                    <p className="text-[11px] text-blue-500 tabular-nums">
                      {fmt(v.withinWindow.totalDiscount)}
                    </p>
                  </div>

                  {/* CD used */}
                  <div className="bg-green-50 rounded-lg p-2">
                    <p className="text-[11px] text-green-600 font-medium">Earned</p>
                    <p className="text-xl font-bold text-green-700 tabular-nums">
                      {v.cdUsed.count}
                    </p>
                    <p className="text-[11px] text-green-500 tabular-nums">
                      {fmt(v.cdUsed.totalDiscount)}
                    </p>
                  </div>

                  {/* CD expired */}
                  <div className="bg-red-50 rounded-lg p-2">
                    <p className="text-[11px] text-red-600 font-medium">Missed</p>
                    <p className="text-xl font-bold text-red-700 tabular-nums">
                      {v.cdExpired.count}
                    </p>
                    <p className="text-[11px] text-red-500 tabular-nums">
                      {fmt(v.cdExpired.totalMissed)}
                    </p>
                  </div>
                </div>

                {v.withinWindow.bills.length > 0 && (
                  <p className="text-[11px] text-blue-500 mt-2 tabular-nums">
                    Eligible bills: {v.withinWindow.bills.join(", ")}
                  </p>
                )}
                {v.cdExpired.bills.length > 0 && (
                  <p className="text-[11px] text-red-400 mt-1 tabular-nums">
                    Missed bills: {v.cdExpired.bills.join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
