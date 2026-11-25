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
| **Chips** | 38 px gray pills: gray text when unset, ink when set, black when open (its icon lit in my color). Urgent is lemon, with a lightning icon. |
| **Panel** | Opens under a chip: white, radius 22, soft shadow, with 36 px option pills (the chosen one is black). |
| **Strips** | Overlapping bands (−16 px) with a big serif number and a small label. |
| **Tab bar** | A floating white bar, 4 tabs, no central button. On desktop, a light sidebar with a black "New" pill. |
| **Sheets** | Bottom sheets with radius 30 and a serif title. They're used for "New", project settings and pickers. |

## Icons — Gila Duo

Every icon is an **ink line** and a solid **light** behind it, drawn from Phosphor Duotone (MIT, see [THIRD-PARTY](THIRD-PARTY.md)) on a 256 grid. The light rests as a faint ink tint and switches on, in your color, for the one thing that is on. Guy's icons light lemon, Hila's light pink.

| State | Line | Light | Offset |
|---|---|---|---|
| Rest | text-3 in chips and tabs, text-2 in rows | ink 7% | 0 |
| Set (has a value) | ink | ink 7% | 0 |
| **Lit**: active tab or nav item, open chip, picked option, pressed icon button, chosen picker cell | ink (canvas on ink) | `--me-light` (my color) | 1.25 px down-right, springs in over 280 ms |
| Project identity (lists, sidebar, bar editor) | ink | the project's color | 0 |
| Project in the tab bar or sidebar, inactive | text-3 | the project's color at 45% | 0 |
| On color (folder cards, the urgent chip and tag, emoji tiles) | ink | ink 12% | never |
| On ink (the solid button, ink tokens, toasts) | canvas | canvas 16% | 0 |
| Whose (`mine`, `theirs`, `heart-fill`) | as context | mine, my partner's color, pink: always | follows state |
| Control (plus, check, x, chevrons, arrows, more, grip, undo, refresh) | as context | none: the button is the light | n/a |

- **One lit per group.** Only the active tab, the open chip, the picked option, a pressed icon button or the chosen icon cell lights up. Chips that merely have a value, and settings rows whose switch is on, stay at rest.
- **Controls are line only.** Their button is the light.
- **No light-only signals.** Lemon on white is about 1.1:1, so "on" also changes the line color, the label weight and `aria-current` / `aria-pressed`.
- **The offset appears only when lit** (and grows to 2.5 px while a row is lifted, `.is-lifted`).
- **Privacy family:** Ours is two overlapping circles whose shared lens is the light; Mine fills my circle in my color; my partner's fills theirs in their color; Only me is a lock.
- **Sizes** are set with `--s` (px), never width/height: 24 tab bar and folder cards · 22 default (icon buttons) · 20 sidebar, settings rows, icon picker, aisle headers · 18 chips and options (`.icon--sm`) · 16 bar editor buttons · 15 meta and tokens (`.icon--xs`) · 14 card lock and the urgent tag · 13 add-row plus and token ×. Never above 28 px: the line gets too heavy.
- **Adding an icon:** add one row to `MAP` in [`scripts/build-glyphs.mjs`](../scripts/build-glyphs.mjs) and run `npm run glyphs`. Never hand-edit `src/app/ui/icons.gen.ts`. Use `<Icon name="…" />`; `lit` lights it when no parent state does.

## Motion

140–320 ms with `cubic-bezier(.2,.8,.2,1)`. A spring on checks, switches and swatches. `prefers-reduced-motion` turns movement off.

- **Drag to reorder** is one component, [`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx), for rows, steps, aisles, folders and the Settings arrangers. A long-press (220 ms) lifts a row on a phone; a grip starts after 3 px. The lifted copy floats above everything at 1.035×, leans 1.5° and tilts up to ±3° with the finger's speed, with a deep shadow (`--lift-3`). Folders keep their own tilt and add 3°. The spot it left is a dashed slot; neighbours slide over 260 ms with a little overshoot, and the drop settles in 320 ms. A shopping row stays in its aisle: pull it out and the aisle shakes no.
- **Ticking** ([`ui/useSettle.ts`](../src/app/ui/useSettle.ts)): the ring pops, the tick draws itself, a line strikes the title, and the row folds away after about half a second. The data changes at once; only the row waits.
- **Haptics** ([`ui/haptics.ts`](../src/app/ui/haptics.ts)): `haptic('select' | 'tick' | 'lift' | 'drop' | 'success' | 'warn')`, off with the device's Haptics switch in Settings.
- With reduced motion there is no tilt, scale or overshoot; the shadow and the slot stay.

## Accessibility

Ink on every palette color passes WCAG AA, and so does every text gray (4.5:1 or more on the canvas and on tiles). The lightest gray is kept for placeholders and decoration. Color dots carry a darker rim of their own hue so lemon still shows on gray. Visible focus rings, 44 px minimum touch targets on checks, and desktop shortcuts (`N`, `/`, `1–4`).
