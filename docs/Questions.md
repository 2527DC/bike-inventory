
# 8-9-26

-- do we need the delete button of category  ( yes we need it told by syed )
--> need to bring the brand inside the stock managemnt as the submodule  -> completed 
--> do we need delete optioon for brand delete  we can just remove the delete option and keep as inactive button which will make the brand , product , catagery as inactive 

--> the brand are getting created at teh stock audit time  too do we need it if it is needed we will have no sync with the zoho brand data 

--> do u need merge opton of  categories product and brand product ( yes we need)
--> i thinkl insted of the size u need the category  and brand selection in the product edit 
--> i think i need to remove the size filter  in the stock listing 
--> i am  removeing the ceation of  the category and brand at the time of inbound 

1. need to update this where the gst attachment should be  like file or photo where not respect to the store  setting it  in the databse with calumn where same for the like gst for store to store and Dc file  when rranswering from store to warehosue 
 and also seletion of the 
 store  to  store ( gst )
 store to warehouse ( dc file uplod )
 store the file in aws s3 buckets  -> check  weathere is there any provider 
 --> we need to remove the gst  things ui related in /store  on edit 
  in the  creaton of the storck transfer where i need two  button like store to stor or store to warehosue on selecting the store to store in the left and right it yst show the stores and   on selecting the store to warehouse i need to get in the left i need store listing and in the right side the warehouse all teh ware house not only the store specific warehouse 


2. i need to improve the implemntation that i need to remove the brand-stock  screen and its related logic what i need to do is in the creation of the po what we can do is use the ai where on upload it must extarct the product data  where  those  extracted data must show the review  in the review where i need to select   product or item name list of selcetd from the preview must be shown  check showu store the preview or selcetd data of product in the databse and where the sekected product must be show with the related things Qty , Unit Price * ,GST %  in the ui where the user can write the related data  of it  and can be saved as draft or  subbmit for approval 
where i need to implment the email thing where it has to send the email with the po with the pdf as attachment 

3. need to make it as searchable for the  stauck audit for store and its  warehouse selction 
6. check the module related permission that i need to give it  for the stock managemnet 
7.[x] need to remove the brand adding from teh stock audit 
8. Assembly audit which is build line 


# Implemnation needed 
1. ask once syed like in the product edit u have a ststic text type where u  write teh  size do u need the size or do u want it as category  is size and category different

2. tell the scope of stock holding as of now the stocks are holded at the warehouse level not the store level
 if u need it in both the level then tell me this  how does the stock and from where do u want to reduce 
 -> inbound 
 - outbound
 -> stock transfer  

 3. stock-audit/brand-count  where i need to list the store tooo 