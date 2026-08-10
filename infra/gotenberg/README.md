# Private Gotenberg for ORDA

Production deployment package for a dedicated Docker host. It exposes only an
HTTPS Caddy gateway; Gotenberg stays on an internal Docker network. Every
external request, including `/health`, requires
`Authorization: Bearer <GOTENBERG_TOKEN>`.

The stack uses the official security-fixed LibreOffice-only image
`gotenberg/gotenberg:8.34.0-libreoffice`. Only these routes are exposed:

- `GET /health`
- `POST /forms/libreoffice/convert`

## Host requirements

- Linux host with Docker Engine and Docker Compose v2;
- at least 1 CPU and 1 GB RAM available to Gotenberg;
- a dedicated DNS name whose A/AAAA record points to the host;
- inbound TCP 80 and 443 open for Caddy ACME/HTTPS;
- outbound HTTPS open for ACME certificate issuance.

## Deploy

1. Copy this directory to the Docker host.
2. Copy `.env.example` to `.env` and set a real domain, operations email and a
   random token of at least 32 bytes. Never commit `.env`.
3. Point DNS at the host and wait for propagation.
4. Run `docker compose pull` and `docker compose up -d`.
5. Run `GOTENBERG_URL=https://<domain> GOTENBERG_TOKEN=<token> ./verify.sh`.
6. Add the same URL and token to the **Production** environment of the linked
   ORDA Vercel project. Do not add them before the protected HTTPS checks pass.

The gateway enforces a 20 MB upload limit. Gotenberg has a 35 second request
timeout, a four-request LibreOffice queue, bounded process resources, an
ephemeral 512 MB `/tmp`, health checks, log rotation and `unless-stopped`
restart policy. Access logs are not enabled, so document metadata and bearer
headers are not written by the gateway.

ORDA must use only:

- `GOTENBERG_URL` — `https://` gateway origin without a route suffix;
- `GOTENBERG_TOKEN` — the matching high-entropy bearer token.

Never publish Gotenberg port 3000 or send customer documents to a public
converter API.
