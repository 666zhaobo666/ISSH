# Stage 1: Build @issh/core, @issh/admin, and unified full-featured Web/Desktop UI (@issh/desktop)
FROM node:22-alpine AS frontend-builder
WORKDIR /src
COPY package.json package-lock.json* ./
COPY packages/core ./packages/core
COPY apps/admin ./apps/admin
COPY apps/desktop ./apps/desktop
RUN npm install --no-audit --no-fund
RUN npm run build --workspace=@issh/core \
 && npm run build --workspace=@issh/admin \
 && npm run build --workspace=@issh/desktop

# Stage 2: Build Go server binary (pure Go SQLite, CGO_ENABLED=0)
FROM golang:1.24-alpine AS backend-builder
WORKDIR /src/services/server
COPY services/server/go.mod services/server/go.sum ./
RUN go mod download
COPY services/server ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /issh-server ./cmd/issh-server

# Stage 3: Minimal production runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /issh-server /app/issh-server
COPY --from=frontend-builder /src/apps/admin/dist /app/static/admin
COPY --from=frontend-builder /src/apps/desktop/dist /app/static/web

ENV ISSH_LISTEN_ADDR=:8080 \
    ISSH_DATA_DIR=/data \
    ISSH_ADMIN_DIST=/app/static/admin \
    ISSH_WEB_DIST=/app/static/web

VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/app/issh-server"]
