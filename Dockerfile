FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json server.js index.html styles.css app.js upload-module.js tryon-generator.js ./
COPY promo-tile-a.jpg promo-tile-b.jpg promo-tile-c.jpg ./

EXPOSE 5188

CMD ["node", "server.js"]
