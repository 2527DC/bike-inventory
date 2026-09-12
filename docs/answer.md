1. We also do stock counting at the store, and we also do assembly at the store. We also have bin locations at the store. 
2. Currently, we are not selling items from the warehouse, but in the future, we will also sell items from it. That is why I told you that we would also pull items from the warehouse.

A complaint can come from a customer, logged by staff, or from the mechanic about the product quality. After the fourth step in the whole flow of the story, the mechanic also pastes the barcode on the cycle he pulls out from the warehouse. We will label the barcode on the cycle. This is a physical activity done while we are inverting the cycles, and the mechanic labels it on the cycle.

Yes, a bin is part of a warehouse. The overall idea is that, let's say, if there is a warehouse layout with 10 different locations or corners, each corner is a bin number. I think we must be able to create n bin numbers inside one warehouse because we can have n corners, locations, or landmarks. Each landmark is a bin, and once a bin is created, we would label it physically inside the store so the person working on the floor understands what this bin is.
Yes, it is for both quantities of everything, plus each unit has its own bin for anything carrying a code. Yes, we can do this. It should show:
- Awaiting
- Put away
- Receive
- First put away
- Second put away
It can be done this way because a bin is not specific to one brand, one type, or one color. It can be for anything and everything. Maybe I would want one particular brand or one particular model to be combined with another model and kept in some place. It should be up to the admin to assign the bin and make sure this particular item stays inside this bin.
The entire flow also needs another step where the admin assigns the bin to the items. If you ask me whether we have to make a segregation, we would first categorize it by brand and then by size. This way, we can also generate custom reports inside our application. Let's say we have 20 motorcycles, and under those, we have:
- 4 24-inch cycles
- 5 20-inch cycles
- 10 29-inch cycles
This is how we can categorize them inside the bin. The flow is from the brand, so we need to assign each item to the bin. Otherwise, how will we even know which item is allocated to which bin?
I think the admin decides who controls the creation, editing, and deletion of the bins. Yes, it will be a unique code per warehouse, and it will be a series of codes. Let it have no bin, and once we are doing the inwards, we will select the bin because that is the step where this bin is being considered.
Yes, a move action with a log is fine. We don't need approval, but we need a move action with a log. When we are outwarding the item, I will make sure the bins are designed so that, let's say, if I say this is bin A1 and we keep this particular model, brand, and category here, we need to make sure this is followed. Once we make sure this is followed, it becomes easier.
Related to the bin audit, I think maybe we can have it set up so we get to know which stock is lying under which bin. We can then maybe sort by the highest stock quantity first, go to that bin, and figure it out. The app should also tell us where this bin is inside the warehouse or the store. Let's say the bin is right inside the store, on your left-hand side, on the first rack, because the warehouse is designed in such a way that you can actually name it. Currently, there are 4 racks on the ground floor, and on the upper floor, we have 6 different lines. The app must be able to tell the counter the directions as well, and it will help him in the audit.
We start from the bin with the largest number of items for the audit. Currently, I am going to use a barcode scanner, so he just scans or ticks anything, and it is okay. I think it should not allow the approver to record the difference or set the system stock count. It should only allow the admin to do this, and no one else. 
 and in this system everything si RBAC no static  persmision of user access all the permission will be under the role and that role will be attached to the user where  he user get the permission the suprivior or mecanic  this are role  where the admin will create them with the module related permission as needed in this requirement 

 Here, we need to do a mechanical assignment and state. Currently, we need to record the assembly state of each bicycle: 50%, 85%, or 100%. We need to know how many bicycles are assembled in each category. I think it will be the supervisor's responsibility while he is assigning these cycles. He selects the assembly condition of the product just once, so this becomes a one-time task for him.

Let's say there are 10 bicycles, and he has to assign 6 of them. For these 6 cycles, the condition is item-level, so he mentions it. This makes it a very easy task for him.

Yes, adding a hold item is required because of the missing parts, damaged-on-arrival, and similar reasons. The reason I kept it this way inside the service app (50%, 85%, 100%) was to record the assembly and services, but later I have understood that you know Assembly was a build-line process and not a part of the service app, so we didn't actually continue using it. Yes, the photo is required to complete an assembly, and yes, it must move automatically to the assembly area bin. Let it move automatically, because it is simply avoiding the additional click or effort.  Yes, let us have the suggested code.

Again, I want to ask you: if we have the suggested code on the bicycle, would it help us with billing, given that we are using Zoho? There is already a number, and this is a serial number, not an SKU. The SKU is the product code, and the serial number is something we invent in our build line process or the assembly audit line process.

I just want to clarify that these two are different numbers, and on the barcode, we have the SKU and the serial number together. When we are billing, we make sure to type the serial number because you can do that. Frame number will be recorded once we have received the stock and once we have put it away. It is not mandatory for all the brands, but for a few brands, let's make it mandatory. Currently, the customer complaint that goes into the app is via Telicarum. We have a Telicarum application that I will install on all the employees' devices. It will record the customer's audio and conversation, then push a transcription to the cloud. We use the transcription to understand how many complaints we are receiving, what is happening, and related details. Here, we also need to understand the complaint coming from the Mac. We have already discussed that, so it has to go to the vendor issues. What we'll do is this: while billing the cycle, we can type the serial code along with the billing number, or maybe we'll just insert it as a note on the sales invoice. We will pull the sales invoice in the outward, and we'll make sure we can pull this note or the serial number that we had written on the sales invoice. I don't know what the better way is. If you can, check with AI and tell me what the best possible way is. It will be better. 


Yes, let a supervisor count a log as an assembly fault, and only then will it be mentioned as an assembly fault.

We do about 1,000 cycles a month, and the number of bins will be somewhere between 20 and 30. The number of mechanics will be 7 to 8, and the number of stores that will use this will be 3. Currently, we don't assemble e-bicycles in the BCC warehouse, so it will be 3. I would still say Q44: keep both.



