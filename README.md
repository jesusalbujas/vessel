<p align="center">
  <img src="public/favicon.svg" alt="Vessel logo" width="92" height="92">
</p>

<h1 align="center">Vessel</h1>

<p align="center"><strong>One control plane for Docker, Compose, and application delivery.</strong></p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> · <a href="README.es.md">Español</a>
</p>

<p align="center">
  <img alt="Go" src="https://img.shields.io/badge/Go-control%20plane-00ADD8?logo=go&logoColor=white">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-web%20console-111111?logo=nextdotjs&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Engine%20%2B%20Compose-2496ED?logo=docker&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local%20metadata-003B57?logo=sqlite&logoColor=white">
</p>

<p align="center">
  Vessel is a self-hosted, general-purpose platform to inspect and operate Docker resources, manage Compose projects, and deploy applications from Git.
</p>

---

## What Vessel is

Vessel brings common container operations and application delivery into one web control plane. Its goal is to make everyday Docker work understandable to both developers and operators, without requiring a fixed service catalog or tying the product to one ERP, database, or cloud provider.

Vessel is its own project: it uses familiar infrastructure concepts, but is not a Portainer or Dokploy fork or re-skin.

### Available today

- **Docker resources:** inspect containers; start, stop, restart, recreate, remove, and view logs; manage images, volumes, and networks.
- **Compose projects:** discover projects from Docker labels, edit mounted Compose files, validate with `docker compose config`, and deploy or take down projects.
- **Git deployments:** connect Git providers, choose accessible repositories, configure a Compose file and deployment variables, and inspect deployment progress/history. GitHub uses an installable GitHub App flow; GitLab, Gitea, and Bitbucket use provider credentials/OAuth flows.
- **Data-aware duplication:** duplicate an application alone or copy its database as a separate resource. Initial database-copy adapters support PostgreSQL, MySQL, and MariaDB when Vessel can identify a complete connection from the source service.
- **Scheduled tasks:** run trusted shell scripts manually or on a cron schedule, with time zones, encrypted environment variables, execution timeouts, persisted run history, and captured output.
- **Access and secrets:** first-admin setup, administrator/operator/viewer roles, expiring sessions, session revocation, and encrypted registry/provider/deployment credentials in SQLite.
- **Host overview:** Docker/Compose information and CPU, memory, and Vessel-data-filesystem metrics.
- **English and Spanish:** switch languages from the application header.

## Product roadmap

This roadmap records the product direction, not release dates. Items are grouped by what is already usable and what should come next; priorities may change with real-world use.

### 1. A reliable Docker workspace — available, ongoing hardening

- Keep containers, images, volumes, networks, and Compose projects as distinct workspaces with consistent search, sorting, actions, and confirmation flows.
- Make operations understandable and observable: show progress, final result, useful logs, and recoverable errors without blocking unrelated resources.
- Continue improving the dashboard with host capacity, Docker Engine and Compose versions, resource totals, and clear health/status indicators.
- Preserve a generic model: Docker names, labels, networks, environment variables, and mounts should work without ADempiere-specific assumptions.

### 2. Compose-first application delivery — available, expanding

- Create, validate, deploy, update, and stop Compose projects from Vessel.
- Discover projects created outside Vessel and allow editing when their source directory is explicitly mounted.
- Improve deployment review with clearer diffs, validation feedback, project history, and safer handling of environment files and secrets.
- Make project and container relationships obvious, while keeping direct container operations available when appropriate.

### 3. Git-connected deployments — available, provider flows evolving

- Use GitHub App installation so an administrator can create/connect the app through GitHub and grant access to all or selected repositories.
- Support GitLab, Bitbucket, and Gitea through their provider-specific application and authorization models.
- Deploy a selected repository branch and Compose file; keep provider credentials and per-deployment secrets encrypted and out of browser responses.
- Continue toward shared, live deployment status, durable progress after refresh/re-login, clearer logs, retries, and safe rollback strategies.
- Keep polling as the local-friendly baseline; add webhooks only where a secure, reachable endpoint is configured.

### 4. Generic application and data cloning — initial adapters available, broaden next

The distinctive goal is to clone an application and, optionally, the data service it depends on—not merely duplicate a container. Vessel currently has initial adapters for PostgreSQL, MySQL, and MariaDB; it is not yet a universal database copier.

- Separate the concepts in the workflow: **application only**, **application + data**, and eventually **data-only backup/restore**.
- Grow the adapter model so engine-specific backup/restore logic does not leak into the generic interface.
- Add more data engines only with explicit capability checks, credential handling, progress reporting, and tested restore behavior.
- Strengthen safeguards for existing destinations, occupied names/ports, production sources, shared volumes, and accidental overwrite.
- Persist operation state and logs so a refresh does not hide a long-running copy; make retries and cleanup explicit.

### 5. Scheduled scripts and backups — scheduled scripts available, backups planned

Vessel includes an integrated runner for trusted shell scripts. The **Scheduled Tasks** module supports manual runs and cron schedules, IANA time zones, encrypted task environment variables, execution timeouts, persisted history, and captured logs.

- Add cancellation, retries, richer secret references, and finer-grained permissions.
- Add scheduled database and volume backups, retention policies, restore workflows, and shared progress for long-running operations.
- Continue strengthening script isolation and make execution permissions clearer before a task can affect production data.

This is a future capability; Vessel's current Jobs page does not yet replace a general-purpose Rundeck installation.

### 6. Multiple Docker hosts and a stable automation API — planned

