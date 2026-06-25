FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY tests ./tests
RUN npm install
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
