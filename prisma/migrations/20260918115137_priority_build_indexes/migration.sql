-- Read indexes only for plan 1709-priority-build-and-stock-flow (Phase 4, Part S2).
-- No column, table or constraint changes: six CREATE INDEX statements and nothing else, so it is
-- safe to run against a live database ahead of the code (CLAUDE.md migrations rule 7, additive).
--   Delivery(approvedAt, approvalRequestedAt)            -- Requests page: asked for, not approved (R26a)
--   Delivery(priorityAt)                                 -- the ★ lists (R19-R21)
--   InboundShipment(approvedAt, rejectedAt)              -- Requests page: raised, not approved, not returned (R25)
--   assembly_tasks(unit_id, status)                      -- open-task check + the Cascade FK on unit_id (R8)
--   inventory_units(inbound_shipment_id)                 -- unit labels / put-away / inbound delete (Part H)
--   inventory_units(non_assemblable, status, warehouse_id) -- Awaiting and no-assembly lists (R8, R42)

-- CreateIndex
CREATE INDEX "Delivery_approvedAt_approvalRequestedAt_idx" ON "Delivery"("approvedAt", "approvalRequestedAt");

-- CreateIndex
CREATE INDEX "Delivery_priorityAt_idx" ON "Delivery"("priorityAt");

-- CreateIndex
CREATE INDEX "InboundShipment_approvedAt_rejectedAt_idx" ON "InboundShipment"("approvedAt", "rejectedAt");

-- CreateIndex
CREATE INDEX "assembly_tasks_unit_id_status_idx" ON "assembly_tasks"("unit_id", "status");

-- CreateIndex
CREATE INDEX "inventory_units_inbound_shipment_id_idx" ON "inventory_units"("inbound_shipment_id");

-- CreateIndex
CREATE INDEX "inventory_units_non_assemblable_status_warehouse_id_idx" ON "inventory_units"("non_assemblable", "status", "warehouse_id");

