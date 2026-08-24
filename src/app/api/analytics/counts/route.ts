// Footfall ingest — the canonical mount. See src/lib/analytics/ingest-handlers.ts.
//
// Device-authenticated (x-api-key), no session. This path MUST stay in the middleware
// matcher's exclusion list or NextAuth intercepts the agent before the handler runs.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { handleCounts } from "@/lib/analytics/ingest-handlers";

export const POST = handleCounts;
