FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate --schema packages/db/schema.prisma
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/packages/db ./packages/db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health >/dev/null || exit 1

CMD ["npm", "run", "start"]
