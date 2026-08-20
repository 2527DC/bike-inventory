"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
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

    // Cast the result: next-auth v4's signIn overloads resolve to `never` under this
    // project's "bundler" module resolution, so the returned shape has to be stated here.
    const result = (await signIn("credentials", {
      accessCode: accessCode.trim(),
      redirect: false,
    })) as { error?: string; ok?: boolean } | undefined;

    if (result?.error) {
      setError("Invalid access code. Please try again.");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="BCH OPS" className="h-20 w-20 rounded-2xl object-cover mb-4 shadow-sm" />
          <h1 className="text-2xl font-bold text-slate-900">BCH OPS</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter your access code to continue
          </p>
        </div>

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

        <p className="mt-6 text-xs text-slate-400 text-center">
          Contact admin if you don&apos;t have an access code
        </p>
      </div>
    </div>
  );
}
