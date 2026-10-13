"use client";

// The stores, staff and recent typed payers the form needs, from GET /api/expenses/options.
// Loaded once, when the person is known to hold Expenses › Create — the route is guarded by the
// same grant, so asking earlier only earns a 403. No polling: Retry is the only reload.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiTry } from "@/lib/api-client";
import { createLogger } from "@/lib/logger";
import type { ExpenseOptions } from "./types";

const log = createLogger("expenses:entry");

export function useExpenseOptions(enabled: boolean) {
  const router = useRouter();
  const [options, setOptions] = useState<ExpenseOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A promise chain rather than an async body: state is set inside the callback, which is
  // what react-hooks/set-state-in-effect asks for when an effect kicks off the first load.
  const load = useCallback(
    () =>
      apiTry<ExpenseOptions>("/api/expenses/options").then(({ data, error: err, isAuth, status }) => {
        if (err || !data) {
          log.error("options failed to load", { status, message: err });
          if (isAuth) {
            // Left loading: the spinner stays up while the login page replaces this one.
            router.push("/login");
            return;
          }
          setError(err || "Could not load the stores and staff list.");
          setLoading(false);
          return;
        }
        // Counts only — the payload carries people's names.
        log.debug("options loaded", {
          stores: data.stores.length,
          users: data.users.length,
          recentPayers: data.recentPayers.length,
        });
        setOptions(data);
        setError("");
        setLoading(false);
      }),
    [router]
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  function retry() {
    setLoading(true);
    setError("");
    void load();
  }

  return { options, loading, error, retry };
}
