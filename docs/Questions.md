
-> Staff must be able to see every detail the customer submitted and must be able to edit those details. Every edit to the customer details, and every other action taken, must be recorded in the activity log.
-> This includes changing the delivery date: a date change must also be logged.
-> The delivery instructions could also include a voice recording.
-> Question: at the time of delivery, if the stock is not available anywhere (not in the store, and not in its warehouses, the godown or the floor), should the delivery be marked as Pre-booked?
If it is marked as Pre-booked, what should happen next? What actions can be taken on a pre-booked delivery, and what is its workflow?
-> If the stock is not available in this store but is available in another store or warehouse, we can have a "Check stock" button that checks the other floors and godowns. If the stock is found, show a screen to raise a transfer request. A user with the related permission can see the request, approve it, or reject it with a reason. The request has a status: Pending, Processing or Completed. When it is Completed, the stock is deducted from the sending warehouse and added to the receiving warehouse.

Doubt: the map link pasted in the fill form does not seem to be used for anything, not even in batching. I need to understand how routing is done in the batching module.

# 18-9-20 (  updates  on the implmentation plan if @1709-priority-build-and-stock-flow-plan.md)
# Inbound, Bin Management & Navigation Updates
*Reference: Updates and clarifications for implementation plan `1709-priority-build-and-stock-flow-plan.md`*

---

## 1. Inbound & Bin Assignment Rules

### 1.1 Preserve Auto-Matched Bins During Bulk Assignment
- **Current Issue**: Using the "Apply same bin to all items" option in Inbound overrides all line items indiscriminately.
- **Required Behavior**: 
  - Line items that are automatically matched to a bin via automated Home-Bin rules must be protected/locked from bulk overrides.
  - Selecting "Apply same bin to all items" must **only** apply to unmatched line items (items that did not have an automated rule match).

### 1.2 Hierarchical Category Selection in Home-Bin Rules & Retroactive Assignment
- **Category Hierarchy Selection**:
  - When configuring a Home-Bin rule (Warehouse + Brand + Category), the user must be able to navigate and select parent categories or specific child/sub-categories (e.g., as structured in Zoho).
  - If a selected parent category has child categories, the user must be able to select the specific leaf child category.
- **Immediate Retroactive Application to Existing Products**:
  - Upon saving or applying the bin rule (e.g., Brand = `Accessory`, Category = `Accessory`), the system must immediately assign this bin to **all existing matching products** in the database/inventory, rather than applying solely to future inbound shipments.

---

## 2. Navigation & Sidebar Updates

### 2.1 Restore Categories & Brands to Sidebar Navigation
- **Current Issue**: Categories and Brands were removed from the main sidebar navigation and relocated inside chips on the Stock & Inventory page.
- **Required Behavior**: Restore **Categories** and **Brands** as accessible, standalone links within the sidebar navigation menu.

---

## 3. Bin Inventory & Capacity Breakdown

### 3.1 Display Assembled vs. Unassembled Stock Counts per Bin
- In the Bins overview and Bin card/details screens, each bin must display the total product quantity it currently holds, broken down by:
  - **Total Items**
  - **Assembled Count**
  - **Unassembled Count**

### 3.2 Non-Assemblable Bins Must Exclude Cycles
- Bins designated as **Non-Assemblable** are strictly intended for spare parts, accessories, and non-build items.
- Bicycles/cycles must **never** be stored in, assigned to, or categorized under non-assemblable bins.

---

## 4. Bug Fixes

### 4.1 Fix Product Visibility in Bins for Manually Assigned Unmatched Items
- **Current Issue**: When items are assigned to a bin from the unmatched list, the bin detail drawer only displays an entry in the **Movement Log**, but reports `0` products and does not list the products inside the bin.
- **Required Fix**: Ensure that when unmatched items are assigned to a bin, their inventory records (both tracked unit items and quantity stock) properly link to the bin so they are visible under "Items in this bin" in addition to logging the movement.

---

## 5. Inbound Requests & Approvals Workflow

### 5.1 Explanation: Source of Inbound Shipment Approval Requests
- **Data Table**: Inbound approval records originate from the Prisma database table **`InboundShipment`** (`prisma.inboundShipment`).
- **Trigger Logic**: Any inbound shipment where `approvedAt: null`, `rejectedAt: null`, and `status != "DELIVERED"` is picked up by `listPendingApprovals()` (`src/lib/approvals/pending.ts`).
- **User Visibility**: Users holding the `inbound.approve` RBAC permission see these records listed under the **Requests** tab (`/approvals`) with options to **Approve** or **Reject** (send back with a note).

### 5.2 Workflow Decision: Remove Inbound Approvals
- **Decision**: Remove the requirement for inbound shipments to undergo an approval process.
- **Proposed Change**: 
  - Bypass the approve/reject stage for inbound shipments so stock can be received and put away directly.
  - Remove inbound shipment rows from the `/approvals` (Requests) queue.
