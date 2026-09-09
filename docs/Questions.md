
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

PI.  Implment the po and the complete cycle of the aplication  
PI.  Get to know the legdger flow
PI.  Build line implemnetation :
reuiremnt  -> the build line is ntg but the assamle audit 
    Q1 -> is this module a dependent on any other module 
      eg -> the dependent module operation   must be done before  getting into this module 
    # operation steps 
     1. when a assable audit  cration is done what thing is created i need screen what it must have and what is the flow 


2. tell the scope of stock holding as of now the stocks are holded at the warehouse level not the store level
 if u need it in both the level then tell me this  how does the stock and from where do u want to reduce 
 -> inbound 
 - outbound
 -> stock transfer  

 Aanswer -> in this we need the stock count for both the warehouse and shope level where  at the time of the inbound  it must effect respect to the selected warehouse  

->  remove the warehosue from the siedbar which is the submodule for the stores  

 3. stock-audit/brand-count  where i need to list the store tooo 
 4. need to show the time stamp  the time to  insde the inbound details 
 5.  what are  vendor bills  hat action are done on the  vendor bills module 
 6. Expense : need to add the photo option in the expenses module 
     Q - do the user must be able to add one or  more than one  photo per expences creation
       -it should be like a calculator because those guys don't know that much. It should be like this:
      1. They say 450 and press +.
      2. It should ask which category.
      3. They click X.
      4. How did they pay?
      5. Next, upload a photo.
      6. Once they upload the photo, it is done.
      UAX should be like this, like a calculator.

--> we can make this like the user clicks on the expense module and  the date is autoseleted with current date and  it will be like first it will ask  for the amount and  category and after that  discription  , 
should  the paid by be search and selectable  and final payment mode selction and attachments  and  submit
where one expences  creation can have more than one expece creatiin at a time before submitting it like confermation we can have the  review 
