// The login screen.
//
// A SERVER component, deliberately, and this is the whole reason for the file split.
//
// THE BUG THIS FIXES
// ------------------
// `/login` is excluded from the middleware matcher (src/middleware.ts) so that someone with
// no session can reach it — that exclusion is correct and must stay. But it also means
// `withAuth` never runs here, and the page itself used to be a client component that never
// asked whether anyone was already signed in. So a signed-in user could open /login, see the
// form, and sign in again as somebody else.
//
// On a shared counter phone that is not cosmetic: the session swaps under the previous user
// without them signing out, and the push device row registered to them stays behind (see
// docs/code-review-2026-09-02.md §5.5), so notifications for the previous user keep arriving
// on a device now held by someone else.
//
// Checking here rather than in middleware keeps the matcher exclusion honest: the page stays
// reachable without a session, and only the redirect is conditional.
//
// `getCurrentUser()` rather than `getServerSession()` on purpose — it re-reads the row, so a
// DEACTIVATED account holding a still-valid cookie is treated as signed out and stays on this
// page. Redirecting it to "/" instead would bounce it into a dashboard it cannot use.

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-helpers";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const user = await getCurrentUser();
  const { callbackUrl } = await searchParams;

  // Only ever redirect to a path on this origin. A `callbackUrl` arrives from the middleware
  // as a query parameter, so an absolute URL there would be an open redirect — hand someone a
  // /login?callbackUrl=https://… link and a signed-in click lands them off-site.
  const safeTarget =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";

  if (user) redirect(safeTarget);

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

        <LoginForm redirectTo={safeTarget} />

        <p className="mt-6 text-xs text-slate-400 text-center">
          Contact admin if you don&apos;t have an access code
        </p>
      </div>
    </div>
  );
}
