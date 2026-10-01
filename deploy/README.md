# Production deployment

The two source repositories are cloned at `/srv/lease-sys/lease-sys-be` and
`/srv/lease-sys/lease-sys-fe`. Compose runs three containers: `db`, `api`, and
`web`. Only `web` publishes a port, bound to `127.0.0.1:18080` for the existing
host Nginx installation to proxy a dedicated HTTPS hostname to it. The web
container uses Caddy for static assets and `/api/` routing within Compose.

Runtime configuration stays outside Git:

- `/srv/lease-sys/config/stack.env`: `POSTGRES_PASSWORD`
- `/srv/lease-sys/config/api.env`: `DATABASE_URL`, `JWT_SECRET`, `APP_ORIGIN`,
  `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3001`, and
  `UPLOAD_DIR=/data/uploads`; SMTP settings are optional
- `/srv/lease-sys/config/versions.env`: deployed `API_IMAGE` and `WEB_IMAGE`
- `/srv/lease-sys/config/bootstrap.secret`: optional one-time initial admin
  password (12+ characters); removed after the first successful initialization

`data/postgres` and `data/uploads` must persist across container recreations.
Back up both, and keep a copy off the host. The API image includes the Prisma
CLI and Chromium. `deploy.sh` applies `prisma migrate deploy` before replacing
the API container. It intentionally never runs the development seed in
production.

GitHub Actions builds each image on pushes to `master`, stores it in GHCR under
the commit SHA, and streams a compressed release archive containing a Git bundle
and the image over SSH to the root-owned `/usr/local/sbin/lease-sys-deploy`
wrapper. GitHub credentials stay inside the Actions runner; the host does not
need outbound access to GitHub or GHCR. The wrapper
uses a host-wide lock so the two repository workflows cannot deploy at once.
For manual rollback, restore a previous image reference in `versions.env` and
recreate the affected service; database migrations require separate review.

The existing host Nginx must route the production hostname to
`http://127.0.0.1:18080`. Its HTTPS certificate is managed on the host, where
port 80 is already in use. Configure `APP_ORIGIN` to that exact HTTPS origin.
Production login cookies are secure and require HTTPS.
