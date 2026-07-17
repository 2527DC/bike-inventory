"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertCircle, Plus, Check, Clock, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";

interface Problem {
  id: string;
  text: string;
  category: string;
  status: string;
  createdAt: string;
  user: { name: string };
}

const CATEGORIES = ["bug", "improvement", "feature", "ux", "general"];

export default function ProblemsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role || "";
  const isAdmin = role === "ADMIN" || role === "CEO";

  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");

  const fetchProblems = () => {
    fetch("/api/problems")
      .then((r) => r.json())
      .then((res) => { if (res.success) setProblems(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProblems(); }, []);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, category }),
      });
      const json = await res.json();
      if (json.success) {
        setText("");
        setCategory("general");
        fetchProblems();
      }
    } catch { /* */ }
    finally { setSaving(false); }
  };

  const handleResolve = async (id: string) => {
    await fetch("/api/problems", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    fetchProblems();
  };

  const filtered = problems.filter((p) => {
    if (filter === "open") return p.status === "open";
    if (filter === "resolved") return p.status === "resolved";
    return true;
  });

  return (
    <div className="pb-24">
      <div className="flex items-center gap-3 mb-3">
        <Link href="/more" aria-label="Back" className="p-2 -ml-2 rounded-lg hover:bg-slate-100 focus-ring"><ArrowLeft className="h-5 w-5 text-slate-600" /></Link>
        <h1 className="text-lg font-bold text-slate-900">App Problems</h1>
      </div>
      <p className="text-xs text-slate-500 mb-4">Log bugs, improvements, or feature requests. Pull these into Claude Code to fix.</p>

      {/* Add Problem */}
      <Card className="mb-4 border-blue-200 bg-blue-50/30">
        <CardContent className="p-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the problem, bug, or improvement..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex items-center gap-2">
            <div className="flex gap-1 flex-1 overflow-x-auto">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`shrink-0 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-colors focus-ring ${
                    category === c ? "bg-blue-600 text-white" : "bg-white text-slate-600 border border-slate-200"
                  }`}>
                  {c}
                </button>
              ))}
            </div>
            <button onClick={handleSubmit} disabled={!text.trim() || saving}
              className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 shrink-0 focus-ring">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Log
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex gap-2 mb-3">
        {(["open", "resolved", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 min-h-[44px] rounded-full text-xs font-medium focus-ring ${filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f === "open" ? `Open (${problems.filter((p) => p.status === "open").length})` : f === "resolved" ? "Resolved" : "All"}
          </button>
        ))}
      </div>

      {/* Problems List */}
      {loading ? (
        <SkeletonList count={4} type="card" />
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <AlertCircle className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">{filter === "open" ? "No open problems" : "No problems found"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className={p.status === "resolved" ? "opacity-60" : ""}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-900 whitespace-pre-wrap">{p.text}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge className="text-[11px] px-1.5 py-0 bg-slate-100 text-slate-600">{p.category}</Badge>
                      <span className="text-[11px] text-slate-500">{p.user.name}</span>
                      <span className="text-[11px] text-slate-500 tabular-nums">{new Date(p.createdAt).toLocaleDateString("en-IN")}</span>
                    </div>
                  </div>
                  {p.status === "open" && isAdmin && (
                    <button onClick={() => handleResolve(p.id)}
                      className="p-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 shrink-0 focus-ring" aria-label="Mark resolved" title="Mark resolved">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {p.status === "open" && (
                    <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-1" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
