"use client";

// The sign-in form. Split out of page.tsx so that page.tsx can be a SERVER component and
// redirect an already-authenticated visitor before any of this renders — see the comment
// there. Nothing about the form itself changed in that split.

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth:login");

export function LoginForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessCode.trim()) {
      setError("Please enter your access code");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Cast the result: next-auth v4's signIn overloads resolve to `never` under this
      // project's "bundler" module resolution, so the returned shape has to be stated here.
      const result = (await signIn("credentials", {
        accessCode: accessCode.trim(),
        redirect: false,
      })) as { error?: string; ok?: boolean } | undefined;

      if (result?.error) {
        // Never log the code itself — it is the only credential this app has.
        log.warn("sign-in rejected");
        setError("Invalid access code. Please try again.");
        setLoading(false);
        return;
      }

      log.info("signed in", { redirectTo });
      // `replace`, not `push`: the login page must not sit in the history stack, or Back
      // returns to it after signing in.
      router.replace(redirectTo);
      router.refresh();
      setLoading(false);
    } catch (err) {
      // signIn rejects on a network failure. Without this the button span forever.
      const msg = err instanceof Error ? err.message : String(err);
      log.error("sign-in request failed", { error: msg });
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Input
          type="text"
          placeholder="Access Code"
          value={accessCode}
          onChange={(e) => {
            setAccessCode(e.target.value.toUpperCase());
            setError("");
          }}
          className="h-12 text-center text-lg tracking-widest uppercase"
          autoFocus
          autoComplete="off"
        />
        {error && (
          <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="w-full h-12"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Signing in...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <LogIn className="h-4 w-4" />
            Sign In
          </span>
        )}
      </Button>
    </form>
  );
}
