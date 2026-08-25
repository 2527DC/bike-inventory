"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Cycle {
  id: string;
  sku: string;
  name: string;
  size?: string | null;
  condition: string;
  photoUrl: string;
  customerName: string;
  isVerified: boolean;
  createdAt: string;
  createdBy?: { name: string };
}

export default function SecondHandVerifyPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const canVerify = role === "CEO" || role === "ADMIN" || role === "SUPERVISOR";

  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/second-hand?verified=false&limit=50").then(r => r.json());
      if (res.success) setCycles(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleVerify = async (id: string) => {
    setVerifying(id);
    try {
      const res = await fetch(`/api/second-hand/${id}/verify`, { method: "POST" }).then(r => r.json());
      if (res.success) {
        setCycles(prev => prev.filter(c => c.id !== id));
      }
    } catch { /* ignore */ }
    setVerifying(null);
  };

  if (!canVerify) {
    return <div className="p-6 text-center text-gray-500">Access denied</div>;
  }

  return (
    <div className="pb-20">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/second-hand"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Verify Second-Hand</h1>
          <p className="text-xs text-slate-500">{cycles.length} pending verification</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : cycles.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">All cycles verified!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-3">
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                    <Image src={c.photoUrl} alt={c.name} width={64} height={64} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.sku} | {c.customerName}</p>
                    <div className="flex gap-1.5 mt-1">
                      <Badge variant="default" className="text-[10px]">{c.condition}</Badge>
                      {c.size && <Badge variant="info" className="text-[10px]">{c.size}</Badge>}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      By {c.createdBy?.name || "—"} | {new Date(c.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <button
                    onClick={() => handleVerify(c.id)}
                    disabled={verifying === c.id}
                    className="self-center px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium disabled:opacity-50 shrink-0"
                  >
                    {verifying === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
