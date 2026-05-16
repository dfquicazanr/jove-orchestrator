# Agent handoff — Jove (3D farm orchestrator)

This file is for **Cursor agents** (or other contributors) picking up work on this repo. Read **`vision.md`** (product intent), **`checklist.md`** (what’s done / not done), and root **`README.md`** (run instructions). Treat **`checklist.md`** as the source of truth for shipped vs pending; **`vision.md`** has a few lines that pre-date the latest queue UI and may be stale.

---

## What this project is

**Jove** orchestrates a **Klipper / Moonraker** print farm: live status, filament tracking, farm controls (home, preheat, print actions), G-code library + **greedy queue planner**, optional **Home Assistant** power. Stack: **FastAPI + PostgreSQL + Alembic** (backend), **React + Vite + TypeScript** (frontend).

---

## Repo layout

| Path | Role |
|------|------|
| `backend/app/` | FastAPI app: `main.py`, `config.py`, `api/routes/`, `models/`, `services/`, `schemas/` |
| `backend/alembic/` | Migrations (`001_initial_schema`, `002_material_preheat_presets`) |
| `backend/tests/` | `pytest` (Moonraker helpers, controls, gcode parse, etc.) |
| `backend/scripts/seed_printers.py` | Optional demo printers (RFC 5737 IPs) |
| `frontend/src/` | Pages, components, hooks, `api/client`, types |
| `.env.example`, `frontend/.env.example` | Env templates |
| `docker-compose.yml` | `db` (Postgres 16) + `api` |

---

## Run / develop

### Docker (API + DB)

```bash
docker compose up --build
# API: http://localhost:8000  ·  OpenAPI: /docs
```

After **any backend code or migration change**:

```bash
docker compose build api && docker compose up -d api
```

The API container runs **`alembic upgrade head`** on start (see `backend/Dockerfile`).

### Local dev (no API container)

1. `docker compose up -d db` (avoid port 5432 conflicts with a host Postgres).
2. Copy `.env` from `.env.example`; set `JWT_SECRET_KEY` and optionally `INITIAL_ADMIN_*`.
3. Backend: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && alembic upgrade head && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
4. Frontend: `cd frontend && npm install && npm run dev` — set `VITE_API_URL` if API isn’t `http://localhost:8000`.

### CI expectations

`.github/workflows/ci.yml`: **Ruff** + **pytest** in `backend/`, **`npm ci` + `npm run build`** in `frontend/`. Python **3.12** in CI.

---

## Configuration highlights (`backend/app/config.py`)

- **`database_url`** — Postgres (Docker default in compose: `postgresql+psycopg://jove:jove@db:5432/jove`).
- **`cors_origins`** — Comma-separated; must include the Vite origin in dev.
- **`gcode_upload_dir`**, **`gcode_max_upload_mb`** — Library uploads.
- **`home_assistant_base_url`**, **`home_assistant_token`** — Optional HA env fallback for `POST /printers/{id}/power/on|off`. Credentials can instead be saved in Postgres via **Farm → Controls → Home Assistant…** (`/settings/home-assistant`).
- **`moonraker_watch_enabled`** — If `True` (default), lifespan starts **`moonraker_watch`** (WebSocket → SSE). Set `False` only for debugging without watchers.

Env vars use **lowercase with underscores** matching Settings fields (see Pydantic settings).

---

## Auth & roles

- JWT **Bearer** token; login `POST /auth/login`, `GET /auth/me`.
- **`manager`**: mutations (printers, queue, gcode upload, controls, users API).
- **`viewer`**: read-only where enforced (`require_viewer_or_manager` vs `require_manager`).
- **SSE** (`GET /printers/status/stream`): `get_current_user_for_sse` — token via query `access_token` (see `frontend/src/hooks/usePrinterStatusStream.ts`).

---

## Moonraker integration (critical paths)

| Piece | Location | Notes |
|-------|-----------|--------|
| HTTP helper | `backend/app/services/moonraker.py` | `moonraker_get_json`, `ping_moonraker_at`, **`derive_printer_status_from_status`** |
| URL normalize | `backend/app/services/moonraker_url.py` | |
| Live watcher | `backend/app/services/moonraker_watch.py` | Per-printer WS → `_publish` → SSE + throttled DB persist |
| Controls / print | `moonraker_control.py`, `moonraker_print.py` | |

### Status derivation (do not regress)

**`webhooks` is evaluated before `print_stats`.** Moonraker can leave `print_stats.state` as `standby` while `webhooks.state` is `shutdown`; checking `print_stats` first used to show false **ready**. Tests: `backend/tests/test_moonraker_status.py`, `test_moonraker_ws_helpers.py`.

### Live stream vs DB vs manual Sync

