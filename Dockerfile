

# this  is the base image layer which has the   base software and the dependencies  for the aploications
FROM node:21-alphine AS  base 
WORKDIR  app/
COPY  ./package.json    ./package.json




# this is the  dev stage image layer 

COPY --from  base  /app
Run  npm i 
COPY . .
expose 4001
cmd ["npm","run","dev"]

#  this is for the production 
FROM base  AS production 
WORKDIR app/
RUN npm i --production
COPY . . 
expose 4000
cmd ["npm","run","start"]





                          
          
     
                



p  5738