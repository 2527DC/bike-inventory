/**
 * Bangalore / Outstation / Not chosen (plan 1609-deliveries, A22, T6).
 *
 * `Delivery.deliveryZone` is the truth; `Delivery.isOutstation` is written beside it for one
 * release so every older reader keeps working. Pure — safe in the browser and on the server.
 */

export type DeliveryZoneValue = "BANGALORE" | "OUTSTATION";

/** The two columns to write for a zone. Null (not chosen) keeps isOutstation false, as imports always had it. */
export function zoneColumns(zone: DeliveryZoneValue | null): { deliveryZone: DeliveryZoneValue | null; isOutstation: boolean } {
  return { deliveryZone: zone, isOutstation: zone === "OUTSTATION" };
}

/** The zone a request's legacy `isOutstation` boolean means. */
export function zoneFromOutstation(isOutstation: boolean): DeliveryZoneValue {
  return isOutstation ? "OUTSTATION" : "BANGALORE";
}

/** The tag text the lists show (A23). */
export function zoneLabel(zone: DeliveryZoneValue | null | undefined): "Bangalore" | "Outstation" | "Not set" {
  if (zone === "BANGALORE") return "Bangalore";
  if (zone === "OUTSTATION") return "Outstation";
  return "Not set";
}

/** `?zone=` on GET /api/deliveries: BANGALORE, OUTSTATION, or NONE for not chosen. */
export type ZoneFilter = DeliveryZoneValue | "NONE";

export function parseZoneFilter(raw: string | null | undefined): ZoneFilter | null {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "BANGALORE" || v === "OUTSTATION" || v === "NONE" ? v : null;
}
