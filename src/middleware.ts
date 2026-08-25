import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    // Protect everything except the login/fill pages, public/auth APIs, the device-facing
    // analytics ingest endpoints, Next internals, and any static asset file (extension
    // match — covers /logo.jpg, /icon.png, /icons/*, favicon.ico, manifest.json, etc.) so
    // unauthenticated pages like /login can load images.
    //
    // ── Why the analytics/v1 entries are here ────────────────────────────────
    // These four are posted to by a Python agent on the store laptop. It has no browser, no
    // cookie and no user account; it authenticates with an `x-api-key` header that
    // src/lib/analytics/device-auth.ts checks inside the handler.
    //
    // Without these exclusions withAuth intercepts the agent before the handler ever runs,
    // and the failure is SILENT in the worst way: `requests` follows the redirect, fetches
    // /login, gets a perfectly good 200 HTML page, and the agent marks the batch delivered —
    // then purges it three days later. Counted customers vanish with no error anywhere, and
    // a dashboard reading low looks exactly like a quiet day in the shop.
    //
    // Each analytics path is listed in full ON PURPOSE. `api/v1` or `api/analytics` as a
    // prefix would work today and would silently make every future route beneath them
    // public — /api/analytics/dashboard is business data and must stay behind the session.
    //
    // ── Scheduler routes ─────────────────────────────────────────────────────
    // `api/cron`, `api/services/cron` and `api/earn-sync` are invoked by Vercel Cron and by
    // external pollers. No user exists, so withAuth redirected them to /login — including
    // requests carrying the correct Bearer token, because withAuth reads the session cookie
    // and never looks at the Authorization header.
    //
    // These are listed in CLAUDE.md under "routes that must stay public"; the matcher had
    // simply never been updated to match. Measured 21 Aug 2026: all three of the crons in
    // vercel.json (zoho-pull, overdue-alerts, invoice-pull) returned 307 to /login.
    //
    // Prefixes are correct HERE, unlike above, because the whole directory has one purpose.
    // The contract that makes it safe: **every route beneath these prefixes MUST check
    // CRON_SECRET (or its own shared key) in the handler.** All five do today. A new route
    // added without that check is public to the internet.
    "/((?!login|fill|api/auth|api/public|api/cron|api/services/cron|api/earn-sync|api/analytics/counts|api/analytics/heartbeat|api/v1/counts|api/v1/heartbeat|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|txt|xml|html|webmanifest|js|mjs|css|map|woff|woff2|ttf)).*)",
  ],
};
