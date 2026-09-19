# Teacher Interface De-clutter and Consolidation

## Goal
Make the teacher experience calmer and easier to scan by reducing repeated actions, clarifying the main task on each view, and replacing the current collection of floating cards with a consistent workspace layout.

## Changes
- Replace the dashboard's four oversized navigation tiles with a compact navigation bar and one clear primary action: **Create test**.
- Consolidate headline statistics into a single summary strip so counts support the workflow without competing with it.
- Make **My Tests** the main working area, with clearer test rows, one primary action, and secondary actions grouped into a compact menu.
- Remove duplicated navigation: use one consistent page-back control and eliminate inner cancel/back controls that perform the same action.
- Remove duplicated student navigation by making each student row the single details trigger rather than also showing a separate Details button.
- Tighten spacing, typography, borders, and status styling across the teacher dashboard while preserving the existing brand colors and behavior.
- Keep live monitoring visible but visually quieter when no sessions are active; promote it automatically when sessions are active.

## Interaction Details
- Maintain all existing destinations and data behavior.
- Keep destructive actions available but visually separated from routine actions.
- Ensure controls remain clear on desktop and collapse cleanly on smaller screens.
- Preserve accessibility through labelled icon controls, focus states, and full keyboard navigation.

## Validation
- Check dashboard, tests, students, classes, monitoring, and test-creation transitions.
- Confirm no duplicated back/cancel actions remain in the teacher flow.
- Verify desktop and mobile layouts for clipping, overlap, and readable action hierarchy.
