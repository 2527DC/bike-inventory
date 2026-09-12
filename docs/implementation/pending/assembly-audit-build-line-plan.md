# Implementation Plan: Assembly Audit & Build-Line Inventory Management

Written 11 Sep 2026 on branch `feat/assembly-audit-build-line`.
Derived from `docs/assembly-audit-requirements.md` and owner decisions on Q1–Q66.

---

## 1. Requirements & Worked Workflow Examples

### R1 & R11: Bins Across All Warehouses (Godowns & Shop Floors)
- **Concept**: A bin is a named, physically labeled landmark in a specific warehouse (`kind: GODOWN` or `kind: FLOOR`), with plain-language directions (e.g., *"Ground floor, left of entrance, rack 1"*).
- **Workflow Example**:
  1. Admin opens `/bins` and creates `GODOWN-A1` (Zone A, Floor 1) and `FLOOR-R1` (Showroom Rack 1).
  2. Printable barcode labels (Code 128) are generated and physically stuck onto the racks.

### R2, R6, R19 & R20: Receiving, Unit Codes & Labels
- **Concept**: Bicycles received in an inbound shipment generate unique company-wide unit codes (`U-000481`, `U-000482`, etc.). Labels carrying the product SKU and unit barcode are printed at receipt. Mechanics paste the label on the bike frame at assembly.
- **Workflow Example**:
  1. Truck arrives with 10 Hero 29-inch bicycles. Inwards staff marks 10 delivered.
  2. System mints `U-000481` to `U-000490` and prints 10 barcode stickers. The stickers stay with the cartons until unboxed for assembly.

### R13 & R14: Home Bins & Put-Away Rounds
- **Concept**: Admin sets home bin rules per warehouse: `Brand` + `Category` $\rightarrow$ `Bin`. Put-away progresses in rounds: `Awaiting put-away` $\rightarrow$ `Partly put away (round 1)` $\rightarrow$ `Put away`.
- **Workflow Example**:
  1. Staff opens the received shipment. System suggests `GODOWN-A2` (home bin for Hero + 29).
  2. Staff scans 6 cartons into `GODOWN-A2`. Status moves to `Partly put away (round 1)`.
  3. Remaining 4 are shelved later in `GODOWN-A3`: Status moves to `Put away`.

### R4, R5, R8, R17 & R18: Assembly Queue & Build-Line Execution
- **Concept**: Supervisor assigns bicycles to mechanics at an item condition level (50%, 85%, 100%). Assignment moves the bicycle automatically to the warehouse's assembly bin (`GODOWN-ASM` or `FLOOR-ASM`).
- **Workflow Example**:
  1. Supervisor selects `U-000481`, assigns it to mechanic Ravi at condition 85%.
  2. System logs an automatic move from `GODOWN-A2` to `GODOWN-ASM`.
  3. Ravi sees the task in "My Queue" on mobile, taps **Start** (moves to `IN_PROGRESS`).
  4. If a pedal is missing, Ravi taps **On Hold** (reason: "parts missing"). Later taps **Resume** (hold duration tracked).
  5. Ravi finishes the build, snaps a verification photo, and taps **Complete**. System records 42 min build time (excluding hold), registers Ravi as the builder, writes `AssemblyLog` for earnings sync, and prompts for destination bin.

### R12 & Settled Q57/Q60: Godown to Floor Movement via Stock Transfer
- **Concept**: Moving an assembled or boxed cycle from a Godown warehouse to a Floor warehouse within the same store is a **Stock Transfer** that carries the unit codes.
- **Workflow Example**:
  1. Staff creates an internal Stock Transfer from `Main Godown` to `Main Store Floor`.
  2. Dispatcher scans `U-000481`.
  3. Floor staff receives the transfer and puts `U-000481` into showroom bin `FLOOR-R1`.
  4. Godown count decreases by 1, Floor count increases by 1. Unit `U-000481` now resides in `FLOOR-R1`.

