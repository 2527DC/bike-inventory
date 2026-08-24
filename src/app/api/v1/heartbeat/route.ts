// COMPATIBILITY ALIAS — do not add logic here. See ../counts/route.ts for why this exists.
//
// counter.py posts to `{CLOUD}/api/v1/heartbeat` every 60 seconds and deliberately swallows
// every error from that call ("the cloud noticing the gap IS the alert"), so a broken
// heartbeat path is invisible at the agent end and looks like an outage at this end.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { handleHeartbeat } from "@/lib/analytics/ingest-handlers";

export const POST = handleHeartbeat;
