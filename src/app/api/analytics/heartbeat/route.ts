// Agent liveness — the canonical mount. See src/lib/analytics/ingest-handlers.ts.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { handleHeartbeat } from "@/lib/analytics/ingest-handlers";

export const POST = handleHeartbeat;