### R3, R15 & R16: Bin Audits & Live System Stock Correction
- **Concept**: A bin audit counts items bin-by-bin (sorted largest quantity first, showing directions). Approver reviews and approves variance without changing live stock. Setting live stock requires `stock_correction.approve`.
- **Workflow Example**:
  1. Supervisor creates a Bin Audit for `GODOWN-ASM` and `GODOWN-A1`.
  2. Counter Arun opens the audit on mobile, directed to `GODOWN-A1` first. He scans unit barcodes and enters counts.
  3. Meena reviews variance and clicks **Approve** (differences recorded for audit record; stock unchanged).
  4. Authorized user holding `stock_correction.approve` (or Admin) clicks **Apply Live Correction** $\rightarrow$ live warehouse and bin stock levels update with `ADJUSTMENT` logs.

### R7 & R21: Complaints & Fault Attribution
- **Concept**: Customer complaints at the counter lookup the cycle by unit code `U-000481`. Supervisor marks the complaint as an official `assembly_fault`, attributing it to Ravi.
- **Workflow Example**:
  1. Customer returns with brake issue. Arun scans frame sticker `U-000481`.
  2. System displays: "Built by Ravi on 12 Sep at 85%".
  3. Counter logs complaint with description and photo.
  4. Workshop supervisor investigates and approves as an `assembly_fault`. Ravi's fault tally increments on the monthly review.

---

## 2. Granular RBAC Permissions Architecture

In alignment with the user's directive:
1. **Admin Superuser Bypass**: Checked in `src/lib/rbac.ts` via `access.roleKey === "ADMIN" || access.user?.role?.isSystem === true`.
2. **Strictly Permission-Driven**: No code will ever branch on `role === "SUPERVISOR"` or `role === "MECHANIC"`.
3. **Module Catalog Additions**:

| Module Key | Action | Capability Unlocked |
|---|---|---|
| `bins` | `view` | View warehouse bin directory and bin inventory reports |
| | `create` | Create new bin with zone, floor, and directions text |
| | `edit` | Update bin details, set Brand + Category home bin rules |
| | `delete` | Soft delete/retire bin |
| `assembly` | `view` | Mechanic: view own assigned tasks and personal performance |
| | `create` | Create manual assembly task |
| | `edit` | Mechanic: Start, Hold, Resume, Photo Upload, and Complete task |
| | `approve` | Supervisor: View all mechanics, assign tasks, set levels, reassign, force-complete |
| `stock_audit` | `view` | View stock audits and audit history |
| | `create` | Schedule/create bin audit, warehouse audit, or brand count |
| | `edit` | Floor counter: enter counts and scan unit barcodes |
| | `approve` | Supervisor: approve audit variance & record differences |
| `stock_correction`| `approve` | Apply counted figures to live system stock and write ledger adjustments |
| `complaints` | `view` | View customer complaints list |
| | `create` | Counter staff: log complaint against unit code with photo |
| | `edit` | Update complaint status / notes |
| | `approve` | Supervisor: attribute complaint as an assembly fault against mechanic |
| `inventory_adjustments` | `create` | Flag unit missing, damaged on arrival, or stolen |
| | `edit` | Process customer return back to bin |
| | `approve` | Write off inventory loss (theft / damage to brand) |

---

## 3. Database Schema Changes (`prisma/schema.prisma`)

