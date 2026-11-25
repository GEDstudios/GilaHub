# 06 · Plan

## Milestones

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M0 | **Research & plan** | [Research](01-RESEARCH.md) · [Brand](02-BRAND.md) · [Design system](03-DESIGN-SYSTEM.md) · [Features](04-FEATURES.md) · [Architecture](05-ARCHITECTURE.md) | Every requirement maps to a feature; design reference chosen and adapted. |
| M1 | **Core engine** | Replicated store (HLC + per-field LWW), IndexedDB persistence, fractional ordering, scoped E2E crypto, invite derivation | Two simulated replicas converge under reordering, duplication and privacy changes. |
| M2 | **Smart layer** | Quick-add parser (EN + HE basics), quantity parser, ~650-item bilingual catalog + learning categorizer, recurrence engine (two repeat types, early/late/collapse), buy-again | Unit tests for each rule from the research. |
| M3 | **The app** | Onboarding, Today, Shopping (+ shopping mode), Chores, Lists + infinite drill-down, item detail, quick add, search, settings, dark mode, desktop layout | Every v1 feature in [Features](04-FEATURES.md) works offline on one device. |
| M4 | **Relay & pairing** | Worker + Durable Objects, WebSocket sync, invites, presence, Web Push with encrypted payloads, deploy script + GitHub Action | Two browsers pair and sync live; "Only me" never reaches the partner; push encryption matches RFC 8291. |
| M5 | **Polish & verify** | Visual review at phone/desktop, light/dark; accessibility pass; README | Screenshots reviewed; all tests green. |

## Working agreements

- **Free stays free**: no dependency that needs an account, a key or a paid tier.
- **Private by construction**: nothing user-written leaves a device unencrypted, and there are no third-party requests at runtime.
- **Calm by default**: any new notification, badge or color needs a reason in writing.
- **Tests travel with rules**: every scheduling, parsing or privacy rule gets a unit test.

## After v1: the roadmap

1. **v1.1 "Stores"**: per-store aisle order learned from check-off order; store picker in shopping mode.
2. **v1.2 "Mornings"**: optional daily summary composed on-device; month calendar.
3. **v1.3 "Hebrew"**: full Hebrew interface with mirrored layout (content is already bilingual).
4. **v1.4 "Bring your stuff"**: import from Microsoft To Do (retiring June 2027), Todoist and Apple Reminders; Android share target.
5. **v1.5 "Relay compaction"**: encrypted snapshots so new devices bootstrap in one request.
6. **Later**: meal plan → groceries, household info card, shared expenses, native shell for widgets.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| iOS changes web-app behaviour (it did in iOS 26) | Pure web standards only; no private APIs; haptics are progressive enhancement. |
| Free-plan limits change | Usage is ~1–3% of today's limits. The relay is ~600 lines and portable to any Durable-Object-like host (or a $0 Fly/Deno alternative). |
| A device is lost | Data lives on every device plus the encrypted relay. Pair a new device from any remaining one. Export/import JSON anytime. |
| Both devices lost and no export | The relay alone can't help (by design, it can't decrypt). Mitigation: periodic export reminder in Settings (v1.2). |
