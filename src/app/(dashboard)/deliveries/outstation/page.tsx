"use client";

import { DeliveryListView } from "../_components/delivery-list-view";

// Module scope so the list's fetch callback sees the same references on every render.
// Only deliveries whose zone is Outstation (plan 1609 A22); Not-chosen rows stay on /deliveries.
const FETCH_PARAMS = { zone: "OUTSTATION" };
const STATUS_FILTERS = ["ALL", "PENDING", "SCHEDULED", "PACKED", "OUT_FOR_DELIVERY", "SHIPPED", "IN_TRANSIT", "DELIVERED"];
const outstationDetailHref = (id: string) => `/deliveries/outstation/${id}`;

export default function OutstationDeliveriesPage() {
  return (
    <DeliveryListView
      title="Outstation Deliveries"
      backHref="/deliveries"
      fetchUrl="/api/deliveries"
      fetchParams={FETCH_PARAMS}
      statusFilters={STATUS_FILTERS}
      detailHref={outstationDetailHref}
      showCourier
      emptyMessage="No outstation deliveries"
    />
  );
}