```prisma
// 1. Extend Bin model
model Bin {
  id              String      @id @default(cuid())
  code            String      // e.g. "A1", "ASM"
  name            String      // e.g. "Shelf Rack 1"
  warehouseId     String      @map("warehouse_id")
  warehouse       Warehouse   @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  directions      String?     // "Ground floor, left of entrance, first rack"
  floor           String?     // "Ground", "1st Floor"
  zone            String?     // "Zone A"
  capacity        Int?        // Optional / informational
  isAssemblyArea  Boolean     @default(false) @map("is_assembly_area")
  isActive        Boolean     @default(true)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  binStocks       BinStock[]
  units           InventoryUnit[]
  homeBinRules    HomeBinRule[]
  fromMovements   BinMovementLog[] @relation("MoveFromBin")
  toMovements     BinMovementLog[] @relation("MoveToBin")

  @@unique([warehouseId, code])
  @@index([warehouseId, isActive])
  @@map("bins")
}

// 2. Quantity of loose/bulk products in a bin
model BinStock {
  id          String    @id @default(cuid())
  binId       String    @map("bin_id")
  bin         Bin       @relation(fields: [binId], references: [id], onDelete: Cascade)
  productId   String    @map("product_id")
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)
  quantity    Int       @default(0)
  updatedAt   DateTime  @updatedAt

  @@unique([binId, productId])
  @@index([productId])
  @@map("bin_stocks")
}

// 3. Home Bin Rules (Brand + Category -> Bin, or Product -> Bin)
model HomeBinRule {
  id          String     @id @default(cuid())
  warehouseId String     @map("warehouse_id")
  warehouse   Warehouse  @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  brandId     String?    @map("brand_id")
  brand       Brand?     @relation(fields: [brandId], references: [id], onDelete: Cascade)
  categoryId  String?    @map("category_id")
  category    Category?  @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  productId   String?    @map("product_id")
  product     Product?   @relation(fields: [productId], references: [id], onDelete: Cascade)
  binId       String     @map("bin_id")
  bin         Bin        @relation(fields: [binId], references: [id], onDelete: Cascade)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([warehouseId, brandId, categoryId])
  @@map("home_bin_rules")
}

// 4. Inventory Units (Physical cycles with unique sticker codes U-xxxxxx)
model InventoryUnit {
  id              String             @id @default(cuid())
  unitCode        String             @unique @map("unit_code") // "U-000481"
  productId       String             @map("product_id")
  product         Product            @relation(fields: [productId], references: [id], onDelete: Restrict)
  warehouseId     String             @map("warehouse_id")
  warehouse       Warehouse          @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  binId           String?            @map("bin_id")
  bin             Bin?               @relation(fields: [binId], references: [id], onDelete: SetNull)
  frameNumber     String?            @map("frame_number")
  status          UnitStatus         @default(RECEIVED)
  inboundShipmentId String?          @map("inbound_shipment_id")
  inboundShipment InboundShipment?   @relation(fields: [inboundShipmentId], references: [id])
  
  // Assembly attribution
  assembledById   String?            @map("assembled_by_id")
  assembledBy     User?              @relation("UnitAssembler", fields: [assembledById], references: [id])
  assembledAt     DateTime?          @map("assembled_at")
  assemblyLevel   AssemblyLevel?     @map("assembly_level")

  // Sales linkage
  saleInvoiceNo   String?            @map("sale_invoice_no")
  soldAt          DateTime?          @map("sold_at")
  customerName    String?            @map("customer_name")
  customerPhone   String?            @map("customer_phone")

  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  assemblyTasks   AssemblyTask[]
  complaints      Complaint[]
  transferItems   TransferOrderUnit[]

  @@index([warehouseId, status])
  @@index([productId, status])
  @@index([binId])
  @@map("inventory_units")
}

enum UnitStatus {
  RECEIVED
  PUT_AWAY
  ASSIGNED
  IN_ASSEMBLY
  ASSEMBLED
  RESERVED
  SOLD
  RETURNED
  DAMAGED
  TRANSFERRED
  LOST
}

enum AssemblyLevel {
  A50   // 50%
  A85   // 85%
  FULL  // 100%
}

// 5. Assembly Tasks
model AssemblyTask {
  id               String             @id @default(cuid())
  unitId           String             @map("unit_id")
  unit             InventoryUnit      @relation(fields: [unitId], references: [id], onDelete: Cascade)
  warehouseId      String             @map("warehouse_id")
  warehouse        Warehouse          @relation(fields: [warehouseId], references: [id], onDelete: Restrict)
  level            AssemblyLevel
  status           AssemblyTaskStatus @default(PENDING)
  
  assignedToId     String             @map("assigned_to_id")
  assignedTo       User               @relation("AssignedMechanic", fields: [assignedToId], references: [id])
  assignedById     String             @map("assigned_by_id")
  assignedBy       User               @relation("TaskAssignedBy", fields: [assignedById], references: [id])
  assignedAt       DateTime           @default(now()) @map("assigned_at")

  startedAt        DateTime?          @map("started_at")
  holdStartedAt    DateTime?          @map("hold_started_at")
  totalHoldSeconds Int                @default(0) @map("total_hold_seconds")
  holdReason       String?            @map("hold_reason")
  completedAt      DateTime?          @map("completed_at")
  photoUrl         String?            @map("photo_url")
  notes            String?

  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt

  @@index([warehouseId, status])
  @@index([assignedToId, status])
  @@map("assembly_tasks")
}

enum AssemblyTaskStatus {
  PENDING
  IN_PROGRESS
  ON_HOLD
  COMPLETED
  CANCELLED
}

// 6. Bin Movement Audit Trail
model BinMovementLog {
  id          String    @id @default(cuid())
  warehouseId String    @map("warehouse_id")
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  unitId      String?   @map("unit_id")
  productId   String?   @map("product_id")
  quantity    Int       @default(1)
  fromBinId   String?   @map("from_bin_id")
  fromBin     Bin?      @relation("MoveFromBin", fields: [fromBinId], references: [id])
  toBinId     String?   @map("to_bin_id")
  toBin       Bin?      @relation("MoveToBin", fields: [toBinId], references: [id])
  reason      String    // "Put-away round 1", "Moved by assignment", "Manual relocation"
  movedById   String    @map("moved_by_id")
  movedBy     User      @relation(fields: [movedById], references: [id])
  createdAt   DateTime  @default(now())

  @@index([warehouseId, createdAt])
  @@index([unitId])
  @@map("bin_movement_logs")
}

// 7. Coded Units on Transfer Orders
model TransferOrderUnit {
  id              String        @id @default(cuid())
  transferOrderId String        @map("transfer_order_id")
  transferOrder   TransferOrder @relation(fields: [transferOrderId], references: [id], onDelete: Cascade)
  unitId          String        @map("unit_id")
  unit            InventoryUnit @relation(fields: [unitId], references: [id], onDelete: Restrict)
  dispatchedAt    DateTime?     @map("dispatched_at")
  receivedAt      DateTime?     @map("received_at")

  @@unique([transferOrderId, unitId])
  @@map("transfer_order_units")
}

// 8. Complaints
model Complaint {
  id             String    @id @default(cuid())
  ticketNo       String    @unique @map("ticket_no") // Auto: CMP-YYYYMM-NNNN
  unitId         String    @map("unit_id")
  unit           InventoryUnit @relation(fields: [unitId], references: [id], onDelete: Restrict)
  customerName   String    @map("customer_name")
  customerPhone  String    @map("customer_phone")
  description    String
  photoUrl       String?   @map("photo_url")
  isAssemblyFault Boolean  @default(false) @map("is_assembly_fault")
  faultMechanicId String?  @map("fault_mechanic_id")
  faultMechanic   User?    @relation("MechanicAssemblyFaults", fields: [faultMechanicId], references: [id])
  attributedById String?   @map("attributed_by_id")
  attributedBy   User?     @relation("ComplaintAttributedBy", fields: [attributedById], references: [id])
  status         String    @default("OPEN")
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([unitId])
  @@index([faultMechanicId])
  @@map("complaints")
}
```

