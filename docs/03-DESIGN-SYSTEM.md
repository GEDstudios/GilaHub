# 03 · Design system

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css). The visual language follows Tasky by H3Y Lab (see [Brand](02-BRAND.md)).

## Principles

1. **One thing at a time.** One job per screen, and one black "+" that does the obvious thing there.
2. **Color says *which project*.** It is never used for alarms. Late things get words ("since Tue").
3. **Big, soft, friendly.** Large serif titles and numbers, rounded tiles, generous spacing.
4. **Progressive disclosure.** A new item is a circle and a title; everything else appears when you open it.

## Type

| Role | Font | Size | Use |
|---|---|---|---|
| Title | Fraunces (soft) 450 | 32 | Screen titles ("Morning, Guy!") |
| Number | Fraunces 420 | 40 | Stacked strips, big counts |
| Wordmark | Fraunces 900, SOFT 100 | — | "gila hub" |
| Subheading | Outfit 400 | 20 | "You have 4 things to tackle today" |
| Row | Outfit 450 | 17 | Item titles |
| Body | Outfit 400 | 16 | Notes, descriptions |
| Caption | Outfit 500 | 12–13 | Meta, tags |

Hebrew falls back to Heebo (UI) and Frank Ruhl Libre (display). Every user string uses `dir="auto"`.

## Components

| Component | Spec |
|---|---|
| **Header** | Avatar (or a black circle Back button) top-left, black circle actions top-right, serif title below. On project screens the header is painted in the project color, with rounded bottom corners. |
| **Project card** | Color tile, radius 22, emoji top-left, serif name, "3 open · Tasks". |
| **Stacked strips** | Overlapping color bands (−16 px), each with a big serif number on the left and a label on the right. |
| **Tags** | Pastel pills that overlap by 8 px. |
| **Name tag** | Pill in a person's color with a cursor arrow. |
| **Row tile** | Gray tile (`--surface`), radius 18, 6 px gap. Check circle on the left. |
| **Check** | 28 px ink ring; when done it fills with the project color and shows an ink tick. |
| **Buttons** | Black pill (primary), gray pill (quiet), white pill with a black arrow circle (onboarding). |
| **Tab bar** | Four tabs plus a raised 66 px black "+" in the middle. On desktop it becomes a sidebar with a black "+ New" pill. |
| **Sheets** | Bottom sheets, radius 28, serif title, gray close button. |

## Motion

120–300 ms with `cubic-bezier(.2,.8,.2,1)`. A spring on the check, float-in on the splash shapes. `prefers-reduced-motion` turns transforms off.

## Accessibility

Ink on every palette color passes WCAG AA. Visible 3 px focus rings, 44 px minimum targets, desktop shortcuts (`N`, `/`, `1–4`).
