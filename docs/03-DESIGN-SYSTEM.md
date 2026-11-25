# 03 · Design system

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css). The visual language follows Tasky by H3Y Lab (see [Brand](02-BRAND.md)).

## Principles

1. **Calm canvas, one color moment.** Screens are near-white and soft gray. Color is reserved for the card that says *which project*: never for alarms, never on every row.
2. **Inline, not forms.** You change things where they are. Chips under a card open their options in place. Adding happens in a row at the end of the list.
3. **Say it in a sentence.** Every card has one plain line underneath ("Friday at 8 pm, for Hila."), so you don't have to read settings.
4. **Few choices.** Six colors. Four repeat options plus custom. No themes or display toggles.
5. **Tactile.** Things press in (scale 0.96–0.98), checks spring, panels lift with a soft shadow, switches slide.

## Type

| Role | Font | Size | Use |
|---|---|---|---|
| Title | Newsreader 400 | 38 | Screen titles ("Morning, Guy!") |
| Card title | Newsreader 400 | 25–38 | Project and item cards |
| Number | Newsreader 400 | 30–36 | Strips, percentages |
| Summary | Figtree 400 | 19 | "You have 4 things to tackle today" |
| Row | Figtree 400 | 16.5 | Item titles |
| Control | Figtree 500 | 14–14.5 | Chips, options, section labels |
| Meta | Figtree 400 | 13 | Project, date, steps |

Hebrew falls back to Heebo (UI) and Frank Ruhl Libre (display). Every user string uses `dir="auto"`.

## Components

| Component | Spec |
|---|---|
| **Header** | Quiet top row (a 42 px gray circle for back and actions, or your avatar), then a serif title. On scroll, a frosted bar keeps the name. Every tab's title sits at the same height. |
| **Color card** | Radius 24–30, the project color, serif title top-left, a sentence bottom-left, an optional black badge top-right. |
| **Rows** | One gray tile (radius 20) per group, rows 58 px with hairline dividers. A thin 24 px check ring; done fills with the project color. Done rows are struck through in gray. |
| **Add row** | At the end of each list: a dashed plus and an input. It lifts into a white card while you type, and shows what it understood as chips. |
| **Chips** | 38 px gray pills: gray text when unset, ink when set, black when open. Urgent is lemon. |
| **Panel** | Opens under a chip: white, radius 22, soft shadow, with 36 px option pills (the chosen one is black). |
| **Strips** | Overlapping bands (−16 px) with a big serif number and a small label. |
| **Tab bar** | A floating white bar, 4 tabs, no central button. On desktop, a light sidebar with a black "New" pill. |
| **Sheets** | Bottom sheets with radius 30 and a serif title. They're used for "New", project settings and pickers. |

## Motion

140–320 ms with `cubic-bezier(.2,.8,.2,1)`. A spring on checks, switches and swatches. `prefers-reduced-motion` turns movement off.

## Accessibility

Ink on every palette color passes WCAG AA. Visible focus rings, 44 px minimum touch targets on checks, and desktop shortcuts (`N`, `/`, `1–4`).