- Move from the current local Docker Engine connection toward multiple named environments, with host-level status and resource scoping.
- Evaluate a least-privilege agent/endpoint design, secure enrollment, TLS, and per-environment authorization before enabling remote Docker control.
- Document and version a supported API for automation, with scoped API credentials, audit records, rate limits, and revocation.

## Architecture

Vessel is packaged as one container with two coordinated processes:

```text
Browser
  └── Next.js / React UI and web API
        └── internal Go control plane (127.0.0.1:9100)
              └── Docker Engine API via /var/run/docker.sock

SQLite ── users, sessions, settings, encrypted credentials, and operation metadata
```

The Go control plane is part of Vessel—not a separately deployed management service. Next.js route files are HTTP adapters; domain and provider logic is organized under `src/server/api` and `src/lib`. SQLite stores application metadata; Docker remains the source of truth for Docker resources.

## Quick start

Requirements: Docker Engine with the Compose plugin, and permission to access the Docker socket.

```bash
git clone https://github.com/jesusalbujas/vessel.git
cd vessel
cp .env.example .env
```

Before exposing Vessel, replace the example values in `.env`:

- Set `VESSEL_SECRET_KEY` to a private random value of at least 32 characters. For example, generate one with `openssl rand -hex 32` and paste the output into `.env`.
- Set a strong `VESSEL_ADMIN_PASSWORD`, or use the first-administrator setup screen if bootstrap credentials are not configured.
- Keep `VESSEL_COOKIE_SECURE` empty for HTTPS deployments. For a restricted, trusted HTTP network only, set it to `false`; Vessel remains in production mode, but browsers will send the session cookie over HTTP.
- Keep `.env` private and backed up securely. Losing or changing the secret key makes encrypted values already stored by Vessel unrecoverable.

Start Vessel:

```bash
docker compose up -d --build
```

Open [http://127.0.0.1:55300](http://127.0.0.1:55300). Vessel persists its local metadata in `./data` and accesses the local Docker Engine through `/var/run/docker.sock`.

The web port binds to `127.0.0.1` by default. To publish Vessel behind a trusted HTTPS reverse proxy, set `VESSEL_BIND_ADDRESS=0.0.0.0` and firewall the host port so it is reachable only through that proxy. Access to the Docker socket grants host-level control; give Vessel access only on hosts and to administrators you trust.

### Docker image and tagged releases

The maintained Dockerfile is `docker/Dockerfile`; `docker/compose.yaml` is also available for a self-contained Compose deployment. The root Compose files use the same Dockerfile.

To publish to Docker Hub, add the repository Actions secrets `DOCKERHUB_USERNAME` (`jalbujas`) and `DOCKERHUB_TOKEN` (a Docker Hub access token with permission to push), then push a version tag such as `v0.1.0`. The `publish.yaml` workflow builds `docker.io/jalbujas/vessel` for `linux/amd64` and `linux/arm64` and publishes the version tag, semantic-version tags, and `latest`. After the image push succeeds, the same workflow creates a GitHub Release with generated notes. The version shown in Vessel is built from that release tag. `ci.yaml` typechecks and builds pushes and pull requests to `main` or `master`.

To build using the Compose file in the Docker directory, run `docker compose -f docker/compose.yaml up -d --build` from the repository root. Set `VESSEL_VERSION` in `.env` only when you want a local build to display a version different from `package.json`.

### Development with hot reload

```bash
docker compose -f docker-compose.dev.yml up --build
```

The development Compose file mounts the source tree and runs `next dev`; ordinary UI/API edits do not require rebuilding the container. Open [http://127.0.0.1:55300](http://127.0.0.1:55300). Stop the development stack with `Ctrl+C` or `docker compose -f docker-compose.dev.yml down`.

### Existing Compose files

Vessel can discover external Compose projects through Docker labels. To read and edit their files, set `VESSEL_COMPOSE_HOST_ROOT` to the host directory containing those files before starting Vessel. Only that configured directory is mounted into Vessel for source-file access.

### Git provider callback URL

Vessel uses the browser-visible origin for Git provider callbacks, including HTTP origins such as `http://192.168.1.20:55300`. Set `VESSEL_PUBLIC_URL` only when a reverse proxy or external address differs from the URL users open. HTTPS is recommended outside trusted local networks because HTTP does not encrypt sessions or callback codes.

## Security notes

Mounting `/var/run/docker.sock` gives Vessel broad control over the Docker Engine and should be treated as host-administrator access. Do not expose Vessel directly to the public internet; use HTTPS, a trusted reverse proxy, network restrictions, strong credentials, and current backups.

Vessel hashes local passwords with `scrypt`, stores sessions with expiration, and encrypts stored provider/registry/deployment credentials with AES-256-GCM using `VESSEL_SECRET_KEY`. Access to Docker can still reveal container configuration and environment variables, including values passed to a container. Prefer Docker Compose secrets or mounted secret files for runtime-sensitive values, and only deploy trusted repositories because a Compose project can control the connected Docker Engine.

## Current boundaries

- The control plane currently manages the local Docker Engine; multi-host management is on the roadmap.
- Database copying is supported only for the initial PostgreSQL, MySQL, and MariaDB adapters and recognized connection settings.
- Ordinary container duplication can reuse mounted volumes; it does not imply a copy of the files inside those volumes. Review mounts before creating a duplicate.
- Scheduled shell scripts are available to administrators; backup workflows, a broad audit trail, and a public automation API remain roadmap work.

## Contributing

Issues and pull requests are welcome. Keep Docker/provider-specific behavior behind the relevant adapter, keep route files thin, and add English and Spanish strings for every new visible message. Never commit `.env` files, private keys, access tokens, or production data.
