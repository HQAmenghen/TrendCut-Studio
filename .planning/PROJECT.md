# TrendCut Studio（热点剪辑工作室）

## What This Is

TrendCut Studio is a local automated hotspot video clipping and publishing workflow for turning source material into reviewable and publishable short-form videos. It combines hotspot discovery, material-driven editing, digital avatar narration, AI review, publishing automation, account monitoring, and system operations in one Node.js + Vue + Python workspace used by operators on a trusted machine.

This initialization is for brownfield stabilization work. The product already exists; the current goal is to harden the existing workflows so operators can run them safely, recover from failures predictably, and maintain the codebase without introducing brittle regressions.

## Core Value

Operators can reliably turn hotspots and source material into edited, reviewed, and publishable short-form videos from one console without unsafe failure modes or fragile manual recovery.

## Requirements

### Validated

- ✓ Operator can import local material or xAI discovery results into the material-driven workflow — existing
- ✓ Operator can run the material-driven generation pipeline and inspect generated plans, logs, and outputs — existing
- ✓ Operator can review generated videos, record review outcomes, and trigger regenerate flows — existing
- ✓ Operator can create publish tasks and run the current WeChat publishing automation flow — existing
- ✓ Operator can monitor account/system status and edit runtime settings from the console — existing

### Active

- [ ] Harden administrative API access, secret handling, and managed-path enforcement across existing workflows
- [ ] Stabilize task lifecycle, recovery behavior, and diagnostic reporting for generation, review, and publish flows
- [ ] Separate runtime artifacts from source-tracked code paths and make cleanup/storage boundaries predictable
- [ ] Add regression coverage around the highest-risk Node, frontend, and Python entry points
- [ ] Decouple the most fragile orchestration modules so stability fixes are smaller and safer to ship

### Out of Scope

- New end-user product surfaces or entirely new workflow modules — this cycle is for stabilization, not feature expansion
- Multi-tenant SaaS or collaborative operator accounts — current scope stays local-first and operator-centric
- Full pipeline redesign away from the material-driven workflow — the existing production path remains the system anchor
- Large model/provider expansion beyond what is required to keep current flows working — provider churn is not the priority

## Context

The codebase is already a brownfield system with a mapped architecture in `.planning/codebase/`. The main business chain is `热点发现 -> 素材驱动视频制作剪辑 -> AI 审核 -> 发布任务 -> 账号监控/系统运维`, with `frontend/src/components/AutomationDashboard.vue`, `server/routes/materialDriven.js`, and `python/pipeline/run_material_driven.py` acting as the primary workflow spine.

Current concerns are concentrated in five areas: unauthenticated administrative APIs, plaintext secret handling, client-controlled filesystem paths, unbounded task/runtime state, and low automated coverage for the highest-risk orchestration code. The repo also mixes source code with runtime databases, generated outputs, and project artifacts, which increases review noise and operational risk.

Existing documentation already captures the current product shape and runtime boundaries in `README.md`, `docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md`, `docs/MATERIAL_DRIVEN_WORKFLOW.md`, and `docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md`. This project initialization treats those as brownfield context rather than a greenfield product brief.

## Constraints

- **Architecture**: Keep the existing `Node.js + Vue + Python` local-control-panel architecture — the product already depends on that split
- **Workflow anchor**: Keep the material-driven workflow as the primary production path — it is the current core operator flow
- **Compatibility**: Preserve existing operator-facing capabilities while hardening internals — stabilization must not break the shipped flow set
- **External dependencies**: ComfyUI, LLM providers, FFmpeg, and WeChat RPA remain external runtime dependencies — the system must tolerate their absence or failure cleanly
- **Operational scope**: Prioritize safety, predictability, and maintainability over new features — this cycle is explicitly stabilization work
- **Version control**: Planning documents should be tracked in git, while mutable runtime outputs should move away from source-tracked defaults — the repo needs cleaner boundaries

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat this initialization as brownfield stabilization, not new-product ideation | The existing system already ships meaningful operator workflows; the immediate need is reliability and safety | — Pending |
| Use the current codebase map as the source of validated capabilities | Existing code already defines what is shipped and must be preserved | — Pending |
| Skip domain research for initialization | The work is focused on hardening an existing internal product, not discovering a new market/problem space | — Pending |
| Plan in standard granularity with documents committed to git | The codebase has enough risk areas to justify a multi-phase roadmap and durable planning history | — Pending |
| Keep verification-oriented workflow settings enabled, but disable pre-planning research by default | Stabilization benefits more from checks and coverage than from broad external research | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-17 after initialization*
