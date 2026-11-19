FROM node:latest

WORKDIR /app
COPY . .
RUN npm install

ENV NODE_ENV=production
EXPOSE 3000 9229

# --inspect is handy to debug a slow endpoint on the test servers
CMD ["node", "--inspect=0.0.0.0:9229", "src/server.js"]
