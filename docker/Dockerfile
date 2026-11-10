FROM golang:1.23-alpine AS backend-builder
WORKDIR /src/backend
COPY backend/go.mod ./
COPY backend/main.go ./
COPY backend/remote_engines.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/vessel-backend .

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM dependencies AS development
RUN apk add --no-cache ca-certificates curl wget bash openssh-client-default sshpass git python3 py3-pip postgresql16-client mariadb-client docker-cli docker-cli-compose \
    && python3 -m pip install --no-cache-dir --break-system-packages s3cmd==2.4.0
COPY backend/go.mod ./backend/go.mod
COPY backend/main.go ./backend/main.go

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG VESSEL_VERSION
ENV NEXT_PUBLIC_VESSEL_VERSION=${VESSEL_VERSION}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build \
    && rm -rf \
      .next/standalone/node_modules/@img/sharp-libvips-linux-x64 \
      .next/standalone/node_modules/@img/sharp-wasm32

# PostgreSQL 13 is no longer available in the current Alpine repositories.
# Build only the client tools from its final upstream release; the server is
# never copied into the Vessel runtime image.
FROM alpine:3.24 AS postgresql13-client-builder
ARG POSTGRESQL13_VERSION=13.23
RUN apk add --no-cache build-base openssl-dev zlib-dev curl ca-certificates bzip2 perl
WORKDIR /tmp
RUN curl -fsSLo postgresql.tar.bz2 "https://ftp.postgresql.org/pub/source/v${POSTGRESQL13_VERSION}/postgresql-${POSTGRESQL13_VERSION}.tar.bz2" \
    && echo "6ec3c82726af92b7dec873fa1cdf881eca92a4219787dfad05acb6b10e041fd6  postgresql.tar.bz2" | sha256sum -c - \
    && tar -xjf postgresql.tar.bz2 \
    && cd "postgresql-${POSTGRESQL13_VERSION}" \
    && ./configure --prefix=/opt/postgresql13 --with-openssl --with-zlib --without-readline
RUN cd "postgresql-${POSTGRESQL13_VERSION}" \
    && make -s -C src/backend generated-headers \
    && make -s -C src/bin/pg_dump -j2 pg_dump pg_restore \
    && make -s -C src/bin/psql -j2 psql \
    && make -s -C src/interfaces/libpq install \
    && install -D -m 755 src/bin/pg_dump/pg_dump /opt/postgresql13/bin/pg_dump \
    && install -D -m 755 src/bin/pg_dump/pg_restore /opt/postgresql13/bin/pg_restore \
    && install -D -m 755 src/bin/psql/psql /opt/postgresql13/bin/psql \
    && strip /opt/postgresql13/bin/pg_dump /opt/postgresql13/bin/pg_restore /opt/postgresql13/bin/psql /opt/postgresql13/lib/libpq.so.5.13

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ca-certificates curl wget bash openssh-client-default sshpass git python3 py3-pip postgresql16-client mariadb-client docker-cli docker-cli-compose \
    && python3 -m pip install --no-cache-dir --break-system-packages s3cmd==2.4.0 \
    && rm -f \
      /usr/bin/mariadb \
      /usr/bin/mariadb-admin \
      /usr/bin/mariadb-check \
      /usr/bin/mariadb-import \
      /usr/bin/mariadb-secure-installation \
      /usr/bin/mariadb-show \
      /usr/bin/mariadb-waitpid \
      /usr/bin/myisam_ftdump \
      /usr/bin/mysql \
      /usr/bin/mysql_secure_installation \
      /usr/bin/mysql_waitpid \
      /usr/bin/mysqladmin \
      /usr/bin/mysqlcheck \
      /usr/bin/mysqlimport \
      /usr/bin/mysqlshow \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
COPY --from=postgresql13-client-builder /opt/postgresql13/bin/pg_dump /opt/postgresql13/bin/pg_dump
COPY --from=postgresql13-client-builder /opt/postgresql13/bin/pg_restore /opt/postgresql13/bin/pg_restore
COPY --from=postgresql13-client-builder /opt/postgresql13/bin/psql /opt/postgresql13/bin/psql
COPY --from=postgresql13-client-builder /opt/postgresql13/lib/libpq.so.5.13 /opt/postgresql13/lib/libpq.so.5.13
RUN ln -s libpq.so.5.13 /opt/postgresql13/lib/libpq.so.5 \
    && for tool in pg_dump pg_restore psql; do \
      printf '#!/bin/sh\nexport LD_LIBRARY_PATH=/opt/postgresql13/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\nexec /opt/postgresql13/bin/%s "$@"\n' "$tool" > "/usr/local/bin/${tool}13"; \
      chmod 755 "/usr/local/bin/${tool}13"; \
    done \
    && mkdir -p /usr/local/pg13/bin /usr/local/pg16/bin \
    && for tool in pg_dump pg_restore psql; do \
      ln -s "/usr/local/bin/${tool}13" "/usr/local/pg13/bin/${tool}"; \
      ln -s "$(command -v "$tool")" "/usr/local/pg16/bin/${tool}"; \
    done
COPY --from=backend-builder /out/vessel-backend /usr/local/bin/vessel-backend
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["vessel-backend"]