---

## 4. Proposed Changes by Component

### Core RBAC & System Admin Bypass
- [MODIFY] `src/lib/rbac.ts`:
  - Ensure `userCan()` short-circuits to `true` if `access.roleKey === "ADMIN"` or `access.user?.role?.isSystem === true`.
  - Expand `PermAction` types to support domain actions (`view`, `create`, `edit`, `delete`, `approve`, `fetch`).
- [MODIFY] `prisma/rbac-catalog.ts`:
  - Seed new modules: `bins`, `assembly`, `stock_correction`, `complaints`, `inventory_adjustments`.
  - Wire default grants for ADMIN role and permissions catalogue.
- [MODIFY] `src/components/auth/permission-guard.tsx`:
  - Client component checking permissions using `hasPermission(module, action)` and bypassing for `roleKey === "ADMIN"`.

### Bins & Put-away
- [NEW] `src/app/api/bins/route.ts`: CRUD for warehouse bins (scoped by `warehouseId`).
- [NEW] `src/app/api/bins/home-rules/route.ts`: Brand + Category home bin configuration.
- [NEW] `src/app/api/bins/move/route.ts`: Intra-warehouse Move endpoint with `BinMovementLog`.
- [MODIFY] `src/app/api/inbound/[id]/putaway/route.ts`:
  - Implement put-away rounds (Round 1, Round 2...).
  - Scans units into bins, suggests home bin, allows split.
- [NEW] `src/app/(dashboard)/bins/page.tsx`: Warehouse bin visual management & inventory report by Brand $\rightarrow$ Category $\rightarrow$ Product $\rightarrow$ Unit Code.

