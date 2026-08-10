# Private Gotenberg for ORDA

This stack keeps LibreOffice conversion on an internal Docker network. Only
`gotenberg-gateway:3000` is reachable by other services on that private
network, and every request must provide `Authorization: Bearer <token>`.

Required runtime configuration for ORDA:

- `GOTENBERG_URL` — private gateway URL, without the conversion path.
- `GOTENBERG_TOKEN` — the same high-entropy token supplied to the gateway.

Do not publish either container port directly to the internet. The ORDA
application calls `POST /forms/libreoffice/convert`; customer documents never
leave the private service boundary.
