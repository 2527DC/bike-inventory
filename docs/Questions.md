 ZohoPullPreview — createMany INSERT, one row per surviving item, entityType: "item", status:    
    "PENDING", data = JSON of {name, sku, costPrice, sellingPrice, gstRate, hsnCode, stockOnHand,   
    productType, brand, categoryName}  --->  does this means  if the response has  data of 25 entities then will the zhohopull preview table has  25 raw data or all in one row  and 
  POSTs to /api/zoho/pull-review/approve with action: "approve", entityType: "item", and the checked  previewIds only. Unchecked rows stay PENDING forever (the pull is marked PARTIAL).   --> instde of fetching everyting of the filter period can i fetch only this number of items can be fetchd  so that it will be clean u tell me  how much of items can we load and it must support the import to   where for the nxt fetch of the same fiter  we must fetch the next data or else we can make it like this fetch the number and while importing wh can have a button like selct first 10 , to ot slect firt or last the number and it maintains the sate which was  and we will import those and we can import the next after the import get complet success full  and in the application similar why we can do it in automatically i using cron jobs  and   i must show the history of the  sync and its imports where  for seeing those let me have the filter insted of showing all but it must show last 2 days sync and imports is it by manualy or was it done by cron jobs  and tell me about this  Per-preview loop (approve/route.ts:122), not in one transaction — row by row:   which is better to have loogp or make it it one transation like in the ui after the zohoapullpreview approval  we can have the an of inset to databse which make the selecte data to insert to database which must be filterd ie no duplicated  like that  and u told me the brand and the categori are created at the  time of stcok fetch only and it check if it exist or else it inserts does  it cehck b the unique identity or just by name of the things if identity will  it save the same zohos identity   and tell me this User            │ READ — first active system-role user (used for attribution; on the items   │  
  │                 │ path it's fetched but only bills actually use it)          what atribution  and explain this i didnt get it and  tell me is my understanding is correct ot not ie when  u featch and import  if the importing data is 25 will it check every 25 data of brancd and category is it present or not  that means if thee brand table has 100 data it checks the complete 100 row for one brand ie 100 * 25 or does it uses a unique id   and if its  check by th e unique id then if i hav 25 imports then it check 25 time on the branc and the categort table  is that tru isnt is  more databse operation or will it make all the check in one operation or will it go in loop for checking    isnt it not orkth it  wnat if i make it like this like fetch saparately the brand and the category saparately and  we will not have a strict forigine key  relation in datbse we can have in the aplication layer so thet we can fetch and import saparately both  which uses the identity id from the zoho id of  it itself insted of me generationg automatically in my databse  and tell me this  1. Stock quantity is thrown away. buildItemPreviews stores stockOnHand in the preview JSON, but   
  the import writes currentStock: 0 (approve/route.ts:148, comment: "App manages its own stock").   
  Quantity comes in only via inbound shipments. Note this differs from the other items importer,    
  /api/zoho/import/items, which writes currentStock: Number(stock_on_hand) — that route isn't wired 
  to the stock page, but if anything ever calls it, the two paths disagree.   does this means even if i import the zoho stock quantity is not inserted in databse it is made 0  and the app manages it own stock  and the quantity comes in  from the when we make a inbound fecth and improt from the related provider  what is the meaning of this   Note this differs from the other items importer,  give me an example for this   to me to understand 


---->> 
  2. No StockLevel row is created. Per-location stock is the real source of truth
  (Product.currentStock is described in the schema as the cached SUM of StockLevel rows). A
  Zoho-imported product has zero StockLevel rows until it's received somewhere. No
  InventoryTransaction is written either — there's no audit row saying the product was born.   -> i didnt get this guve me an exple and explain me like a story action  what happend  and 

--->  Evidence, not inference:

  1. export const maxDuration = 60 on both routes (trigger-pull/route.ts:5, approve/route.ts:2).    
     Vercel kills the function at 60s and returns a 504 with an HTML body.
  2. We never set a timeout on the Zoho call. base.ts:287 is a bare await fetch(url, options) — no  
     AbortSignal, no AbortController. We physically cannot time Zoho out ourselves.
  3. If Zoho were the one timing out, you'd get a named error, not a silent 504 — readJson()        
     (base.ts:325) checks content-type first and throws "Zoho Books returned text/html, status 504".     You're not seeing that.  does zoho has any time out if i dont set in my aplication because not all the items are  imported and if i fetch again it tells ntg to fetch how can i fix it  what if i dont  use the  time out in our application 

---> 
  Zoho's actual limits (different concern)

  Zoho Books/Inventory don't impose a request timeout that you'd hit here — they impose rate limits:  a per-minute call cap and a per-day cap that varies by plan (check your org's API console for the 
  exact figures; they're per-organization, not per-token). That path is already handled —
  base.ts:308 catches 429, honours Retry-After, and backs off exponentially up to 3 attem and for this i need my aplciation to show proper error in the ui if something gose wtog on my aplication or errofrom the zhoa  handle proper  exception handling 

  --> Not the Zoho fetch — that's already set-based and fast (200 items/page, ~5 pages for 1000 items). 
  It's the import loop, which is still one-record-at-a-time: what do u mean by this i didnt understood explain with example   can it b improved if so like using a bestter aproch and uses dsa 
--> if the have 22 item and make impror and only 14 got imported and if i fetch again it show all the items wered fetched but  our application did not import itseff  how can i fix this  can i know which are  the item whcih got faild to import  and have an action to import those again can this be done  check the zho r related api doc and let me know 


--> 2. What happened to the pull review

  - The 8 previews are still status: "PENDING".
  - remainingPending = 8 → the pull was marked PARTIAL (:526), approvedAt left null.
  - Your next fetch creates a new pullId. Those 8 become orphans — /stock only ever reads its own   
    current pullId, so they're invisible there. They're only reachable at
    /settings/integrations/pull-review.
  - Nothing ever cleans them up. They accumulate with every partial import.  

      -- how can i fix this   the invisibel things 


 1. senario : when i made stock fetch  and  its fetched 132  items  and when i clicked the import it made a time out where i went to the /settings/integrations/pull-review screen and clicked the  review button and it shoed me teh 132 items and when  i click approve all it made  a req to https://bike-inventory-delta.vercel.app/api/zoho/pull-review/approve where this is what i got the response {
    "success": true,
    "data": {
        "action": "approved",
        "entityType": "all",
        "remainingPending": 1,
        "contacts": 0,
        "items": 14,
        "bills": 0,
        "invoices": 0,
        "errors": []
    }
} 


 and i selcetd the 14 itsem and clicked the import it gives me approved but the items are not showin in the stock page 
 

 what  i think is i dont want the fetch and import of product itself i want  to remove all the    
  related backend and frontend i dont wat to fetch the product from  itself remove related thing    
  create a plan for that  what i will do is  that i  will run the seeding for that or direct        
  insert where from u i will give  the relatd  file so that u can make a direct insert operation    
  and  we will make a modules as stock managemnt in that i will have stocks  module and product     
  type module where the product type module  must be the submodule in the  stock management  , and  
  another submodule of  stock audit module too  /stock-audit stock-auditin the stock management     
  module and also the inbound and  delivery dispatch sibde bar modules to the  stock mangment and  also the stock transfer  inside the  stock managemnt submodule 



  2nd 

  push notification , email notiication ,  intigration  and ai agent intigration set up  respected to listing  module and 
   the push and email notfication must have just turn on and off related details configuration rnd for to use which push notifictaion i prefer aws 

