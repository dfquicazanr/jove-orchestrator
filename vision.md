# Jove — Product vision

**Jove** is a centralized orchestrator for a **Klipper / Moonraker** print farm. It gives operators one place to see printer health, manage filament, control printers, maintain a G-code library, build print kits, and plan multi-printer schedules with material-aware assignment.

---

## Goals

1. **Single pane of glass** — Live farm status (SSE), per-printer controls, filament tracking, optional Home Assistant power.
2. **G-code library** — Upload, parse metadata, edit display fields, reconcile filament mass/length from material density when the slicer omits values.
3. **Print kits** — Named bundles of library files; **quantity per line item** (not per-file default copies on the library record).
4. **Smart planning** — Session-based planner: add files/kits, set material/color requirements, preview **makespan-optimized** assignment, commit to the farm queue.
5. **Visibility** — Dashboard timeline of jobs across printers; session summary (jobs, time, filament estimates, material breakdown).
6. **Safe operations** — Role-based access; managers mutate, viewers read; Moonraker status derived with webhook-first rules to avoid false “ready”.

---

## Users and roles

| Role | Capabilities |
| --- | --- |
| **Viewer** | Farm, dashboard, library (read), materials list (read) |
| **Manager** | Everything viewers have, plus: library upload/edit, kits, planner, settings, printer CRUD, controls, queue mutations |

Authentication: JWT login; bootstrap admin from env when the database has no users.

---

## Core workflows

### Farm

- Printer cards with live status merged from SSE over DB snapshots.
- Controls: home, preheat (farm material presets), cooldown, pause/resume/cancel, send G-code, filament/roll edits, Moonraker sync, HA power on/off.
- Material preheat presets edited under **Materials** (manager).

### G-code library

- Upload `.gcode` (and variants); server parses filename/header metadata.
- Per-file: display name, material/color preset, notes; **Weight** and **Length** columns with reconciliation from preset **density (g/cm³)** when mass or length is missing.
- Parser debug accordion shows source lines matched in the file (manager troubleshooting).
- **No default copy count** on library files — quantities belong on **kit line items** or planner session rows.

### Print kits

- Define kits as ordered lists of library files with **quantity** per line.
- Planner can add a whole kit into a session in one action.

### Planner

- Build a **session** of jobs (files or kits) before touching the live queue.
- Per row: material requirement, color (including **Any** when the file has no embedded color), safety margin.
- **Optimize** runs greedy assignment with **constrained jobs first** (specific material/color before flexible rows), then by duration for makespan.
- **Preview** and **commit** write `print_queue_items` to the database.
- Session summary strip: job count, total print time, filament estimate, material breakdown.
- `/queue` redirects to `/planner` (legacy path).

### Dashboard

- Cross-printer **timeline** of queue items (queued, printing, etc.) for at-a-glance farm load.

---

## Integrations

| System | Usage |
| --- | --- |
| **Moonraker** | HTTP + WebSocket for status, controls, print start |
| **PostgreSQL** | Printers, users, library, queue, kits, materials, HA settings |
| **Home Assistant** | Optional printer power on/off; credentials in env or DB |
| **Tailscale** | Optional MagicDNS for API→printer reachability from Docker (see [`docs/infrastructure.md`](docs/infrastructure.md)) |

---

## Agreed product decisions

- **Filament estimates:** Prefer slicer-reported mass/length; fill gaps using material **default density**, not a hardcoded g/m fallback.
- **Color default in planner:** Files without slicer color default to **Any**, not the first swatch on a material preset.
- **Assignment order:** Jobs with fixed material/color are assigned before “flexible” jobs so parallel makespan uses the right printers (e.g. CE5P + PLA/Any → constrained printer).
- **Quantities:** Only on kit lines and planner/queue items, not stored as `total_copies_requested` on `gcode_files`.
- **Duration display:** Human-readable `Xh Ym` in the UI.

---

## Out of scope / not yet built

- **Automatic queue executor** — Background worker to dispatch queued jobs to Moonraker and call completion hooks.
- **`powered_off` from HA entity state** — Model exists; not fully driven by HA reads.
- **Production frontend in Docker** — Default compose is API + Postgres only.
- **User admin SPA** — API exists; no management UI.
- **Full MES / ERP** — Jove is farm orchestration, not order management.

---

## Success criteria (v1)

- Operators can run a multi-printer plan from library/kits through commit without SSH.
- Live farm status matches Moonraker within SSE latency; sync fixes drift.
- Material/color constraints are respected in planner preview and commit.
- Documentation (`vision.md`, `checklist.md`, `docs/`) stays aligned with shipped behavior.
