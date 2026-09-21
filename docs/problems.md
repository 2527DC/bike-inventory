# Workflow

## How the application will be started and put into use

1. First, seed Zoho's products together with their brands, categories and subcategories.
2. Then check which permissions are missing from each module and assign them to the users.

## Stock Audit

- At present the Stock audit is done by numbers — the user enters the counted quantity by hand. (bec to scan and count the product need the labeling so existing product dont have the labeling need to generate the code for all the existing product)
- Before a stock audit can begin, the products that already exist in the application from the
  seed (the ones that were never inbounded, so were never tracked or created through the
  inbound flow) must first be assigned digitally to their respective bins.
- Either before or after that check, we should generate the unique code that is printed,
  pasted onto the product, and tracked digitally.
- Once that is in place, the stock audit can be done by scanning with the camera and counting
  the products that way.
- When a user is assigned a stock audit for a particular bin, the audit listing must show only
  the products held in that bin.

## Bins

- A warehouse (Floor, Godown) can have more than one bin.
- There must be a bin that holds non-assemblable items — items that need no assembly and never
  enter the build line.
- We need a bin-rule feature that automatically syncs items to a bin and places them there
  digitally at the time of inbound.
- When a bin rule is set — for example, a bin is given a rule of a brand plus its category —
  the products that already exist from the seed and match that rule must move into that bin at
  the moment the rule is created, not only from the next inbound onwards.
- [Q] Suppose there are 400 products of brand A and category AC, and bin ZX has a capacity of
  200 units. Where do the remaining 200 units of that product go?
- Stock is tracked per warehouse (Floor, Godown), per bin within that warehouse, and per unit
  within that bin.
- Unit code generation: today the code is generated when items are inbounded, and there is a
  button that generates codes for a bin, at bin level. The generated codes are unique and are
  pasted onto the items.
- [Q] How do we generate codes for the items that already exist?
- [Q] How do we place an existing item into a bin, along with its related units?
- [Q] Is a maximum-unit capacity on a bin actually necessary? It probably need not be
  mandatory — a simple count per bin may be enough.

## Inbound

- When the user approves an inbound, and a bin and a bin rule are set, the inbounded items are
  held digitally in the matching bins. If no bin matches, the items go to the unmatched holding
  area and can then be assigned to any bin.
- Vendors are created at the time of inbound, as of the 18-09-2026 code.
- [Q] Do we print the barcode and the unique code and stick them on the item — that is, is the
  U-number generated at the time of inbound, and the sticker printed and applied then?
- After inbound, the inbounded items are placed and tracked digitally in the bin, with their
  units, as per that bin.
- At present the application does not create new products from an inbound. (The code needs to
  be checked to confirm whether a new product is created or not.) Ask Syed what is needed here,
  and think through an implementation in which new products sync to their brand and category.

## Build Line

- When an inbound is done, the item is assigned to a mechanic user, who has to build and
  assemble it.
- [Q] What about the existing stock — how can it be tracked as assembled or unassembled?
  - Proposed solution: for the first run of the application, existing stock must be marked
    assembled or not assembled manually by the user. This can hang off the tracking code we
    generate: at the initial stock-counting stage, offer two options — "Assembled" and "Not
    assembled". Alternatively, once the stock audit is complete, we can sync the existing
    products directly into their respective bins.

## Outbound

- Validation: for an outward to happen, the stock must first be in the Floor warehouse. If
  there is no stock there, the stock can be reserved.
- [Q — test this scenario] If the stock is present but every unit of it is reserved, what
  happens when an outward is made? Can the outward be made at all?
- There are walk-out sales and normal deliveries. This needs checking: when the customer fills
  the form, the delivery is marked as Scheduled, but the stock appears to be reserved only when
  a staff user takes an action on the detail screen.
- Update needed: after deliveries are scheduled, at batching time the user must be able to
  generate an optimised route.
  - The route must use the location the customer provided in the form submission.
  - We need to decide what to use for the map integration and location picking — a Google Maps
    API key or a free alternative — but the implementation must be long-lasting and flexible.
- Outstation deliveries are sent by courier.
- Every delivery status update can be sent to the customer over WhatsApp.

## Purchase Order

- The user uploads the vendor's product sheet; the products are extracted, selected, and the PO
  is created from them.
- Reorder marking: a product is marked for reorder with a reorder level, a reorder quantity and
  a vendor attached. The purpose is that when a user creates a PO and selects the vendor, the
  reorder products for that vendor must be listed, so the user can select them and order them
  on the PO. The PO is then sent by email.
- Update: once the PO is made and sent to the vendor, the vendor sends its invoice by email.
  The next step in the application is that a Bill must be created in Zoho from that invoice —
  a Bill, not a Zoho Invoice, because a Zoho Invoice becomes a `Delivery` in the application
  and only a Bill becomes an `InboundShipment`.
- [Q] We need to see what the vendor's emailed invoice actually looks like. Should the Bill be
  created in Zoho manually from the application, or created through the API — a
  review-then-create flow that writes it into Zoho?
