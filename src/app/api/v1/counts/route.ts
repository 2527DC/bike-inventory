// COMPATIBILITY ALIAS — do not add logic here.
//
// This is the path the deployed edge agents already post to: `CLOUD_URL` lives in agent/.env
// on the store laptop and the path is hardcoded in counter.py:
//
//     requests.post(f"{CLOUD}/api/v1/counts", json=payload, headers=headers, timeout=15)
//
// Removing this mount does not produce an error anyone would see. The agent treats a 404 as
// retryable, backs off to a 300-second ceiling, and keeps counting into its local SQLite
// queue — so the only symptom is a dashboard that quietly stops rising.
//
// Retire it only after every agent is confirmed on a new CLOUD_URL (plan §5, phase 8).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { handleCounts } from "@/lib/analytics/ingest-handlers";

export const POST = handleCounts;
