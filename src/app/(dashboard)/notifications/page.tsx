"use client";

// ─── /notifications — the signed-in user's own inbox (plan 2309, Part D) ──────
//
// Every user, no permission check: the API returns only the session user's rows. Newest first,
// 30 at a time; unread rows are bold. Opening one marks it read and follows its link; "Mark all
// read" clears the lot. Every change feeds the shared unread count, which also drives the header
// bell and the installed app's icon badge.
//
// Loads on mount and when the person asks (Load more, Try again). No polling.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { apiFetch, apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { useInboxStore } from "@/stores/inbox";
import type { InboxItem } from "@/lib/notify/types";

const log = createLogger("notifications:page");

interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  unread: number;
}

export default function NotificationsPage() {
  const router = useRouter();
  const setUnread = useInboxStore((s) => s.setUnread);
  const unread = useInboxStore((s) => s.unread);

  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await apiTry<InboxPage>("/api/notifications/inbox");
    if (err || !data) {
      log.error("inbox load failed", { error: err ?? "empty response" });
      setError(err || "Could not load your notifications.");
    } else {
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setUnread(data.unread);
    }
    setLoading(false);
  }, [setUnread]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const { data, error: err } = await apiTry<InboxPage>(
      `/api/notifications/inbox?cursor=${encodeURIComponent(nextCursor)}`
    );
    if (err || !data) {
      log.error("inbox next page failed", { error: err ?? "empty response" });
      setError(err || "Could not load more notifications.");
    } else {
      setItems((prev) => [...(prev ?? []), ...data.items]);
      setNextCursor(data.nextCursor);
      setUnread(data.unread);
    }
    setLoadingMore(false);
  }

  async function open(item: InboxItem) {
    if (!item.readAt) {
      // Optimistic, then settle on the server's count. A failed mark is logged and harmless:
      // the item simply shows unread again on the next load.
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)) ?? prev);
      try {
        const res = await apiFetch<{ unread: number }>("/api/notifications/inbox/read", {
          method: "POST",
          json: { ids: [item.id] },
        });
        setUnread(res.unread);
      } catch (e) {
        log.warn("mark read failed", { id: item.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (item.link) router.push(item.link);
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError("");
    try {
      const res = await apiFetch<{ unread: number; marked: number }>("/api/notifications/inbox/read", {
        method: "POST",
        json: { all: true },
      });
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((i) => (i.readAt ? i : { ...i, readAt: now })) ?? prev);
      setUnread(res.unread);
      log.debug("marked all read", { marked: res.marked });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not mark them read";
      log.error("mark all read failed", { error: msg });
      setError(msg);
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900">Notifications</h1>
          <p className="text-xs text-slate-500">
            {unread > 0 ? `${unread} unread` : "You're all caught up"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={markingAll || unread === 0 || loading}
          className="shrink-0 min-h-[44px]"
        >
          <CheckCheck className="h-4 w-4 mr-1.5" />
          {markingAll ? "Marking…" : "Mark all read"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError("")} />}

      {loading && (
        <Card className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        </Card>
      )}

      {!loading && items && items.length === 0 && (
        <Card className="px-4 py-10 text-center">
          <Bell className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">No notifications yet</p>
          <p className="text-xs text-slate-500 mt-1">They appear here as they are sent to you.</p>
        </Card>
      )}

      {!loading && items && items.length > 0 && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {items.map((item) => {
            const isUnread = !item.readAt;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void open(item)}
                className={cn(
                  "w-full text-left px-4 py-3 min-h-[44px] flex gap-3 hover:bg-slate-50 focus-ring",
                  isUnread && "bg-blue-50/40"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", isUnread ? "bg-blue-600" : "bg-transparent")}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm text-slate-900 break-words", isUnread ? "font-semibold" : "font-normal")}>
                    {item.title}
                    {isUnread && <span className="sr-only"> (unread)</span>}
                  </span>
                  <span className="block text-xs text-slate-600 mt-0.5 break-words whitespace-pre-line">{item.body}</span>
                  <span className="block text-[11px] text-slate-400 mt-1" title={new Date(item.createdAt).toLocaleString()}>
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </span>
                </span>
              </button>
            );
          })}
        </Card>
      )}

      {!loading && nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-[44px]">
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
