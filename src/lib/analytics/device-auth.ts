// Device authentication for the counting agents.
//
// This is the MACHINE door. It is not NextAuth and it is not RBAC: the caller is a Python
// process on a store laptop, and no user exists. The human door is NextAuth + requireFeature
// ("analytics"), used by the dashboard route instead.
//
// The pilot's own auth carried two findings that this port preserves (findings-2026-08-01):
//
//   C2  `if (!key) return true` — a forgotten environment variable silently DISABLED
//       authentication instead of failing closed. The rule here is absolute:
//       **a missing or unknown credential denies. It never permits.**
//
//   DAT-002  the store is derived from the KEY, never from the request body. A store-1
//       device used to be able to write rows into store-9 simply by asking. Callers get
//       `storeId` back from this module and must ignore any `store_id` in the payload.
//
// What changed from the pilot: keys lived in a STORE_KEYS environment JSON, compared in a
// timing-safe loop over every configured key. They now live in the analytics_devices table,
// stored as a sha-256 hash. That makes rotation a database write instead of a redeploy, and
// it means a database leak does not hand anyone the ability to forge footfall. The timing-safe
// loop is gone with it — lookup is a single indexed match on the hash, and the hash of an
// unknown key reveals nothing about any real one.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import type { StockLocation } from "@prisma/client";

/** Hash a raw device key for storage or lookup. Same function on both paths, always. */
export function hashDeviceKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Mint a new device key. Returned once, to be shown once, and never stored in raw form —
 * only `hashDeviceKey(key)` goes to the database. Used by the device admin screen (phase 6).
 */
export function generateDeviceKey(): string {
  return randomBytes(32).toString("hex");
}

export interface AuthedDevice {
  ok: true;
  deviceId: string;
  /** The authoritative store for this request. Never read the store from the body. */
  storeId: StockLocation;
  agentId: string;
}

export interface DeviceAuthFailure {
  ok: false;
  status: number;
  error: string;
}

export type DeviceAuthResult = AuthedDevice | DeviceAuthFailure;

/**
 * Authenticate a device request by its `x-api-key` header.
 *
 * Returns 401 for a missing/unknown/revoked key and 503 when no device has been registered
 * at all. The 503 is a deliberate distinction for whoever is installing a camera: "nothing is
 * set up yet" and "your key is wrong" are different problems with different fixes. It costs
 * one extra query and only on the failure path.
 */
export async function authDevice(req: Request): Promise<DeviceAuthResult> {
  const presented = req.headers.get("x-api-key");
  if (!presented) return { ok: false, status: 401, error: "missing x-api-key" };

  // The unique index on keyHash IS the comparison — an exact match or nothing. No timing-safe
  // loop is needed because what is compared is a digest, not the secret.
  const device = await prisma.analyticsDevice.findUnique({
    where: { keyHash: hashDeviceKey(presented) },
    select: { id: true, storeId: true, agentId: true, isActive: true },
  });

  if (!device) {
    const registered = await prisma.analyticsDevice.count({ where: { isActive: true } });
    if (registered === 0) {
      return {
        ok: false,
        status: 503,
        error: "no counting device is registered: add one under Store Analytics → Devices",
      };
    }
    return { ok: false, status: 401, error: "unknown key" };
  }

  // Revocation is a flag, not a delete — the device's counted history has to survive it.
  if (!device.isActive) {
    return { ok: false, status: 401, error: "device key revoked" };
  }

  return { ok: true, deviceId: device.id, storeId: device.storeId, agentId: device.agentId };
}
