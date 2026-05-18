# Infrastructure and deployment

How **Jove** runs in development and production: containers, data stores, networking, configuration, and schema migrations.

See also: [`README.md`](../README.md) (quick start), [`vision.md`](../vision.md) (product scope).

---

## Architecture (default stack)

```text
┌─────────────────┐     HTTP/SSE      ┌─────────────────┐
│  Browser        │ ◄──────────────► │  FastAPI (api)  │
│  Vite dev or    │                   │  + Moonraker   │
│  static build   │                   │    watcher     │
└─────────────────┘                   └────────┬────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
            ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
            │  PostgreSQL   │          │  G-code       │          │  Moonraker    │
            │  (db)         │          │  volume       │          │  (LAN / TS)   │
            └───────────────┘          └───────────────┘          └───────────────┘
                    │
                    │  optional
                    ▼
            ┌───────────────┐
            │  Home         │
            │  Assistant    │
            └───────────────┘
```

| Component | Technology | Notes |
| --- | --- | --- |
| API | FastAPI + Uvicorn | Runs Alembic on container start |
| Database | PostgreSQL 16 | Persistent volume `jove_pgdata` |
| Uploads | Docker volume `jove_uploads` | Mapped to `GCODE_UPLOAD_DIR` (`/app/data/uploads` in container) |
| Live status | Moonraker WebSocket → SSE | `GET /printers/status/stream` |
| Frontend (dev) | Vite on host | Not in default `docker-compose.yml` |
| Frontend (prod) | Static `frontend/dist` | Serve via nginx/Caddy/reverse proxy (TBD in compose) |

---

## Docker Compose

### Default: `docker-compose.yml`

| Service | Image / build | Ports | Volumes |
| --- | --- | --- | --- |
| `db` | `postgres:16-alpine` | `5432:5432` | `jove_pgdata` |
| `api` | `backend/Dockerfile` | `8000:8000` | `jove_uploads` → `/app/data/uploads` |

Start:

```bash
docker compose up --build -d
```

After **backend or migration changes**:

```bash
docker compose build api && docker compose up -d api
```

The API image command runs **`alembic upgrade head`** before Uvicorn starts.

### Tailscale overlay: `docker-compose.tailscale.yml`

When printer hostnames use **Tailscale MagicDNS** (e.g. `printer-name.tailnet`), the API container must resolve names via Tailscale DNS:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build api
```

This sets the API service DNS to `100.100.100.100` (Tailscale) plus `8.8.8.8`.

**Alternative:** run the API on the host (not in Docker) where Tailscale is already installed.

### What is not in default compose

- **Frontend production container** — operators typically run `npm run dev` locally or deploy `dist/` behind a web server.
- **Reverse proxy / TLS** — terminate HTTPS at nginx, Caddy, or Traefik in front of API + static UI.
- **Job executor worker** — no separate worker service yet; queue dispatch is manual or via planner commit to DB.

---

## Networking and reachability

| Path | Requirement |
| --- | --- |
| Browser → API | `CORS_ORIGINS` must include the UI origin (e.g. `http://localhost:5173`) |
| API → Postgres | `DATABASE_URL` host `db` inside compose, `localhost` when API runs on host |
| API → Moonraker | Each printer `moonraker_base_url` must be reachable **from the API process** (not only from the browser) |
| API → Home Assistant | `HOME_ASSISTANT_BASE_URL` env and/or credentials stored in DB via Settings UI |

Common pitfall: Moonraker works in the browser on the LAN but the API container cannot reach the printer IP. Fix Docker bridge routing, use host networking, or run API on the host.

---

## Configuration

Copy [`.env.example`](../.env.example) to `.env` at the repo root for local API runs. Docker Compose reads the same variables for the `api` service.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy URL for PostgreSQL |
| `JWT_SECRET_KEY` | Required in production; signs session tokens |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 7 days) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `GCODE_UPLOAD_DIR` | Filesystem path for uploaded `.gcode` files |
| `GCODE_MAX_UPLOAD_MB` | Upload size limit |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` | Bootstrap manager when DB has zero users |
| `HOME_ASSISTANT_BASE_URL` / `HOME_ASSISTANT_TOKEN` | Optional HA fallback (UI can store HA settings in DB) |
| `MOONRAKER_HTTP_LIVENESS_INTERVAL_SEC` | HTTP status poll when WebSocket is down (`0` = off) |

Frontend: copy [`frontend/.env.example`](../frontend/.env.example) → `frontend/.env`, set `VITE_API_URL` if API is not `http://localhost:8000`.

---

## Database migrations (Alembic)

Migrations live in `backend/alembic/versions/`. Apply with:

```bash
cd backend && alembic upgrade head
```

| Revision | Summary |
| --- | --- |
| `001_initial_schema` | Users, printers, gcode_files, print_queue_items |
| `002_material_preheat_presets` | Farm material preheat presets |
| `003_farm_ha` | Home Assistant settings row |
| `004_gcode_meta` | Library metadata fields |
| `005_materials_kits` | Material colors, print kits + kit line items |
| `006_gcode_display_color` | Display name, color preset FK on library files |
| `007_material_default_density` | `default_density_g_cm3` on materials (filament estimates) |
| `008_drop_gcode_total_copies` | Remove `total_copies_requested` from library files (quantities on kit lines only) |

**Fresh database:** `docker compose up` runs migrations automatically on API start.

**Backup:** back up the `jove_pgdata` volume and `jove_uploads` volume together for a consistent restore.

---

## Production checklist

1. Set a strong `JWT_SECRET_KEY` and change bootstrap admin password after first login.
2. Restrict Postgres and API ports (firewall / internal network only).
3. Use HTTPS for the UI and API; set `CORS_ORIGINS` to the real UI origin.
4. Protect `.env`, database backups, and HA tokens (DB-stored HA credentials are sensitive).
5. Rebuild and redeploy API after every pull that changes backend code or migrations.
6. Build frontend: `cd frontend && npm ci && npm run build`, serve `dist/` with cache-busting on deploy.
7. Ensure Moonraker URLs from the API container match your network layout (LAN vs Tailscale).

---

## CI

GitHub Actions (`.github/workflows/ci.yml`):

- Backend: Ruff + `pytest`
- Frontend: `npm ci` + `npm run build`

Python **3.12** in CI; Node **20+** recommended for frontend builds (Vite 5 pinned for broader Node compatibility).

---

## Health endpoints

| Endpoint | Use |
| --- | --- |
| `GET /health` | Liveness |
| `GET /ready` | Readiness (includes DB ping) |

Use these for orchestrator/load-balancer probes when deploying the API behind a proxy.
