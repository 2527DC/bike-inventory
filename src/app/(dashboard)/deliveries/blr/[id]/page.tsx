"use client";

import { use } from "react";
import { DeliveryDetail } from "../../_components/delivery-detail";

// One detail screen for every list (plan 1609 A29); only the back link differs.
export default function BangaloreDeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <DeliveryDetail id={id} backHref="/deliveries/blr" />;
}
