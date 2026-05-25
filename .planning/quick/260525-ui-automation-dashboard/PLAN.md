---
title: UI automation dashboard refactor
status: complete
created: 2026-05-25
---

# UI Automation Dashboard Refactor

## Goal

Refactor the existing Vue/Vite frontend into a simpler, professional, shadcn-inspired Chinese automation cockpit. Keep the existing production capabilities reachable, but make the first screen focus on foolproof automatic production: start automation, status, failures, outputs, and next actions.

## Constraints

- Preserve the current Vue + Vite architecture.
- Do not force React, Next.js, or the shadcn CLI into the existing app.
- Use Vue-compatible, shadcn-like UI direction: restrained surfaces, compact controls, neutral graphite palette, semantic green/amber accents, and Lucide icons.
- Keep existing advanced modules reachable instead of deleting them.
- Avoid marketing/hero styling and decorative blob/orb backgrounds.

## Implementation

1. Add `AutomationDashboard.vue` as the default cockpit view.
2. Refactor `App.vue` so `dashboard` is the default module, while existing modules remain available in grouped navigation.
3. Refactor `TopNavigation.vue` from large cards into compact grouped segmented navigation with optional Lucide icons.
4. Update global styling to remove purple/blue gradient dominance and establish a graphite operations console theme.
5. Verify with frontend build and local visual inspection.