- Challenge: the research says that creating a Bill in Zoho requires the vendor ID (Zoho's
  primary key for identifying the vendor), but the application never stores the Zoho vendor ID.
  We need to work out how to bring the Zoho vendor ID into the application.
- The Vendor Contact table should be removed from the application. It serves no purpose; those
  details can live on the Vendor table itself.


---

# Consolidated list of questions, challenges and needs

Everything raised in the sections above, gathered in one place. Each row names the module or
flow it belongs to and links back to it.

## Questions to be answered

| # | Module / flow | Question |
|---|---|---|
| Q1 | [Bins](#bins) | If 400 products of a brand and category match a bin rule but the bin holds only 200 units, where do the remaining 200 units go? |
| Q2 | [Bins](#bins) | How do we generate the unique code for the items that already exist in the application? |
| Q3 | [Bins](#bins) | How do we place an existing item into a bin, along with its related units? |
| Q4 | [Bins](#bins) | Is a maximum-unit capacity on a bin necessary at all, or is a simple count per bin enough? |
| Q5 | [Inbound](#inbound) | Is the U-number generated at the time of inbound, with the barcode and unique code printed and stuck onto the item there and then? |
| Q6 | [Build Line](#build-line) | How is existing stock tracked as assembled or unassembled? The proposal is to mark it by hand at the initial stock count, or to sync it into its bins once the audit is finished. |
| Q7 | [Outbound](#outbound) | If the stock is present but every unit of it is reserved, can an outward still be made, and what happens? This scenario has to be tested. |
| Q8 | [Outbound](#outbound) | For walk-out sales and normal deliveries, the customer's form submission marks the delivery as Scheduled — but is the stock reserved only when a staff user acts on the detail screen? This has to be checked. |
| Q9 | [Outbound](#outbound) | Which map integration and location-picking service should be used — a Google Maps API key or a free alternative — that will remain long-lasting and flexible? |
| Q10 | [Purchase Order](#purchase-order) | What does the vendor's emailed invoice actually look like, and should the Bill be created in Zoho manually from the application or through the API, as a review-then-create flow? |

## Challenges

| # | Module / flow | Challenge |
|---|---|---|
| C1 | [Inbound](#inbound) | The application does not create new products from an inbound. The code has to be checked, Syed has to be asked what is needed, and an implementation designed in which new products sync to their brand and category. |
| C2 | [Purchase Order](#purchase-order) | Creating a Bill in Zoho requires Zoho's vendor ID, but the application never stores it. A way of bringing the Zoho vendor ID into the application has to be worked out. |

## Needs

| # | Module / flow | Need |
|---|---|---|
| N1 | [Startup](#how-the-application-will-be-started-and-put-into-use) | Seed Zoho's products together with their brands, categories and subcategories. |
| N2 | [Startup](#how-the-application-will-be-started-and-put-into-use) | Find the permissions that are missing from each module and assign them to the users. |
| N3 | [Stock Audit](#stock-audit) | Assign the seeded products — the ones that were never inbounded, and so were never tracked — digitally to their bins before any stock audit begins. |
| N4 | [Stock Audit](#stock-audit) | Generate the unique code that is printed, pasted onto the product and tracked digitally. |
| N5 | [Stock Audit](#stock-audit) | Allow the audit to be done by scanning with the camera and counting, rather than by entering numbers by hand. |
| N6 | [Stock Audit](#stock-audit) | Show a user who is assigned a bin audit only that bin's products in the audit listing. |
| N7 | [Bins](#bins) | Allow more than one bin per warehouse (Floor, Godown). |
| N8 | [Bins](#bins) | Provide a bin for non-assemblable items, which need no assembly and never enter the build line. |
| N9 | [Bins](#bins) | Build the bin-rule feature that syncs items to a bin and places them there digitally at the time of inbound. |
| N10 | [Bins](#bins) | When a bin rule is created, move the already-seeded products that match it into that bin straight away, not only from the next inbound onwards. |
| N11 | [Inbound](#inbound) | On inbound approval, hold the items in the matching bin; send the items that match no bin to the unmatched area, from where they can be assigned to any bin. |
| N12 | [Outbound](#outbound) | Require stock in the Floor warehouse before an outward can happen, and allow the stock to be reserved when there is none. |
| N13 | [Outbound](#outbound) | Generate an optimised route at batching time, using the location the customer gave in the form submission. |
| N14 | [Outbound](#outbound) | Send outstation deliveries by courier. |
| N15 | [Outbound](#outbound) | Send every delivery status update to the customer over WhatsApp. |
| N16 | [Purchase Order](#purchase-order) | List the vendor's reorder-marked products when that vendor is selected while creating a PO, so they can be selected and ordered on it. |
| N17 | [Purchase Order](#purchase-order) | Create a Bill in Zoho from the application, out of the vendor's emailed invoice, once the PO has been sent — a Bill, not a Zoho Invoice, because only a Bill becomes an `InboundShipment`. |
| N18 | [Purchase Order](#purchase-order) | Remove the Vendor Contact table and keep those details on the Vendor table itself. |
