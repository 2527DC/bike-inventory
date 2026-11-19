// Flush operational data: Inbound, Outbound, Stock Transfer, Stock Audit, Purchase Order
//
//     npm run db:snapshot (already taken)
//     node scripts/db/flush-operations.mjs
//
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function getCounts() {
  const [
    inboundShipments,
    inboundLineItems,
    deliveries,
    transferOrders,
    transferOrderItems,
    transferOrderUnits,
    stockCounts,
    stockCountItems,
    purchaseOrders,
    purchaseOrderItems,
    purchaseOrderSends,
    poExtractions,
    poExtractionItems,
    approvalEvents,
    inventoryTransactions,
    heldStockLevels,
    heldProducts,
    invoicePreviews,
    preBookings,
    unitsLinkedToInbound
  ] = await Promise.all([
    prisma.inboundShipment.count(),
    prisma.inboundLineItem.count(),
    prisma.delivery.count(),
    prisma.transferOrder.count(),
    prisma.transferOrderItem.count(),
    prisma.transferOrderUnit.count(),
    prisma.stockCount.count(),
    prisma.stockCountItem.count(),
    prisma.purchaseOrder.count(),
    prisma.purchaseOrderItem.count(),
    prisma.purchaseOrderSend.count(),
    prisma.poExtraction.count(),
    prisma.poExtractionItem.count(),
    prisma.approvalEvent.count({ where: { activity: { in: ["INBOUND", "OUTBOUND", "TRANSFER", "STOCK_AUDIT"] } } }),
    prisma.inventoryTransaction.count({ where: { type: { in: ["INWARD", "OUTWARD", "TRANSFER", "ADJUSTMENT"] } } }),
    prisma.stockLevel.count({ where: { reservedQuantity: { not: 0 } } }),
    prisma.product.count({ where: { reservedStock: { not: 0 } } }),
    prisma.zohoPullPreview.count({ where: { entityType: "invoice" } }),
    prisma.preBooking.count(),
    prisma.inventoryUnit.count({ where: { inboundShipmentId: { not: null } } })
  ]);

  return {
    inboundShipments,
    inboundLineItems,
    deliveries,
    transferOrders,
    transferOrderItems,
    transferOrderUnits,
    stockCounts,
    stockCountItems,
    purchaseOrders,
    purchaseOrderItems,
    purchaseOrderSends,
    poExtractions,
    poExtractionItems,
    approvalEvents,
    inventoryTransactions,
    heldStockLevels,
    heldProducts,
    invoicePreviews,
    preBookings,
    unitsLinkedToInbound
  };
}

async function main() {
  console.log("=== Flushing Inbound, Outbound, Transfers, Audits, and Purchase Orders ===");
  const before = await getCounts();
  console.log("Current counts before wipe:", JSON.stringify(before, null, 2));

  const startTime = Date.now();

  const results = await prisma.$transaction(async (tx) => {
    // 1. Clear stock holds
    const releasedLevels = await tx.stockLevel.updateMany({
      where: { reservedQuantity: { not: 0 } },
      data: { reservedQuantity: 0 }
    });
    const releasedProducts = await tx.product.updateMany({
      where: { reservedStock: { not: 0 } },
      data: { reservedStock: 0 }
    });

    // 2. Unlink foreign keys before parent deletion
    const unlinkedUnitsInbound = await tx.inventoryUnit.updateMany({
      where: { inboundShipmentId: { not: null } },
      data: { inboundShipmentId: null }
    });
    const unlinkedUnitsDelivery = await tx.inventoryUnit.updateMany({
      where: { reservedForDeliveryId: { not: null } },
      data: { reservedForDeliveryId: null }
    });
    const unlinkedVendorBills = await tx.vendorBill.updateMany({
      where: { purchaseOrderId: { not: null } },
      data: { purchaseOrderId: null }
    });

    // 3. Stock Transfer
    const delTransferUnits = await tx.transferOrderUnit.deleteMany({});
    const delTransferItems = await tx.transferOrderItem.deleteMany({});
    const delTransferOrders = await tx.transferOrder.deleteMany({});

    // 4. Stock Audit
    const delStockCountItems = await tx.stockCountItem.deleteMany({});
    const delStockCounts = await tx.stockCount.deleteMany({});

    // 5. Purchase Order
    const delPoExtractionItems = await tx.poExtractionItem.deleteMany({});
    const delPoExtractions = await tx.poExtraction.deleteMany({});
    const delPoSends = await tx.purchaseOrderSend.deleteMany({});
    const delPoItems = await tx.purchaseOrderItem.deleteMany({});
    const delPurchaseOrders = await tx.purchaseOrder.deleteMany({});

    // 6. Outbound (Delivery) & Zoho invoice previews
    const delInvoicePreviews = await tx.zohoPullPreview.deleteMany({ where: { entityType: "invoice" } });
    const delDeliveries = await tx.delivery.deleteMany({});

    // 7. Inbound (Shipments, Line items, PreBookings)
    const delPreBookings = await tx.preBooking.deleteMany({});
    const delInboundItems = await tx.inboundLineItem.deleteMany({});
    const delInboundShipments = await tx.inboundShipment.deleteMany({});

    // 8. Controlled Approval Events
    const delApprovals = await tx.approvalEvent.deleteMany({
      where: { activity: { in: ["INBOUND", "OUTBOUND", "TRANSFER", "STOCK_AUDIT"] } }
    });

    // 9. Operational Inventory Transactions
    const delInvTransactions = await tx.inventoryTransaction.deleteMany({
      where: { type: { in: ["INWARD", "OUTWARD", "TRANSFER", "ADJUSTMENT"] } }
    });

    return {
      releasedLevels: releasedLevels.count,
      releasedProducts: releasedProducts.count,
      unlinkedUnitsInbound: unlinkedUnitsInbound.count,
      unlinkedUnitsDelivery: unlinkedUnitsDelivery.count,
      unlinkedVendorBills: unlinkedVendorBills.count,
      transferOrders: delTransferOrders.count,
      transferOrderItems: delTransferItems.count,
      transferOrderUnits: delTransferUnits.count,
      stockCounts: delStockCounts.count,
      stockCountItems: delStockCountItems.count,
      purchaseOrders: delPurchaseOrders.count,
      purchaseOrderItems: delPoItems.count,
      purchaseOrderSends: delPoSends.count,
      poExtractions: delPoExtractions.count,
      poExtractionItems: delPoExtractionItems.count,
      deliveries: delDeliveries.count,
      invoicePreviews: delInvoicePreviews.count,
      inboundShipments: delInboundShipments.count,
      inboundLineItems: delInboundItems.count,
      preBookings: delPreBookings.count,
      approvalEvents: delApprovals.count,
      inventoryTransactions: delInvTransactions.count
    };
  }, {
    timeout: 120000
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTransaction completed in ${durationSec} s:`);
  console.log(JSON.stringify(results, null, 2));

  const after = await getCounts();
  console.log("\nCounts after wipe:", JSON.stringify(after, null, 2));
}

main()
  .catch((e) => {
    console.error("Flush failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
