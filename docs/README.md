# Documentation

| Document | Audience | Contents |
| --- | --- | --- |
| [`../vision.md`](../vision.md) | Product / stakeholders | Goals, roles, integrations, agreed decisions |
| [`../checklist.md`](../checklist.md) | Engineering | Implementation status and milestones |
| [`infrastructure.md`](infrastructure.md) | Ops / DevOps | Docker, networking, env, migrations, deploy |
| [`../README.md`](../README.md) | Everyone | Quick start, repo layout, links |
| [`../AGENT_HANDOFF.md`](../AGENT_HANDOFF.md) | Contributors / agents | Architecture map, debugging index |

## Operator UI routes (frontend)

| Path | Role | Purpose |
| --- | --- | --- |
| `/` | All | **Farm** — printer cards, controls, live SSE status |
| `/dashboard` | All | **Dashboard** — timeline of queued/printing jobs across printers |
| `/library` | All (upload: manager) | **G-code library** — upload, metadata, filament estimates |
| `/materials` | Manager | Material preheat presets, colors, default density (g/cm³) |
| `/kits` | Manager | **Print kits** — named file bundles with per-line quantity |
| `/planner` | Manager | **Planner** — session, makespan optimize, commit to farm queue |
| `/settings` | Manager | Farm settings (e.g. Home Assistant) |
| `/login` | — | Authentication |

Legacy `/queue` redirects to `/planner`.

## API surface (backend)

OpenAPI: `http://localhost:8000/docs` when the API is running.

Prefixes: `/health`, `/auth`, `/users`, `/printers`, `/gcode`, `/queue`, `/kits`, `/settings`.
