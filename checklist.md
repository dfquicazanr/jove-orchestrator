# Implementation checklist — 3D printing farm orchestrator

Tracks **v1** work against [`vision.md`](vision.md).

- `- [ ]` = not done
- `- [x]` = done

Work top-to-bottom within a section when possible. **Definition of done** for a v1 milestone: shipped items are `[x]`, smoke-tested in your environment, and the API image is rebuilt after backend changes (`docker compose build api && docker compose up -d api`).

---

## Phase 0 — Repository and standards

- [x] **Monorepo layout** — `backend/`, `frontend/`; documented in root `README.md`.
- [x] **Version control hygiene** — `.gitignore` for Python, Node, env files, uploads, IDE artifacts.
- [x] **Environment template** — Root `.env.example` and `frontend/.env.example` (`VITE_API_URL`).
- [x] **Code quality baseline** — Ruff (`backend/pyproject.toml`); ESLint + TypeScript (Vite 5).
- [x] **CI** — `.github/workflows/ci.yml` (Ruff + pytest, `npm ci` + build).

---

## v1 — Data layer (PostgreSQL)

- [x] **Migrations** — Alembic (`001_initial_schema`, `002_material_preheat_presets`).
- [x] **Database provisioning** — `docker-compose.yml` `db` service.
- [x] **Users** — `users`: username, password hash, `manager` | `viewer`, `is_active`.
- [x] **Printers** — Moonraker URL + API key, optional `ha_power_entity_id`, status/error cache, loaded filament fields.
- [x] **G-code files** — `gcode_files` with path, metadata, mass estimate, required material/color, copy count.
- [x] **Print queue** — `print_queue_items` with copy index, priority, assignment, status.
- [x] **Farm settings — material preheat presets** — `material_preheat_presets` (name, hotend/bed °C, sort order); defaults seeded in migration + `ensure_default_preheat_presets`.
- [x] **Indexes and constraints** — Unique username; preset names unique; FK indexes on queue.

---

## v1 — Backend API foundation (FastAPI)

- [x] **App factory / lifespan** — Upload dir, optional bootstrap admin, Moonraker watcher start/stop.
- [x] **Configuration** — `app/config.py`: DB, JWT, CORS, uploads, HA, log level, `moonraker_watch_enabled`.
- [x] **Logging** — `LOG_LEVEL` via basicConfig.
- [x] **Global error handling** — `422` validation shape; `X-Request-ID` middleware.
- [x] **Health** — `GET /health`, `GET /ready` (DB ping).

---

## v1 — Authentication and authorization

- [x] **Password hashing** — bcrypt.
- [x] **JWT** — Bearer token; `JWT_EXPIRE_MINUTES`.
- [x] **Login / me** — `POST /auth/login`, `GET /auth/me`.
- [x] **Logout** — Client discards token (stateless v1).
- [x] **Bootstrap admin** — `INITIAL_ADMIN_*` when no users exist.
- [x] **User management** — Manager-only `GET/POST /users`, deactivate, password reset.
- [x] **RBAC** — `require_manager`, `require_viewer_or_manager`, SSE auth for status stream.
- [x] **Viewer restrictions** — Mutations manager-only on routes.

---

## v1 — Moonraker integration

- [x] **HTTP client** — `httpx` with optional `X-Api-Key`; URL normalization (`moonraker_url.py`).
- [x] **Connection test** — `POST /printers/test-connection` (pre-save) and `POST /printers/{id}/moonraker/ping`.
- [x] **Live status (WebSocket → SSE)** — `moonraker_watch` subscribes to `print_stats` + `webhooks`; `GET /printers/status/stream` for UI.
- [x] **Status mapping** — `ready`, `printing`, `paused`, `finished_awaiting_cleanup`, `error`, `offline` from Klipper objects.
- [ ] **Powered off vs offline** — `powered_off` exists on the model; not inferred from HA/Moonraker yet.
- [x] **G-code upload to printer** — `POST /printers/{id}/gcode/print` (multipart → Moonraker `files/upload`, `print=true`).
- [x] **Print control** — `POST .../control/print/{pause|resume|cancel}`.
- [x] **Motion / heat scripts** — `POST .../control/home`, `preheat`, `cooldown` via `printer/gcode/script`.
- [ ] **Automatic job executor** — No worker that assigns queue items and starts prints on Moonraker.
- [ ] **Resilience** — Retries / circuit breaker not implemented.

---

## v1 — Home Assistant integration

- [x] **HA client** — REST `turn_on`/`turn_off` by entity domain; URL/token from Postgres (Farm UI) first, then `HOME_ASSISTANT_*` env.
- [x] **Farm HA settings UI** — `GET|PUT /settings/home-assistant`, optional `POST .../test`, Farm → Controls → **Home Assistant…** (singleton DB row).
- [x] **Per-printer power mapping** — `ha_power_entity_id`.
- [x] **Power API** — `POST /printers/{id}/power/on|off` (manager).
- [x] **Power in Farm UI** — Advanced **Controls** view shows On/Off when entity is configured.
- [ ] **Power state read** — Optional: set `powered_off` from HA entity state.

