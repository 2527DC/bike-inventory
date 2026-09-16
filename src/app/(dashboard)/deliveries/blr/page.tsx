"use client";

import { DeliveryListView, type DeliveryListItem } from "../_components/delivery-list-view";

// Module scope so the list's fetch callback sees the same references on every render.
// Only deliveries whose zone is Bangalore (plan 1609 A22); Not-chosen rows stay on /deliveries.
const FETCH_PARAMS = { zone: "BANGALORE" };
const STATUS_FILTERS = ["ALL", "PENDING", "SCHEDULED", "OUT_FOR_DELIVERY", "DELIVERED"];
const notWalkOutOrPrebooked = (d: DeliveryListItem) => d.status !== "WALK_OUT" && d.status !== "PREBOOKED";
const blrDetailHref = (id: string) => `/deliveries/blr/${id}`;

export default function BLRDeliveriesPage() {
  return (
    <DeliveryListView
      title="Bangalore Deliveries"
      backHref="/deliveries"
      fetchUrl="/api/deliveries"
      fetchParams={FETCH_PARAMS}
      statusFilters={STATUS_FILTERS}
      clientFilter={notWalkOutOrPrebooked}
      detailHref={blrDetailHref}
      emptyMessage="No Bangalore deliveries"
    />
  );
}
