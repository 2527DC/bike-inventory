// Request handlers for the two device-facing ingest endpoints.
//
// They live here rather than inside a route file because each is mounted at TWO paths:
//
//   /api/analytics/counts      the real name, matching this app's conventions
//   /api/v1/counts             the path the deployed agents already post to
//
// `CLOUD_URL` is baked into agent/.env on the store laptop and the path is hardcoded in
// counter.py, so the v1 paths cannot be retired remotely — someone has to physically visit
// the shop. Keeping one implementation behind both mounts means the alias can never drift
// from the route it is aliasing.
//
// These are MACHINE endpoints. No session, no user, no RBAC — see device-auth.ts. They must
// also be excluded from the NextAuth middleware matcher, or the request never reaches this
// file at all (src/middleware.ts, and §2.2 of docs/analytics-merge-plan.md).

import { errorResponse, successResponse } from "@/lib/api-utils";
import { countEventBatchSchema, heartbeatSchema } from "@/lib/validations";
import { authDevice } from "./device-auth";
import { addCounts, beat, type RawCountEvent } from "./store";

/**
 * POST — a batch of counted line crossings.
 *
 * Idempotent: the agent retries until acked, so re-posting a batch is normal traffic and not
 * an error. `accepted < submitted` simply means the server had already seen those events.
 */
export async function handleCounts(req: Request) {
  const auth = await authDevice(req);
  if (!auth.ok) return errorResponse(auth.error, auth.status);

  const body = await req.json().catch(() => null);
  // The agent posts a bare array; `{ events: [...] }` is accepted so the endpoint stays usable
  // by hand and by any future sender that wants an envelope.
  const raw = Array.isArray(body) ? body : (body as { events?: unknown })?.events;

  const parsed = countEventBatchSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      parsed.error.issues[0]?.message ?? "expected an array of events",
      Array.isArray(raw) ? 413 : 400
    );
  }

  try {
    const result = await addCounts(parsed.data as RawCountEvent[], {
      storeId: auth.storeId,
      deviceId: auth.deviceId,
    });

    return successResponse({
      store_id: auth.storeId,
      submitted: result.submitted,
      accepted: result.accepted,
      // submitted - accepted = events the server already held. Not an error condition.
      duplicates: result.submitted - result.accepted,
      rejected: result.rejected.length,
      // Reported, never silently dropped (DAT-002). Capped so one badly configured camera
      // cannot return a megabyte of reasons.
      rejected_reasons: result.rejected.slice(0, 20).map((r) => r.why),
    });
  } catch (err) {
    console.error("analytics counts ingest failed", err);
    // 503, deliberately: the agent treats a non-2xx as retryable and keeps the batch in its
    // local SQLite queue (CAM-007). Returning 200 here would make it delete unsaved events.
    return errorResponse("ingest failed", 503);
  }
}

/**
 * POST — agent liveness. Cheap, once a minute, per device.
 *
 * Authenticated for the same reason ingest is: an unauthenticated heartbeat lets anyone forge
 * "the counter is alive" and hide a real outage from the owner. This is the alert path.
 */
export async function handleHeartbeat(req: Request) {
  const auth = await authDevice(req);
  if (!auth.ok) return errorResponse(auth.error, auth.status);

  const body = (await req.json().catch(() => ({}))) ?? {};
  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "invalid heartbeat", 400);
  }

  try {
    await beat({
      storeId: auth.storeId,
      deviceId: auth.deviceId,
      // The key names the agent; the body may only refine it, never contradict the store.
      agentId: parsed.data.agent_id || auth.agentId,
      queueDepth: parsed.data.queue_depth ?? null,
      cameraOk: parsed.data.camera_ok ?? null,
      lastFrameTs: parsed.data.last_frame_ts ?? null,
      agentVersion: parsed.data.agent_version ?? null,
    });

    return successResponse({ store_id: auth.storeId });
  } catch (err) {
    console.error("analytics heartbeat failed", err);
    return errorResponse("heartbeat failed", 503);
  }
}
