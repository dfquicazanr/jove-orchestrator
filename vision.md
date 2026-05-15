# 3D Printing Farm Orchestrator - Vision Document

## Overview

The project is a centralized 3D printing farm orchestrator designed to manage and coordinate multiple Klipper-based 3D printers through Moonraker APIs. The platform will provide a real-time dashboard showing the status of every printer in the farm, including states such as offline, powered off, idle/ready to print, printing, print finished but awaiting cleanup, and error conditions.

**Version 1 scope** includes automatic print planning (not a later phase), filament consumption tied to completed work, and simple local-account authentication.

## Core Features

### Printer Status Monitoring

The platform will track and display the real-time status of every printer in the farm, including:

- Offline
- Powered Off
- Ready to Print
- Printing
- Paused (print job paused on the machine)
- Print Finished (awaiting cleanup)
- Error State

The goal is to provide operators with a clear operational overview of the entire farm from a single interface.

**Shipped in the current codebase (early v1):** a **Farm** dashboard with an **Overview** mode (status, filament spiral, per-printer settings) and a **Controls** mode (home, preheat from configurable material presets, cooldown, pause/resume/cancel while a job is active, optional Home Assistant power). Live status is pushed from Moonraker via server-side WebSocket subscriptions and SSE. Managers can add printers, edit connection/filament, send G-code directly to a printer, and edit farm-wide preheat presets. The **Queue** API and greedy planner exist; the queue UI is still read-only.

---

### Filament Tracking

Each printer will maintain filament inventory for what is **currently loaded** on that machine. When an operator configures loaded filament for a printer, they set it as a single logical state that **must include**:

- Loaded filament material (PLA, PETG, ABS, TPU, etc.)
- Loaded filament color (free-text label chosen by the operator, e.g. “red”, “opaque black”, or a brand color name)
- Remaining filament weight on the spool

Color is not an afterthought: it is part of the same printer filament setup flow as material and weight, so the planner and UI always know what is on the machine.

**Automatic weight updates:** the platform will reduce remaining filament weight based on printed work (for example using per-job filament mass derived from G-code or upload metadata, applied when a print completes successfully). Operators can still correct totals manually when reality drifts (failed prints, purges, partial jobs, scale error).

Operators must also be able to:

- Update filament information manually
- Reset quantities when rolls are replaced
- Change loaded material, color, or weight when the physical loadout changes

This filament-awareness system is critical because the orchestrator will use it when generating print plans.

---

### Print Orchestration

Users will be able to:

1. Upload G-code files
2. Specify how many copies of each file should be printed
3. Generate suggested print plans automatically (**in v1** — the planner ships with the first release, not as a follow-on milestone)

The orchestrator will analyze:

- Printer availability
- Current printer states
- Loaded filament material
- Loaded filament color
- Remaining filament weight/capacity

The system should provide intelligent recommendations while still allowing full manual control by the operator.

Managers can:

- Reassign jobs
- Override printer selections
- Modify priorities
- Adjust filament configurations
- Update print plans manually

The philosophy of the platform is:
> Smart automation with human control.

---

## Authentication & Roles

The platform will support authentication and role-based permissions. **v1 uses simple local accounts** (usernames and passwords stored and verified by the application). There is no requirement for SSO or external identity providers in the first version; richer auth can be added later if needed.

### Manager Role
Managers will have permissions to:

- Create and modify print plans
- Upload files
- Control orchestration behavior
- Update printer configurations
- Update filament information
- Manage printers and farm settings

### View-Only Role
View-only users will only be able to:

- Monitor printer statuses
- View active jobs
- Observe farm activity

They will not be able to modify any system configuration.

---

## Integrations

### Moonraker Integration

The orchestrator will integrate directly with Moonraker APIs in order to:

- Monitor printer state
- Upload/manage print jobs
- Retrieve printer telemetry
- Track print progress
- Receive printer events/errors

Printers are expected to be reachable on the **local network** in typical deployments. Connection settings should be **per printer** and allow a configurable base URL (host, port, optional path prefix) and optional API keys so that **future** setups (reverse proxies, TLS, non-default paths) can be supported without a fundamental redesign.

### Home Assistant Integration

The platform must integrate with Home Assistant to allow:

- Remote printer power control
- Turning printers on/off automatically or manually
- Potential future automation workflows

Integration should be **generic**: each printer can reference the Home Assistant entities (or equivalent actions) used to power that device on and off. This maps well to common setups such as **ESPHome** switches or plugs exposed in Home Assistant, without hard-coding a specific vendor protocol in the orchestrator.

---

## Technical Stack

### Frontend
- React
- Vite

### Backend
- FastAPI (Python)

### Database
- PostgreSQL (preferred initial option)
- Final database choice may change based on scaling and operational requirements

### Deployment
- Docker containers
- Deployed alongside existing Klipper/Moonraker infrastructure

---

## Architecture Goals

The architecture should prioritize:

- Modularity
- Scalability
- Extensibility
- Reliability
- Simple deployment and maintenance

The system should be designed in a way that future integrations and orchestration features can be added without major rewrites.

---

## Agreed product decisions (conversation baseline)

The following summarizes decisions aligned with early implementation:

| Topic | Decision |
| --- | --- |
| Print planner | Shipped in **v1** alongside uploads, copies, and manual overrides. |
| Filament remaining | **Decremented from printed work** plus full **manual** edit and roll replacement resets. |
| Loaded filament UX | **Material + color + remaining weight** set together when configuring what is loaded on a printer. |
| Home Assistant | **Per-printer** HA references for power; works with ESPHome-backed switches and similar. |
| Moonraker connectivity | **LAN-first**; connection model stays **extensible** for proxies/TLS later. |
| Authentication | **Local accounts** only for v1; keep operational overhead low. |
| Farm operator UI | **Overview** (monitor + filament) and **Controls** (commands); preheat temps are **farm settings**, not hard-coded. |
| Live status | Moonraker WebSocket watcher → **SSE** to the browser; status includes **paused** as distinct from printing. |

Finer policies (exact job mass source, partial cancel handling, waste factors, planner matching rules for material/color strings) can be specified during implementation but should remain consistent with the rows above.

### Current v1 gaps (intentional next milestones)

- **Queue operator UI** — upload G-code to the library, run planner, dispatch jobs (API exists; UI does not).
- **Job executor** — background worker to start assigned queue items on printers without manual “send G-code.”
- **Powered off detection** — distinguish from offline using Home Assistant or printer power state.
- **Production frontend deploy** — static build behind nginx or CDN in compose.

---

## Future Vision: Distributed Orchestrators

A major future goal is supporting distributed orchestration across multiple physical locations.

The long-term architecture should allow:

- Multiple orchestrator instances
- Communication between orchestrators
- Centralized management across locations
- Coordination across different networks
- Shared visibility of printer farms

This future “swarm orchestrator” model will enable scaling beyond a single local network or workshop.

---

## Project Vision

The goal of the project is to create a smart, scalable, and operator-friendly production management platform for 3D printing farms.

The orchestrator should combine:

- Real-time monitoring
- Filament-aware scheduling
- Intelligent print planning
- Human-controlled orchestration
- Automation integrations
- Future multi-location scalability

The system should help operators maximize printer uptime, simplify production workflows, and efficiently coordinate large numbers of printers with minimal operational friction.
