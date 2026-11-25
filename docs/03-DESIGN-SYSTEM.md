# 03 · Design system — "The Hub Standards Manual"

Our own little standards manual, in homage to the original. The tokens live in
[`src/styles/tokens.css`](../src/styles/tokens.css).

## Principles

1. **One thing at a time.** Each screen has one job and one primary action (the **+** in your line color). Everything else is quieter.
2. **Show, don't explain.** Bullets, colors and positions carry the meaning. No screen should need a paragraph.
3. **Progressive disclosure.** A new item is a circle and a title. Dates, repeats, owners and notes appear only when you open it.
4. **Calm over urgent.** Late things carry words ("since Tue"), never red. The badge counts only *today*, and it's off by default.
5. **Big type, few words.** Large type means less fits on screen, and less on screen means less to take in.
6. **Same everywhere.** One layout grammar on phone, tablet and desktop. The desktop just gets a sidebar.

## Grid & spacing

- 8-pt grid with a 4-pt half-step. Side gutter: 20 px on phones, 32 px from 600 px up.
- Content column max 720 px. On ≥ 960 px a 264 px sidebar replaces the tab bar.
- Touch targets ≥ 44 × 44 px. Rows are 56 px tall (64 px in shopping mode).

## Type

**Inter** (variable) for Latin and **Heebo** (variable) for Hebrew, both self-hosted (no font CDNs, for privacy).

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| Band | 34 / 36 | 760 | −0.02em | Screen titles on black bands |
| Display | 56 / 56 | 760 | −0.03em | Big counts ("14 to buy") |
| Title | 22 / 28 | 720 | −0.01em | Sheet titles, list names |
| Row | 17 / 22 | 560 | −0.005em | Item titles |
| Body | 16 / 24 | 450 | 0 | Notes, descriptions |
| Meta | 13 / 18 | 560 | 0 | "since Tue", "Every 3 days" |
| Aisle | 13 / 16 | 720 | +0.04em | Aisle band labels |

Numbers use tabular figures. Every user-entered string is rendered with `dir="auto"`.

## Color

- **Lines** are the ten bullet colors (see [Brand](02-BRAND.md)). They mean *which list* or *whose*, nothing else.
- **Your accent** is your own line color. It fills the **+** button, your bullet, and the progress around the things you own.
- **No semantic red.** Nothing is ever "danger". Destructive actions (delete) use ink text plus an undo toast instead of a red button.
- **Dark mode** is the real signage: black canvas, white type, colored bullets.

## Signature components

| Component | Spec |
|---|---|
| **Band** | Black (`--band`), 4 px white stripe 6 px from the top edge, white Band-type title. In the safe area on iOS. Optional right-side actions (avatars, sync dot). |
| **Bullet** | Circle, line color, letter or emoji centred, weight 760. Sizes 20 / 28 / 40 / 56. |
| **Aisle band** | A mini band: 32 px black strip, white Aisle-type label, count on the right. Used for shopping categories. |
| **Check circle** | 26 px ring in the list's color. Tap: fills (180 ms), the tick draws (160 ms), haptic, then the row settles into Done. |
| **Row** | Hairline separators, no cards. Leading check circle, title, quiet meta line, trailing small bullets (owner) and an urgent mark. |
| **Visibility tag** | Three states with one icon each. **Ours**: two overlapping circles. **Mine**: your circle filled, theirs outlined. **Only me**: a lock. |
| **Chips** | Pill tokens for parsed quick-add parts ("Tomorrow 6 pm", "Every Sun"). Tap to undo. |
| **Sheet** | Slides from the bottom with 22 px top radius and a grab handle. Swipe down or tap outside to dismiss. |
| **Panel** | A black sign-panel card for big summaries on Today ("14 to buy →"). |
| **Arrow** | Square-cut heavy arrow, used for "go" affordances only. |
| **Freshness bar** | A 4 px bar that drains as a chore approaches due. In the chore's line color, then pebble grey when it's "when you can". |

## Motion

- Durations: 120 ms (micro), 180–240 ms (state), 280 ms (sheets). Easing `cubic-bezier(.2,.8,.2,1)`; springs only on the check.
- Lists animate insertions and removals (height and opacity) so items never jump.
- `prefers-reduced-motion`: no transforms, only opacity.
- Haptics: a single light tick on check-off (Android vibration; iOS via the system switch control where available).

## Accessibility

- Contrast: body text ≥ 7:1 on paper, meta ≥ 4.5:1. Bullet letters ≥ 3:1 (large bold) or we switch to ink.
- All controls are reachable by keyboard; visible focus ring (3 px, your line color).
- Desktop shortcuts: `N` new · `/` search · `1–4` tabs · `Esc` close.
- Screen readers: rows announce "Milk, Groceries, quantity 2, urgent, not done".
- Hebrew/RTL: per-string `dir="auto"`; icons that imply direction (arrows) flip in RTL contexts.

## Layout map

```
Phone                                   Desktop (≥ 960 px)
┌───────────────────────────┐          ┌──────────┬──────────────────────────────┐
│▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│  band    │ ▔▔▔▔▔▔▔▔ │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│
│ Today            (G)(H) ●  │          │ Gila Hub │ Today                (G)(H) ● │
├───────────────────────────┤          │          ├──────────────────────────────┤
│ ┌ 14 to buy  Ⓖ Ⓗ      → ┐ │  panel   │ ◉ Today  │  content column (max 720)     │
│ Today                      │          │ ○ Shop   │                               │
│ ○ Call the plumber    Ⓗ   │  rows    │ ○ Chores │                               │
│ ○ Pay rent    ⟳ 1st   Ⓖ   │          │ ○ Lists  │                               │
│ From earlier (2)        ▾  │          │ ── Lines │                               │
│                            │          │ Ⓖ Groc…  │                               │
│                     (+)    │  accent  │ Ⓗ Home…  │                         (+)   │
├───────────────────────────┤          │          │                               │
│ Today  Shop  Chores  Lists │  tabs    │          │                               │
└───────────────────────────┘          └──────────┴──────────────────────────────┘
```
