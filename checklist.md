# Implementation checklist

Track what is **shipped** vs **pending** for Jove. For product intent see [`vision.md`](vision.md); for deploy and migrations see [`docs/infrastructure.md`](docs/infrastructure.md).

**Legend:** ✅ Done · 🟡 Partial · ⬜ Not started

---

## Progress snapshot

| Area | Status |
| --- | --- |
| Auth (JWT, roles, bootstrap admin) | ✅ |
| Printers CRUD + Moonraker ping/sync | ✅ |
| Live status (WS watcher → SSE) | ✅ |
| Farm UI (cards, controls, filament, G-code print) | ✅ |
| Material preheat presets | ✅ |
| Home Assistant power + settings API/UI | ✅ |
| G-code library + upload + metadata | ✅ |
| Material colors + default density | ✅ |
| Print kits (API + UI) | ✅ |
| Planner session + optimize preview + commit | ✅ |
| Dashboard timeline | ✅ |
| Queue executor (auto-dispatch) | ⬜ |
| Production frontend in compose | ⬜ |
| User admin UI | ⬜ |

---

## Database / migrations

| Migration | ✅ | Notes |
| --- | --- | --- |
| `001_initial_schema` | ✅ | Users, printers, gcode_files, print_queue_items |
| `002_material_preheat_presets` | ✅ | |
| `003_farm_ha` | ✅ | HA settings in Postgres |
| `004_gcode_meta` | ✅ | Library metadata columns |
| `005_materials_kits` | ✅ | Colors, print_kits, kit_line_items |
| `006_gcode_display_color` | ✅ | display_name, color preset FK |
| `007_material_default_density` | ✅ | Filament reconcile from density |
| `008_drop_gcode_total_copies` | ✅ | Copies only on kits / queue items |

---

## Backend API

| Feature | ✅ | Notes |
| --- | --- | --- |
| `/auth/login`, `/auth/me` | ✅ | |
| `/users` CRUD (manager) | ✅ | No SPA admin |
| `/printers` + SSE stream | ✅ | |
| Moonraker controls + print G-code | ✅ | |
| `/gcode` upload, list, patch, delete | ✅ | No per-file copy count (008) |
| `/kits` CRUD | ✅ | Line quantities |
| `/queue/items`, timeline | ✅ | |
| `/queue/plan/preview`, `/plan`, `/plan/commit` | ✅ | Greedy + constrained-first sort |
| `/queue/items/{id}/complete-success` | ✅ | Filament deduct hook |
| Filament reconcile service | ✅ | `filament_estimate.py` + tests |
| Planner constrained-first assignment | ✅ | Material/color before flexible jobs |

---

## Frontend

| Page / feature | ✅ | Notes |
| --- | --- | --- |
| Login + protected routes | ✅ | |
| Farm (`/`) | ✅ | Overview + controls, SSE merge |
| Dashboard (`/dashboard`) | ✅ | Print timeline |
| Library (`/library`) | ✅ | Weight/Length (g), parser debug accordion |
| Materials (`/materials`) | ✅ | Preheat + density |
| Kits (`/kits`) | ✅ | Per-line quantity |
| Planner (`/planner`) | ✅ | Material/Color columns, session summary, `formatPrintTime` |
| Settings (`/settings`) | ✅ | HA + farm settings |
| Queue page | ✅ | Redirects to planner |
| G-code upload on library only | ✅ | `enqueue` path for queue-only upload if used |
| Mock printers mode | ✅ | `?mockPrinters=1` |

---

## Planner / queue (behavior)

| Item | ✅ | Notes |
| --- | --- | --- |
| Session state (add/remove/duplicate rows) | ✅ | |
| Default color **Any** when file has no color | ✅ | |
| Safety margin % → API waste factor | ✅ | |
| Optimize preview (uncommitted) | ✅ | |
| Commit to DB queue items | ✅ | |
| Session totals (time, filament, materials) | ✅ | |
| Auto-start prints from queue | ⬜ | **Executor not built** |
| Row-level dispatch UI on farm | ⬜ | Depends on executor |

---

## Integrations & ops

| Item | ✅ | Notes |
| --- | --- | --- |
| Docker Compose (db + api) | ✅ | |
| Alembic on API container start | ✅ | |
| Tailscale compose overlay | ✅ | `docker-compose.tailscale.yml` |
| `docs/infrastructure.md` | ✅ | |
| CI (Ruff, pytest, frontend build) | ✅ | |
| Frontend production service in compose | ⬜ | |
| HA read for `powered_off` | ⬜ | Power on/off works |

---

## Testing

| Area | ✅ | Notes |
| --- | --- | --- |
| Moonraker status derivation | ✅ | Webhook before print_stats |
| G-code parse helpers | ✅ | |
| Filament estimate reconcile | ✅ | |
| Planner assignment tests | 🟡 | Extend as rules grow |
| E2E / integration (auth + routes) | ⬜ | |

---

## Suggested next milestones

1. **Queue executor** — Poll or worker: `queued` → Moonraker print start → completion → `complete-success`.
2. **HA powered_off** — Subscribe or poll switch entity per printer.
3. **Production frontend** — `frontend` service in compose or documented nginx snippet.
4. **User admin UI** — Wrap existing `/users` API.

---

*Update this file when shipping features or migrations so `AGENT_HANDOFF.md` and agents stay accurate.*
