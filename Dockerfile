FROM golang:1.23-alpine AS backend-builder
WORKDIR /src/backend
COPY backend/go.mod ./
COPY backend/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/vessel-backend .

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM dependencies AS development
RUN apk add --no-cache postgresql16-client mariadb-client docker-cli docker-cli-compose
COPY backend/go.mod ./backend/go.mod
COPY backend/main.go ./backend/main.go

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache postgresql16-client mariadb-client docker-cli docker-cli-compose
COPY --from=backend-builder /out/vessel-backend /usr/local/bin/vessel-backend
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["vessel-backend"]
