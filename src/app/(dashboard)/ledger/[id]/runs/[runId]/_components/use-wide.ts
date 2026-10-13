"use client";

// true from Tailwind's `lg` (1024 px): the rows render as a table there and as cards below it.
// One layout in the DOM, not both hidden by CSS — a statement can carry thousands of rows, each
// with seven inputs. A matchMedia listener, not a timer; the server renders the phone layout.
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
