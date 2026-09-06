FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY schema.sql ./
COPY src ./src
COPY data ./data

EXPOSE 3000
CMD ["node", "src/index.js"]