- **`GET /printers`** returns DB-backed fields.
- Farm UI **merges** `GET /printers/status/stream` updates over the list (`frontend/src/lib/mergePrinterLive.ts`). If SSE is stale, the UI can look wrong even when DB is right.
- **`POST /printers/{id}/moonraker/ping`** (Sync) updates the DB **and** calls **`moonraker_watch.broadcast_printer_state(..., persist=False)`** so SSE clients get the same snapshot (see `printers.py`).

### WebSocket reconnect behavior (`moonraker_watch.py`)

- **Backoff increases only on connection/session errors**, not after every clean session end (avoids multi-minute delays after several power cycles).
- **Clean WebSocket close** publishes **offline** once, then reconnects after a short sleep.

### Docker ↔ printers

From inside the **API container**, printer `moonraker_base_url` must be reachable (LAN IP, host gateway, or Tailscale per ops). If the browser can open Moonraker but Jove cannot, fix **Docker networking**, not Moonraker.

---

## Queue & planner

- **Upload**: `POST /gcode/upload` — metadata JSON: `copies`, `required_material`, `required_color`; creates `gcode_files` + one **`draft`** `print_queue_items` row per copy.
- **List / plan**: `GET /queue/items` (optional `status_filter`), `POST /queue/plan` with `waste_factor` (1.0–2.0; UI sends **percent headroom** converted to multiplier).
- **Patch**: `PATCH /queue/items/{id}` — assignment, priority, status.
- **Planner logic**: `backend/app/services/planner.py` — greedy; only assigns printers in **ready** / **finished_awaiting_cleanup** with matching material/color and filament ≥ estimate × waste factor.
- **Filament deduct (hook)**: `POST /queue/items/{id}/complete-success`.
- **Not implemented**: background **job executor** (auto-dispatch queued jobs to Moonraker) — major next step.

Frontend queue: `frontend/src/pages/QueuePage.tsx`, `GcodeUploadPanel` (multi-file batch, per-file copies), `QueueItemsTable`, `InfoTooltip` for safety margin, `lib/filamentSafetyMargin.ts` (percent ↔ API).

---

## Farm UI (frontend)

- **`FarmPage.tsx`**: Overview vs Controls (`farmViewMode.ts`), `usePrinterStatusStream`, merge live status, modals (connection, filament, send G-code, preheat presets).
- **`PrinterFarmCard.tsx`**: Status pills, `moonrakerLive` CSS hint when SSE connected.
- **Mock mode**: `?mockPrinters=1` or `VITE_MOCK_PRINTERS` — disables real API usage for farm list/stream (see `mockPrintersMode.ts`).

---

## Database models (high level)

- **`User`**, **`Printer`** (`PrinterStatus` enum string values — used in API and UI pills).
- **`GCodeFile`**, **`PrintQueueItem`** (`PrintQueueStatus`).
- **`MaterialPreheatPreset`** — farm-wide preheat rows; `GET/PUT /settings/material-preheat`.

---

## Known gaps / next milestones (from `checklist.md`)

- **Queue executor** — poll or worker to move **queued** → Moonraker print start, handle completion → `complete-success` (or equivalent).
- **`powered_off` / HA state read** — model field exists; not fully wired from HA entity state.
- **Production frontend** in Docker (only API+DB in default compose).
- **Integration tests**, Ruff cleanup (B008 on `Depends` is noisy in places).
- **User admin UI** — API exists; no SPA screens.

---

## User / workflow conventions (from project rules)

- **Do not create git commits or push** unless the user explicitly asks.
- For **GitHub PRs**, use **`gh`** per user rule (parallel `git status` / `diff` / `log`, HEREDOC body).
- Prefer **minimal diffs**; match existing style; don’t add unsolicited markdown/docs (this file was **explicitly requested**).

---

## Quick file index (debugging)

| Topic | Files |
|-------|--------|
| App entry, lifespan, CORS | `backend/app/main.py` |
| Printer routes, SSE, ping broadcast | `backend/app/api/routes/printers.py` |
| Queue routes | `backend/app/api/routes/queue.py` |
| G-code upload | `backend/app/api/routes/gcode.py` |
| Moonraker status mapping | `backend/app/services/moonraker.py` |
| WS watcher | `backend/app/services/moonraker_watch.py` |
| Planner | `backend/app/services/planner.py` |
| Farm + queue pages | `frontend/src/pages/FarmPage.tsx`, `QueuePage.tsx` |
| SSE client | `frontend/src/hooks/usePrinterStatusStream.ts` |

---

## Suggested next tasks (if none specified)

1. **Queue executor** — durable loop, idempotency, Moonraker errors, UI row actions for “start”.
2. **HA `powered_off`** — read switch entity state on interval or webhook.
3. **Production `frontend` service** — static build + nginx or Caddy in compose.
4. **Integration tests** for auth + critical routes.

---

*Handoff written for continuity across Cursor sessions; update this file when architecture or ops assumptions change materially.*