### Assembly & Workshop Management
- [NEW] `src/app/api/assembly/tasks/route.ts`: GET tasks (filtered by mechanic for `assembly.view`, all for `assembly.approve`) and POST assignment (supervisor assigns mechanic + level, moves unit to `ASM` bin).
- [NEW] `src/app/api/assembly/tasks/[id]/start/route.ts`: Start build.
- [NEW] `src/app/api/assembly/tasks/[id]/hold/route.ts`: Put on hold with reason / resume.
- [NEW] `src/app/api/assembly/tasks/[id]/complete/route.ts`: Complete with photo upload, writes `AssemblyLog` for backward-compatible `earn-sync`, prompts destination bin.
- [NEW] `src/app/(dashboard)/assembly/page.tsx`: Assembly supervisor board (pending units, assignment modal, state columns, stuck alerts).
- [NEW] `src/app/(dashboard)/services/mechanic/queue/page.tsx`: Mobile-optimized mechanic workspace ("My Queue", Start, Hold, Camera photo capture, Complete).

### Transfers with Unit Codes
- [MODIFY] `src/app/api/transfer-orders/route.ts`: Support `GODOWN_TO_FLOOR` transfer mode.
- [MODIFY] `src/app/api/transfer-orders/[id]/dispatch/route.ts`: Record dispatched unit codes (`TransferOrderUnit`).
- [MODIFY] `src/app/api/transfer-orders/[id]/receive/route.ts`: Destination receiving puts units into destination warehouse with put-away rounds.

### Audits & Stock Correction
- [MODIFY] `src/app/api/stock-counts/route.ts`: Enable bin audit scope (filter by warehouse and selected bins, sorted largest quantity first).
- [MODIFY] `src/app/api/stock-counts/[id]/route.ts`:
  - Split approval (`stock_audit.approve`, records differences only) from stock adjustment (`stock_correction.approve`, updates `BinStock` and `StockLevel`).

### Complaints & Customer Care
- [NEW] `src/app/api/complaints/route.ts`: Log complaint with unit code search and photo.
- [NEW] `src/app/api/complaints/[id]/attribute-fault/route.ts`: Attributing fault to assembling mechanic.
- [NEW] `src/app/(dashboard)/complaints/page.tsx`: Complaint intake and supervisor attribution review.

---

## 5. Verification Plan

### Automated Build & Types Validation
```bash
npm run build
```
- Mandatory after every phase. Ensure no TypeScript or build errors.

### Database Migration & Seed Validation
```bash
npm run db:seed:rbac
```
- Verify all new modules and their permissions are inserted into `modules` and `permissions` tables.

### Manual End-to-End Operational Verification
1. **RBAC & Admin Bypass**:
   - Login as Admin: Verify access to all new routes and actions without manual grants.
   - Create test role "Workshop Supervisor" with `assembly.approve` and `stock_audit.approve`: Verify they can assign bikes and approve audit diffs, but CANNOT apply live stock corrections.
2. **Inbound & Put-Away**:
   - Receive test shipment of 5 Hero 29-inch cycles.
   - Verify 5 unique `U-xxxxxx` codes minted and printable stickers generated.
   - Perform Put-away Round 1 into `GODOWN-A2`. Check `BinStock` and `InventoryUnit` location.
3. **Assembly Workflow**:
   - Supervisor assigns `U-xxxx01` to Mechanic at 85%. Verify auto-move to `GODOWN-ASM`.
   - Mechanic logs in on mobile, starts task, holds for 1 min, uploads test photo, taps Complete.
   - Confirm build time recorded = (Total time - 1 min), unit marked `ASSEMBLED`, and mechanic saved as builder.
4. **Godown $\rightarrow$ Floor Stock Transfer**:
   - Create transfer for `U-xxxx01` from `GODOWN` to `FLOOR`.
   - Dispatch and Receive. Verify cycle is now in `FLOOR-R1`, Godown stock decreases, Floor stock increases.
5. **Complaint Logging**:
   - Counter logs complaint for `U-xxxx01`. Verify mechanic is pre-populated as Ravi.
   - Supervisor marks as `assembly_fault`. Verify Ravi's fault count updates.
