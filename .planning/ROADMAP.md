# Roadmap: TrendCut Studio

## Overview

This roadmap hardens the existing hotspot video clipping operator console without changing its product identity. The sequence moves from immediate safety fixes, to workflow reliability, to runtime boundary cleanup, to regression coverage, and finally to modularizing the most fragile orchestration code once guardrails are in place.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security Boundary Hardening** - Remove the highest-risk API, secret, and filesystem exposure gaps
- [ ] **Phase 2: Workflow Reliability And Recovery** - Make generation, review, and publish flows fail and recover predictably
- [ ] **Phase 3: Runtime Artifact Discipline** - Separate mutable runtime state from source-tracked code paths
- [ ] **Phase 4: Regression Coverage Expansion** - Add automated coverage around the highest-risk Node, frontend, and Python paths
- [ ] **Phase 5: Fragile Flow Decoupling** - Split the most brittle orchestration modules behind tested service boundaries

## Phase Details

### Phase 1: Security Boundary Hardening
**Goal**: Close the most serious administrative API, secret handling, and path validation gaps without breaking existing operator workflows.
**Depends on**: Nothing (first phase)
**Requirements**: [SEC-01, SEC-02, SEC-03, SEC-04]
**Success Criteria** (what must be TRUE):
  1. Operator-facing config APIs no longer return raw stored secrets after save or read-back.
  2. Administrative write routes are restricted by explicit local-only binding or authentication/authorization controls.
  3. Review, publish, and workflow requests reject unmanaged or traversed filesystem paths before disk mutation.
  4. Managed asset boundaries are documented and enforced consistently across the affected routes.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Harden secret serialization and config read/write contracts across publish and system settings
- [ ] 01-02: Add access-control enforcement for administrative write endpoints and unsafe exposure defaults
- [ ] 01-03: Normalize managed asset IDs and path-root validation across review, publish, and material-driven routes

### Phase 2: Workflow Reliability And Recovery
**Goal**: Make long-running workflows bound their state, preserve recoverable context, and surface actionable diagnostics.
**Depends on**: Phase 1
**Requirements**: [REL-01, REL-02, REL-03, REL-04]
**Success Criteria** (what must be TRUE):
  1. Completed and failed material-driven jobs do not accumulate indefinitely in process memory.
  2. Operators see consistent stage/code/hint diagnostics for generation, review, and publish failures.
  3. Restarting the Node service preserves recoverable workflow state without duplicate active-task records.
  4. Temp files, logs, and stale runtime entries follow explicit retention or cleanup rules.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Bound task lifecycle and recovery state for material-driven workflows
- [ ] 02-02: Standardize failure contracts across generation, review, and publish orchestration
- [ ] 02-03: Define and implement retention/cleanup behavior for stale runtime entries and temp files

### Phase 3: Runtime Artifact Discipline
**Goal**: Move mutable runtime state behind documented storage roots and make cleanup safe for operators.
**Depends on**: Phase 2
**Requirements**: [OPS-01, OPS-02, OPS-03]
**Success Criteria** (what must be TRUE):
  1. Generated media, databases, and caches live under documented runtime roots that are ignored from source control by default.
  2. Operators have a bounded cleanup path that removes stale runtime artifacts without damaging required fixtures or source assets.
  3. Startup/self-check warns when runtime dependencies or storage layout are unsafe for execution.
**Plans**: 2 plans

Plans:
- [ ] 03-01: Consolidate runtime storage roots and gitignore/runtime-boundary policy
- [ ] 03-02: Add cleanup and self-check coverage for runtime storage safety

### Phase 4: Regression Coverage Expansion
**Goal**: Put high-risk routes, composables, and Python entry points under automated checks before deeper refactors.
**Depends on**: Phase 3
**Requirements**: [QLT-01, QLT-02, QLT-03]
**Success Criteria** (what must be TRUE):
  1. High-risk write APIs have regression tests for main success and failure paths.
  2. Critical frontend workflow state transitions are covered by contract tests.
  3. Python entry scripts for generation, review, and publish flows have repeatable smoke coverage in CI.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Add Node regression coverage for material-driven, review, publish, and system-setting write paths
- [ ] 04-02: Add frontend contract coverage for critical operator workflows
- [ ] 04-03: Add Python smoke coverage and CI wiring for high-risk entry scripts

### Phase 5: Fragile Flow Decoupling
**Goal**: Refactor the most brittle orchestration modules behind testable, smaller service boundaries.
**Depends on**: Phase 4
**Requirements**: [ARC-01, ARC-02]
**Success Criteria** (what must be TRUE):
  1. Material-driven route wiring, task lifecycle, and subprocess coordination can change independently.
  2. Publish, review, and system secret-handling logic is isolated from transport and persistence shaping.
  3. Stability fixes in the hot paths require smaller, more focused code changes than before the phase started.
**Plans**: 2 plans

Plans:
- [ ] 05-01: Split material-driven orchestration into smaller route/service/task-lifecycle units
- [ ] 05-02: Split publish/review/system handlers into focused secret, persistence, and transport layers

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Boundary Hardening | 0/3 | Not started | - |
| 2. Workflow Reliability And Recovery | 0/3 | Not started | - |
| 3. Runtime Artifact Discipline | 0/2 | Not started | - |
| 4. Regression Coverage Expansion | 0/3 | Not started | - |
| 5. Fragile Flow Decoupling | 0/2 | Not started | - |