---

## v1 — Filament features

- [x] **Loaded filament API** — `PUT /printers/{id}/filament`, `PUT .../roll`.
- [x] **Manual corrections** — Same endpoints + `PATCH /printers/{id}`.
- [x] **G-code mass parse** — `gcode_parse.py` on library upload.
- [x] **Deduction on success** — `POST /queue/items/{id}/complete-success`.
- [x] **Planner filament checks** — Skips assignment when remaining &lt; estimate × waste factor.
- [x] **Farm UI** — Filament spiral, click-to-edit modal, material/color/weight together.

---

## v1 — G-code upload and queue (library)

- [x] **Library upload** — `POST /gcode/upload` with copies and optional requirements.
- [x] **Storage** — `GCODE_UPLOAD_DIR` (+ Docker volume).
- [x] **Queue expansion** — One `print_queue_items` row per copy.

---

## v1 — Print planning and queue

- [x] **Plan generation** — `POST /queue/plan` (greedy).
- [x] **Manual overrides** — `PATCH /queue/items/{id}`.
- [x] **Planner UI** — Upload G-code, waste-factor plan, editable assignments table.
- [ ] **Executor** — No background loop to dispatch assigned jobs.
- [x] **Cleanup state** — `finished_awaiting_cleanup` from Moonraker `print_stats.complete`.

---

## v1 — Frontend (React + Vite)

- [x] **Scaffold** — Vite 5 + React + TypeScript; `VITE_API_URL`.
- [x] **Routing** — Login; protected shell with **Farm** + **Queue**.
- [x] **Auth UX** — Login; JWT in `localStorage`.
- [x] **Role-aware Farm** — Manager: add/edit printers, controls, G-code send; viewer: read-only cards.
- [x] **Farm — Overview** — Status pills (human labels), live Moonraker dot, filament spiral, edit menu.
- [x] **Farm — Controls** — Home, material preheat (from presets), cooldown, print pause/resume/cancel (when printing/paused), HA power.
- [x] **Preheat presets UI** — **Preheat presets…** modal; `GET/PUT /settings/material-preheat`.
- [x] **Send G-code** — Per-printer upload from Farm (manager).
- [x] **Real-time status** — SSE merge on farm cards.
- [x] **Printer modals** — Connection (incl. test), filament, send G-code.
- [x] **Queue UI** — Upload, plan drafts, manual printer/priority/cancel (no auto-dispatch yet).
- [ ] **User admin UI** — API only (`/users`).
- [ ] **Accessibility pass** — Keyboard/contrast/breakpoints beyond baseline.

---

## v1 — Deployment and operations

- [x] **Dockerfile — backend** — Alembic + uvicorn on start.
- [ ] **Dockerfile — frontend** — Dev: `npm run dev`; prod static + nginx/CDN TBD.
- [x] **`docker-compose.yml`** — `db` + `api`; optional `docker-compose.tailscale.yml` notes.
- [x] **Networking** — CORS; LAN/Tailscale documented in `README.md`.
- [x] **Upgrade path** — `alembic upgrade head` in container CMD.
- [ ] **Backup / ops runbook** — Brief Postgres backup note in README.

---

## v1 — Testing and verification

- [x] **Backend unit tests (core)** — G-code parse, Moonraker URL/status/WS helpers, print upload sanitize, control scripts, preheat presets.
- [ ] **Backend integration tests** — Auth, RBAC, API + DB.
- [ ] **Manual QA doc** — `docs/manual-qa.md`.
- [x] **Dev seeds** — `backend/scripts/seed_printers.py` for demo statuses.

---

## Post-v1 / future

- [ ] **Distributed multi-site orchestrators** — See vision.
- [ ] **Advanced planner** — Time windows, color batching, maintenance.
- [ ] **SSO / OIDC**
- [ ] **Filament hardware** — Scales, RFID, tags.
- [ ] **Queue executor + full operator workflow** — Upload → plan → auto-start → complete → filament decrement without manual hooks.
- [ ] **Production frontend container** — nginx or CDN serve of `frontend/dist`.

---

## Progress snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Repo & tooling | Done | |
| Database | Done | Through migration `002` |
| Auth & RBAC | Done | |
| Moonraker | Mostly done | Live SSE, controls, direct print; no auto executor |
| Home Assistant | Mostly done | On/off API + UI; no state read |
| Filament | Done | API + planner + farm UI |
| Uploads & queue API | Done | Library upload; queue UI minimal |
| Farm dashboard | Done | Overview + Controls, presets, G-code send |
| Docker | In progress | API+DB; no `web` service |

---

*Last updated to match shipped farm controls, material preheat presets, paused status, and Moonraker live stream.*
