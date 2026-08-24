"use client";

// Tracks whether a scroll container has content hidden above or below the visible area.
//
// Exists for the sidebar nav. It lists every module the user can view — 32 entries for an
// admin, roughly 1450px of content in an ~810px slot on a 1080p screen and ~500px on a
// 1366x768 laptop. Everything from the "Insights" group down (Store Analytics included) is
// therefore below the fold on every real screen.
//
// The nav always scrolled; the problem was that nothing SAID so. Overlay scrollbars on
// macOS and Windows 11 stay invisible until a wheel event, so a truncated list is
// indistinguishable from a complete one — a module the user genuinely holds reads as
// missing. These flags drive the fade edges that make the cut-off visible.

import { useCallback, useEffect, useRef, useState } from "react";

export function useScrollShadows<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T | null>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 1px of slack: fractional scroll offsets from browser zoom otherwise leave the bottom
    // fade painted forever at the true end of the list.
    const max = el.scrollHeight - el.clientHeight;
    setAtTop(el.scrollTop <= 1);
    setAtBottom(el.scrollTop >= max - 1);
  }, []);

  // Re-measure when the list itself changes, not just on scroll — the permission fetch
  // resolves after mount, so the first measurement runs against the loading skeleton.
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { ref, atTop, atBottom, onScroll: measure };
}
