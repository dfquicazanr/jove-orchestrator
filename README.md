# Jove — 3D printing farm orchestrator

Centralized orchestration for **Klipper / Moonraker** farms: live status, filament tracking, farm controls, G-code library, print kits, makespan-aware planner, dashboard timeline, and optional Home Assistant power.

| Document | Description |
| --- | --- |
| [`vision.md`](vision.md) | Product goals, workflows, and decisions |
| [`checklist.md`](checklist.md) | Implementation status and milestones |
| [`docs/README.md`](docs/README.md) | Doc index and UI route map |
| [`docs/infrastructure.md`](docs/infrastructure.md) | Docker, networking, env, migrations, production |
| [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md) | Contributor / agent architecture notes |

### Operator UI (current)

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | All | **Farm** — printer cards, controls, live SSE |
| `/dashboard` | All | **Dashboard** — cross-printer job timeline |
| `/library` | All (upload: manager) | **G-code library** — metadata, filament estimates, parser debug |
| `/materials` | Manager | Preheat presets, colors, density (g/cm³) |
| `/kits` | Manager | **Print kits** — file bundles with per-line quantity |
| `/planner` | Manager | **Planner** — session, optimize, commit to queue |
| `/settings` | Manager | Farm settings (e.g. Home Assistant) |

`/queue` redirects to `/planner`.

After pulling backend changes, rebuild the API image so routes and migrations apply:

```bash
docker compose build api && docker compose up -d api
```

## Repo layout

| Path | Purpose |
| --- | --- |
| `backend/` | FastAPI app, SQLAlchemy models, Alembic migrations |
| `frontend/` | React + Vite operator UI |
| `docs/` | Infrastructure and documentation index |
| `docker-compose.yml` | Postgres + API |
| `docker-compose.tailscale.yml` | Optional MagicDNS for API → printers |

## Quick start (development)

1. **PostgreSQL (Docker)** — From the repo root:

   ```bash
   docker compose up -d db
   ```

   Default URL in `.env.example` is `postgresql+psycopg://jove:jove@localhost:5432/jove`, which matches this service.

   **Do not run a second Postgres on port 5432** (for example Ubuntu’s `postgresql.service` **and** this container). Only one listener can use the port. If you previously installed native Postgres, stop it while using Docker:

   ```bash
   sudo systemctl stop postgresql
   # optional: prevent it from starting on boot
   sudo systemctl disable postgresql
   ```

   Then ensure the container is up: `docker compose up -d db`.

2. **Environment** — Copy `.env.example` to `.env` and set `JWT_SECRET_KEY` (and optionally `INITIAL_ADMIN_*` for first manager).

3. **Backend**

   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -e ".[dev]"
   alembic upgrade head
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

   On Debian/Ubuntu you may need `sudo apt install python3.12-venv` (or your distro’s equivalent) before `python -m venv`.

4. **Frontend** — Node **20.19+** or **22.12+** matches current upstream Vite; this repo pins **Vite 5** so **Node 20.18** can still run `npm run build`.

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Open the Vite URL (default `http://localhost:5173`). Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` if the API is not at `http://localhost:8000`.

## Docker (API + Postgres)

From repo root (set `JWT_SECRET_KEY` in production):

```bash
docker compose up --build
```

API: `http://localhost:8000` · OpenAPI: `http://localhost:8000/docs`

Printers on **Tailscale MagicDNS** from inside the API container:

```bash
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build api
```

See [`docs/infrastructure.md`](docs/infrastructure.md) for volumes, migrations (`001`–`008`), health checks, and production checklist.

## Security notes (v1)

- Moonraker API keys and HA tokens are sensitive; keep them in `.env` or your secrets manager.
- Change bootstrap admin password immediately after first login in production.
- HA credentials saved via the UI are stored in Postgres — protect database backups.
