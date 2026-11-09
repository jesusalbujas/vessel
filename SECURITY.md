# Security notes

Vessel is a Docker control plane. It can create, start, stop, and remove resources on the configured Engine. Treat Vessel administrators, deployment definitions, and the host running Docker as privileged infrastructure.

## Docker access and trust boundary

- Access to `/var/run/docker.sock` grants broad control of the Docker host and can be used to obtain host-level access. Vessel cannot make an untrusted Docker Compose file or shell job safe while it has this access.
- Run Vessel only on a host you trust. Give administrator access only to people allowed to control that host. Operators can manage Docker resources; viewers cannot see container environment values or read container logs.
- Only deploy Compose files and scripts from trusted sources. Compose can mount host files, and scheduled shell jobs execute commands with the permissions of the Vessel process.
- The web port binds to localhost by default. If remote access is required, use a trusted HTTPS reverse proxy, firewall the direct port, and set `VESSEL_BIND_ADDRESS=0.0.0.0` intentionally.

## Secrets and accounts

- Keep `.env`, `VESSEL_SECRET_KEY`, Docker credentials, provider credentials, and API tokens out of Git, issue trackers, and logs. The example environment file contains placeholders only.
- Use a randomly generated `VESSEL_SECRET_KEY` with at least 32 characters. Vessel now fails closed instead of deriving an encryption key from a public fallback value. Back up the key separately from Vessel's database; encrypted credentials cannot be recovered without it.
- Revoke and replace credentials if they may have been exposed. Changing the encryption key does not re-encrypt existing data; first configure the new key through a planned secret migration or recreate the stored credentials.
- Use unique, strong passwords and short-lived API tokens with the least access practical. Revoke unused sessions and tokens.
- Prefer Docker secrets or mounted secret files for application credentials. Container environment variables and logs may be visible to Docker administrators.

## Reporting a vulnerability

Do not publish credentials, exploit details, or customer data in public issues. Contact the repository maintainers privately with a description, impact, and reproduction steps. Do not include live secrets in the report.
