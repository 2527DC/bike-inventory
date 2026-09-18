
-> Staff must be able to see every detail the customer submitted and must be able to edit those details. Every edit to the customer details, and every other action taken, must be recorded in the activity log.
-> This includes changing the delivery date: a date change must also be logged.
-> The delivery instructions could also include a voice recording.
-> Question: at the time of delivery, if the stock is not available anywhere (not in the store, and not in its warehouses, the godown or the floor), should the delivery be marked as Pre-booked?
If it is marked as Pre-booked, what should happen next? What actions can be taken on a pre-booked delivery, and what is its workflow?
-> If the stock is not available in this store but is available in another store or warehouse, we can have a "Check stock" button that checks the other floors and godowns. If the stock is found, show a screen to raise a transfer request. A user with the related permission can see the request, approve it, or reject it with a reason. The request has a status: Pending, Processing or Completed. When it is Completed, the stock is deducted from the sending warehouse and added to the receiving warehouse.

Doubt: the map link pasted in the fill form does not seem to be used for anything, not even in batching. I need to understand how routing is done in the batching module.

# 18-9-20 (  updates  on the implmentation plan if @1709-priority-build-and-stock-flow-plan.md)
-> one in the inbound if teh line items mathc the bin rule then it must not be able to override it like Apply same bin to all items if chnage it it must effect only the item which are not automatched  this must be implmented 
-- the category and the bran are not seen in the sidebar need to bring it 
--> And as i apply the bin the  bin ruke where in that bin rule i need selection of category like where i can select category like parent or child catgory so if teh category has any child catgory i need to selct the  child category  which is ng but the cateory and after applyung it i need make sure that all the existing product must be assgned with that bin where for example the brand is accessory and the  category is also Accessory when i set it then it must apply the abin for all those procusts 
--> the bins must show the total product it holds like assemble and unassembled
-->  NOn assemble bin dont have the cycles 
--> when the items were assigned to the bin from the umatched  its not showing the poroduct in the bin it only showing the log 
--> what is this inthe request list i am getting the inbound shipment list of approve and reject how is those create from whcih table of data i am getting it 