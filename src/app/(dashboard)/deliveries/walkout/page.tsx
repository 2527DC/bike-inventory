"use client";

import { DeliveryListView } from "../_components/delivery-list-view";

// Module scope so the list's fetch callback sees the same references on every render.
const FETCH_PARAMS = { status: "WALK_OUT" };
const NO_STATUS_FILTERS: string[] = [];
const detailHref = (id: string) => `/deliveries/${id}`;

export default function WalkoutDeliveriesPage() {
  return (
    <DeliveryListView
      title="Walk-out Deliveries"
      backHref="/deliveries"
      fetchUrl="/api/deliveries"
      fetchParams={FETCH_PARAMS}
      statusFilters={NO_STATUS_FILTERS}
      detailHref={detailHref}
      showAging={false}
      emptyMessage="No walk-out deliveries"
    />
  );
}
