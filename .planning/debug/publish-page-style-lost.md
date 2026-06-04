---
status: resolved
trigger: "点击用于发布按钮后跳转的发布页面样式丢失"
created: 2026-06-03
updated: 2026-06-03
---

## Symptoms

- Expected behavior: Clicking "用于发布" should open the publish composer/page with the same styled modal/control-panel UI as the rest of the app.
- Actual behavior: The publish page shows mostly unstyled default HTML controls/text while the video preview remains visible.
- Error messages: None provided.
- Timeline: Observed on 2026-06-03 in the in-app browser at http://localhost:3001/.
- Reproduction: Open a completed asset detail modal, click "用于发布", then view the publish screen.

## Current Focus

- hypothesis: The publish composer view is rendered outside the styled dashboard scope or its stylesheet is no longer imported for the route/state reached by "用于发布".
- test: Inspect frontend view switch and CSS ownership for the publish composer/page.
- expecting: Find a missing CSS import, scoped selector mismatch, or branch rendering publish markup without the design-system classes.
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-03T17:50:00+08:00
  source: code inspection
  observation: `PublishComposerModal.vue` renders `.source-modal`, `.publish-composer-modal`, `.field-control`, `.select-menu`, and preview-video markup inside a child SFC, while the relevant selectors only lived in `AutomationDashboard.vue`'s scoped stylesheet.
  implication: Vue scoped CSS from `AutomationDashboard.vue` does not match DOM rendered inside `PublishComposerModal.vue`, so the composer appears as default HTML controls with an oversized video.

- timestamp: 2026-06-03T17:54:00+08:00
  source: verification
  observation: `npm run build:front` succeeds and the browser at `http://localhost:3001/` reports scoped CSS rules for `.publish-composer-modal`, `.field-control`, and `.publish-composer-preview video`.
  implication: The publish composer styles are now included under the child component scope.

## Eliminated

## Resolution

- root_cause: Publish composer markup was moved/rendered in `PublishComposerModal.vue`, but its modal/form/preview/select styling still lived in `AutomationDashboard.vue` scoped CSS and therefore did not apply to child component DOM.
- fix: Added a scoped style block to `frontend/src/components/materialDriven/PublishComposerModal.vue` containing the composer modal, form, select menu, feedback, preview video, light-theme, and mobile rules it uses.
- verification: `npm run build:front` passed; `npm run lint` passed for configured server/script lint; browser check at `http://localhost:3001/` confirmed the app mounted and scoped publish-composer CSS rules are present. `npm run build` is not available in this package.
- files_changed: `frontend/src/components/materialDriven/PublishComposerModal.vue`, `.planning/debug/publish-page-style-lost.md`
