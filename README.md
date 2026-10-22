<p align="center">
  <img src="public/favicon.svg" alt="Vessel logo" width="112" height="112">
</p>

<h1 align="center">Vessel</h1>

<p align="center">A focused, self-hosted control plane for discovering and operating Docker resources.</p>

<p align="center"><a href="http://127.0.0.1:55300">Open Vessel</a></p>

## Overview

Vessel is a generic Docker management portal. It runs its Go control plane and web interface in one container, giving operators a clear way to inspect and operate containers, images, volumes, networks, logs, and service metadata.

Vessel is intentionally not tied to ADempiere, a specific database vendor, or a fixed service catalog.

## Stack

- Go control plane for Docker Engine operations
- Next.js App Router, React, and TypeScript for the web interface
- Docker Engine API through the local Unix socket
- SQLite for lightweight portal metadata
- PostgreSQL client tools for optional database cloning workflows
- Docker Compose for local deployment

## Run locally

```bash
docker compose up -d --build
```

Open [http://127.0.0.1:55300](http://127.0.0.1:55300).

The local Compose file connects Vessel directly to Docker Engine through the mounted local socket and stores Vessel metadata in `./data`.

No host address is hard-coded. Published service links use the hostname of the request by default; set `PUBLIC_SERVICE_HOST` only when Vessel is behind a proxy or needs a different public hostname. To inspect Compose files outside Vessel's managed directory, set `VESSEL_COMPOSE_HOST_ROOT` to an absolute directory on the Docker host before starting Compose. Without it, external Compose projects are still discovered by Docker labels, but their source files are not editable through Vessel.

PostgreSQL cloning is optional. Vessel reads `DB_HOST`/`POSTGRES_HOST`, `DB_PORT`/`POSTGRES_PORT`, and database credentials from the source container. For a database reachable at a different address from Vessel, set `VESSEL_DATABASE_HOST` and optionally `VESSEL_DATABASE_PORT`; no host, PostgreSQL version, or published port is assumed. Legacy `ADEMPIERE_DB_*` variables remain supported for existing containers.

### Development mode

Run the hot-reload development container without rebuilding on every source change:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Then open `http://127.0.0.1:55300`. The source directory is mounted into the container and Next.js runs with `next dev`; only dependency changes require rebuilding the development image. Stop it with `Ctrl+C` or `docker compose -f docker-compose.dev.yml down`.

## Architecture

The image contains two coordinated processes:

1. The Go control plane listens internally on `127.0.0.1:9100` and talks directly to Docker Engine.
2. The Next.js server provides the public web interface on port `3000`.

The web API uses Vessel's Go control plane, which communicates directly with Docker Engine through the local Unix socket. Vessel does not require a separate container-management service.

### API organization

Next.js route files are intentionally thin HTTP adapters. Domain logic lives under `src/server/api`, following a controller-oriented structure:

```text
src/
├── app/api/                 # HTTP method adapters only
└── server/api/              # domain controllers and orchestration
    ├── services.ts          # container discovery and lifecycle actions
    ├── resources.ts         # images, volumes, and networks
    ├── logs.ts              # container logs
    ├── labels.ts            # Vessel metadata
    └── jobs.ts              # background operation state
```

This separation gives Vessel a stable API boundary for future authentication, authorization, audit events, provider adapters, and additional Docker resources without coupling those concerns to the React interface.

## Security

Mounting `/var/run/docker.sock` grants administrative control over Docker. Before exposing Vessel beyond a trusted local network, add authentication, role-based authorization, CSRF protection, rate limiting, and an audit trail. Prefer a restricted Docker API proxy when the full socket is not required.

The current security foundation includes SQLite-backed users, roles (`administrator`, `operator`, and `viewer`), expiring bearer sessions, password hashing with `scrypt`, and encrypted registry secrets using AES-256-GCM. Set `VESSEL_SECRET_KEY` and `VESSEL_ADMIN_PASSWORD` before exposing the application. When no user exists, `/login` presents a one-time first-administrator setup flow; once created, the same screen becomes the normal sign-in form. The sidebar also exposes a real sign-out action that revokes the bearer session.

## Compose projects

The Compose module discovers existing projects from Docker Compose labels (`com.docker.compose.project`, working directory, config files, and service), including projects that were not created by Vessel. It stores submitted projects under `VESSEL_COMPOSE_ROOT`, validates them with the installed Docker Compose CLI, and can run `up -d --remove-orphans` or `down --remove-orphans`. To edit an existing external project, set `VESSEL_COMPOSE_HOST_ROOT` to the host directory containing its Compose files. Vessel mounts only that directory, preventing arbitrary host filesystem reads.

The sidebar provides entry points for Compose projects, registries, users, and the existing Docker resource catalog. Database cloning and application duplication remain available as optional workflows, while the underlying container operations stay generic.

## Internationalization

Vessel includes a complete localization foundation with English and Spanish as the first supported languages. The language switcher is available in the header. Translation rule: every new module, label, status, error, empty state, action, tooltip, and confirmation must be added to the central translation catalog before it is rendered; components must use `useI18n().t(...)` rather than introducing one-off language ternaries.

## Roadmap

1. Move all container creation, recreation, and duplication workflows into the Go control plane.
2. Add authentication, roles, audit events, and a restricted action policy.
3. Complete English/Spanish coverage for every UI message, including errors and progress states.
4. Add additional Docker and OCI resource providers without coupling the UI to one platform.
