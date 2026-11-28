# 03 · Design system

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css). The visual language follows Tasky by H3Y Lab (see [Brand](02-BRAND.md)).

## Principles

1. **Calm canvas, one color moment.** Screens are near-white and soft gray. Color is reserved for the card that says *which folder* (or whose day): never for alarms, never on every row.
2. **Inline, not forms.** You change things where they are. Chips under a card open their options in place. Adding is the one black +, wherever you are.
3. **Say it in a sentence.** Every card has one plain line underneath ("Friday at 8 pm, for Hila."), so you don't have to read settings.
4. **Few choices.** Six colors. Four repeat options plus custom. No themes or display toggles.
5. **Tactile.** Everything you can tap answers the finger (a round button dips to 0.9, a pill gives to 0.96, a card barely moves at 0.98), checks spring, panels lift with a soft shadow, switches slide.

## Type

Seven sizes for everything you read and tap, as tokens (`--type-*` in [`tokens.css`](../src/styles/tokens.css)); the serif runs larger, set where it's used.

| Token | Size | Use |
|---|---|---|
| `--type-micro` | 11 | Snug tab labels, count badges |
| `--type-caption` | 12 | Tags, weekday captions |
| `--type-meta` | 13 | A row's second line: folder, date, subtasks |
| `--type-label` | 14 | Controls and labels: options, tokens, section titles |
| `--type-chip` | 15 | Chips and sub-lines |
| `--type-body` | 16 | Sentences, buttons, anything you type into |
| `--type-row` | 17 | A row's title |
| Serif (Newsreader 400) | 20–54 | Screen titles (38), card titles (25–38), big numbers |

Figtree for the seven, Newsreader for the serif. Hebrew falls back to Heebo (UI) and Frank Ruhl Libre (display). Every user string uses `dir="auto"`.

## Screens

| Screen | What's on it |
|---|---|
| **Header** (`Band`) | A quiet top row (a 42 px gray circle for Back, or your avatar; on the right the screen's few gray buttons: star, search, "…"), then a serif title. On scroll, a frosted bar keeps the name. |
| **The +** (`AddMenu`) | The one black circle, floating bottom right on every screen but Settings. Pressing it opens three choices over it at once (no hold to wait out), each drawn as the little thing it makes, the task nearest the thumb: a task (here), a folder (inside this one, on a folder's page), a sticky note for my person. A tap leaves them open to tap. Or keep the finger down, slide up to one (it steps forward and its name goes ink; within `DIST.reach` counts) and let go: one gesture makes it. Let go anywhere else, or back on the +, and nothing is made. `N` makes a task straight away. |
| **Today** | The day's card in my colour (how many things, one sentence, done/all in a black badge, my person's name tag on its edge), then my blocks in my order: Today, Highlights, Us (colour cards that open in place), The week (a strip of days), pinned folders and filtered lists. "Edit Today" at the end turns the blocks into cards to hide, reorder and add. See [07 · Today](07-HOME.md). |
| **Folders** | Folder cards in a grid, each a little tilted, drag to reorder or onto the bar to pin; then our kept notes; "Arrange the bar" makes the live bar editable. |
| **A folder** | Its card is its settings: the name and description edited in place, a tap on the card for its colour, and down its edge the pin, who sees it, its icon. What's set once (a photo, its task template, the folders it shows tasks from, where it lives) is in its "…" menu, each row saying what's set. Then the folders inside, a lens (who, urgent, tags) beside the view switch (list, cards, by tag), "Again?" tokens, the rows, In stock and Done folded. |
| **Ongoing** (`OngoingTray`, ongoing.css) | A white card at the top of a folder when something's in it: the ▷ mark with how many are left, a bar in my colour (mint when all are done), the open ones as rows, the ticked ones as chips, Clear. A row swiped right uncovers ▷ on my colour; left, an × on gray. |
| **A task** | The path (each step goes there; a task in two places says the other one at its end), its colour card (title edited in place, the tick, a photo), then chips that open in place: the date (with time, repeat and notification inside), Urgent, who sees it, and behind an arrow Who, Stock, Tags. Notes, subtasks (their heading only once there is one), history with ♡. Move to… and Also in… are in its "…" menu. |
| **New** (`QuickAddSheet`) | One sentence to type on a live colour card, then the same chips. A chip always wins over the words; what it understood shows as tokens you can tap back into plain text. |
| **Settings** | One calm page where everything changes in place: my card (name, colour, a device), Notifications, Tags, how I like things, my data, About. One section per file under [`screens/settings/`](../src/app/screens/settings). |
| **Tab bar** | A floating white bar: Today, your pins, Folders. A soft gray pill marks the active tab. Up to 5 tabs show icon and label; 6–7 icons only, the active one rising to show its name; 8 or more dock around a scrolling middle. Hold and slide to pick. |
| **On a computer** (960 px and up) | The bar becomes a top bar (`TopNav`): the wordmark, the same tabs with counts, search, ideas, the two of us. Pages sit on a wider grid; the phone's bar, the Ideas tag and the compact header step aside. Everything for it is in [`desktop.css`](../src/styles/desktop.css). |
| **Sheets** | Bottom sheets with radius 30 and a serif title; a dialog from 720 px. Never a sheet on a sheet: a choice inside one opens as an inline panel. Pull one down by its handle or title: past 28% of its height (or a flick) closes, less springs back. |
| **Toasts** | A black pill above the bar with at most one lemon action (Undo: `toast(msg, { undo })`). At most two show; toasts of one kind fold into one ("3 done") whose Undo undoes them all. Swipe one away; a finger on it keeps it. |
| **Ideas tag** | A small paper tag by the avatar on every phone screen, with the open count and a dot in my person's colour when they've added something. |

## The building blocks

Every recurring piece of UI is one component, and every screen uses it rather than its own copy.

| Need | Component (file) | Notes |
|---|---|---|
| Commit something | `Button` ([`ui/primitives.tsx`](../src/app/ui/primitives.tsx)) | `quiet`, `small`, `block`, `danger`, `icon`. `Choices` stacks a sheet's answers; `DoneButton` leaves an edit mode. |
| A low-emphasis link | `TextButton` | `icon` before the words, `iconAfter` when it leads somewhere, `danger`. |
| A round glyph button | `IconButton` | `pressed`, `disabled`, `small`. `StarButton` (keep it on Today) and `ThanksButton` (♡) are the two with a meaning of their own. |
| A small glyph beside a thing in a row | `GlyphButton` | × clears a field, takes a row out, stops a count; › opens it. 32px, quiet until touched; `filled` is the gray disc on a card. |
| A property of the thing | `EChip` ([`components/chips.tsx`](../src/app/components/chips.tsx)) | `open`: its panel opens under the row. `pressed`: an on/off chip (Urgent, Pin to bar). `ghost`: a dashed invitation. `Panel` and `Options` are what opens. |
| The chip row of a task | `InlineEditor` ([`components/InlineEditor.tsx`](../src/app/components/InlineEditor.tsx)) | With `WhenCard`, `RepeatPanel`, `TimeEntry` beside it, one file each. |
| On/off with a label | `SwitchRow` ([`components/pickers.tsx`](../src/app/components/pickers.tsx)) | The whole row flips the `Switch`. `OptRow` is the quiet row of a group; `ActionSheet` a "…" menu. |
| One of a few, inline | `Seg` (raised pill), `Options` (wrapping pills) | |
| − n + | `Stepper` | `nullable` goes below its lowest to "off"; `tone` low / out. |
| A titled block | `Section`, `Disclosure` (folds with `FoldButton`) | Done, In stock, Resolved ideas. |
| Choose where something goes | `PlaceTree` ([`components/PlaceTree.tsx`](../src/app/components/PlaceTree.tsx)) | Folders fold, tasks and subtasks unfold, a search field on top. Move, Also in, a filtered list's folder, Show tasks from…, the composer's place. |
| A row | `ItemRow` / `SortableItemRow` ([`components/ItemRow.tsx`](../src/app/components/ItemRow.tsx)) | Its tags are in [`components/RowTags.tsx`](../src/app/components/RowTags.tsx): Urgent, whose, who asked whom, OK / Not yet. |
| Reorder by dragging | `Sortable` ([`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx)) | See the recipe below. `DropChip` is what's in the hand over somewhere it can go into. |
| How things are said | [`app/labels.ts`](../src/app/labels.ts) | Names, who does it, when, how it repeats, `howMany(n, 'task')`. |
| What a glyph means | [`ui/glyphs.ts`](../src/app/ui/glyphs.ts) | `G.subtask`, `G.close`, `G.highlight`…: components name the meaning, never a raw glyph. `G_TEXT` for notification titles. |

### Component families

One job per family (sizes on a phone).

| Family | Only job | Size | Examples |
|---|---|---|---|
| `.btn` / `.btn--quiet` | Commit an action / the second choice | 54, 38 with `--sm` | Add, Create folder, Stick it |
| `.iconbtn` | Header and sheet chrome, always gray | 42, 38 with `--sm` | Search, …, Back, Close, the star |
| `.echip` | A property of the thing | 38 | Date, Who, Ours, Urgent |
| `.option` | A choice inside a panel or sheet | 38 | Ours / Mine / Private, Every week |
| `.token` | A suggestion or parsed result to tap | 32 | "Sunday ×", Again?, search words |
| `.mini` | An in-row action on a tile | 32 | OK / Not yet, Restore |
| `.textbtn` | A low-emphasis link | — | Edit Today, Invite your person |
| `.urgent` `.vtag` `.rtag` | Read-only status in a row | 22 | Urgent, Mine, Hila asked |

- Nothing but the + is a big black circle. Dashed borders mean "not there yet": create or bring in, where a drag came from, a chip that is off.
- **Folding** has one component, `FoldButton`: a quiet chevron on the right of a heading. What opens in place (a card, a row's subtasks, the hidden chips) carries a `.chev` instead: it turns with its button's `aria-expanded`, so nothing else has to say it's open.
- **"…" menus** hold what's rare: set once (a folder's photo, template, where it lives), or destructive. Whatever deletes goes last and is red.
- **Said once.** What the add sheet understood shows as its chips lighting up, not as a second row of tokens; changing a chip gives the words back to the title.
- **Same words for the same thing** (`app/labels.ts`): a date and time read "Fri 4 Dec · 17:00" in a row, a chip and a notification, and "Fri 4 Dec at 17:00" in a sentence.

## Icons — Gila Duo

Every icon is an **ink line** and a solid **light** behind it, drawn from Phosphor Duotone (MIT, see [THIRD-PARTY](THIRD-PARTY.md)) on a 256 grid. The light rests as a faint ink tint and switches on, in your color, for the one thing that is on. Guy's icons light lemon, Hila's light pink.

| State | Line | Light | Offset |
|---|---|---|---|
| Rest | text-3 in chips and tabs, text-2 in rows | ink 7% | 0 |
| Set (has a value) | ink | ink 7% | 0 |
| **Lit**: active tab or nav item, open chip, picked option, chosen picker cell | ink (canvas on ink) | `--me-light` (my color) | 1.25 px down-right, springs in over 280 ms |
| Folder identity (lists, the top bar, the bar being edited) | ink | the folder's color | 0 |
| Folder in the tab bar or top bar, inactive | text-3 | the folder's color at 45% | 0 |
| On color (folder cards, the urgent chip and tag, emoji tiles) | ink | ink 12% | never |
| On ink (the +, toasts) | canvas | canvas 16% | 0 |
| Whose (`mine`, `theirs`, `heart-fill`) | as context | mine, my partner's color, pink: always | follows state |
| Control (plus, check, x, chevrons, arrows, more, grip, undo, refresh) | as context | none: the button is the light | n/a |

- **One lit per group.** Only the active tab, the open chip, the picked option or the chosen icon cell lights up. Chips that merely have a value, and settings rows whose switch is on, stay at rest.
- **Controls are line only.** Their button is the light.
- **No light-only signals.** Lemon on white is about 1.1:1, so "on" also changes the line color, the label weight and `aria-current` / `aria-pressed`.
- **The offset appears only when lit** (and grows to 2.5 px while a row is lifted, `.is-lifted`).
- **Privacy family:** Ours is two overlapping circles whose shared lens is the light; Mine fills my circle in my color; my partner's fills theirs in their color; Only me is a lock.
- **Sizes** are set with `--s` (px), never width/height: 24 tab bar and folder cards · 22 default (icon buttons) · 20 the top bar, settings rows, icon picker, group headers · 18 chips and options (`.icon--sm`) · 16 the Ideas tag · 15 meta and tokens (`.icon--xs`) · 14 card lock and the urgent tag · 13 add-row plus and token ×. Never above 28 px: the line gets too heavy.
- **One meaning, one glyph.** Components use [`G`](../src/app/ui/glyphs.ts) (`<Icon name={G.subtask} />`), never a raw glyph name, so the same idea always looks the same and no glyph means two things (the star is "keep it on Today", for a task and a folder alike; the To-Do folder's mark is a tick).
- **Adding an icon:** add one row to `MAP` in [`scripts/build-glyphs.mjs`](../scripts/build-glyphs.mjs) (our own drawings go in as `['custom', [light, line]]`) and run `npm run glyphs`, then give it a meaning in `G`. Never hand-edit `src/app/ui/icons.gen.ts`. `lit` lights it when no parent state does.

## Scales

Every value comes from one scale; [`tests/unit/tokens.test.ts`](../tests/unit/tokens.test.ts) fails when a stylesheet steps off one.

- **Type**: the seven `--type-*` sizes above; only the serif (and the scaled note face) says px. A field you type into is at least 16 px (a phone zooms in on smaller ones).
- **Space** (padding, margin, gap): 2 4 6 8 10 12 14 16 20 24 28 32 36 40 48 56 64. Stacking blocks use `--space-1…5` (8 12 16 24 36). The page gutter is 24. The same job takes the same gap everywhere: 8 between chips in a row, 16 inside a panel, 24 inside a large colour card (20 in a small one), 10 from a label to what it names, 36 between sections.
- **Heights** of what you press: `--ctl-s` 32 (small things inside a row or beside a field: a token, a switch of two, the view switch, × and ›), `--ctl-m` 38 (chips, options, the round buttons on a folder's card), `--ctl-l` 42 (the round buttons in a header; 36 on a computer). The big button (54) and the on/off switch keep their own, as do the task card's 40px discs (below).
- **Corners**: `--r-s` 14 inside a card (a field, a row, a tile), `--r-m` 20 a card (a list, a group, a panel), `--r-l` 30 the colour cards and sheets; a floating bar is `--r-bar` 24. A computer maps s, m and l to 10, 14 and 20. Tiny marks say their own (10 and under), pills are 999px, and the folder's tab and a sticky note are shapes of their own.
- **Speed**: transitions run at `--dur-quick` 140 ms (a press, a hover), `--dur-base` 200 (a state changing), `--dur-move` 260 (something travelling) or `--dur-slow` 320 (something landing), on `--ease` or `--spring`. A few pieces of choreography keep a time of their own (a note peeling, the bar's pill).
- **Press**: `--press-disc` 0.9, `--press-pill` 0.96, `--press-card` 0.98.
- **Depth**: `--lift-1` (resting on the page), `--lift-2` (floating over it), `--lift-3` (held in the hand), `--lift-sheet`; with `--edge` (a hairline round a white card) or `--edge-faint` (round something floating). `--ring-ink` says "picked".
- **Colour**: white surfaces are `--card`; text on ink is `--cta-text`; a hover or press fill is `--press`.
- **Stacking** (`--z-*`): raised 20 · band 30 · fab 35 · bar 40 · sheet 60 · search 70 · toast 80 · drag 200 · effects and the cursor on top.
- **Feel** ([`ui/tokens.ts`](../src/app/ui/tokens.ts), mirrored in tokens.css): `HOLD.press` 350 ms is every press-and-hold (a row, a subtask, a note, a group, a tree row); `HOLD.handle` 120 ms a grip; `HOLD.bar` 240 ms the tab bar's scrub. `SLOP` says how far a pointer may wander; `DUR`, `EASE` and `TOAST` the timings; `calm()` is reduced motion. [`ui/pointer.ts`](../src/app/ui/pointer.ts) is the one place that asks what the device points with.

Hover looks sit inside `@media (hover: hover)`, so a tap on a phone never leaves something lit.

The styles are one family per file: [`styles/components/`](../src/styles/components) and [`styles/screens/`](../src/styles/screens), imported in cascade order by `components.css` and `screens.css`; tokens in `tokens.css`; the computer layout in `desktop.css`.

## Motion

The four speeds above, with `cubic-bezier(.2,.8,.2,1)`; a spring on checks, switches and swatches. `prefers-reduced-motion` turns movement off.

- **Drag to reorder** is one component, [`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx), for rows, subtasks, groups, folders, tags, ideas and the blocks of Today. A long-press (`HOLD.press`, so an unhurried tap still opens the row) lifts a row on a phone; a grip starts after 4 px with a mouse. The lifted copy floats above everything at 1.035×, leans 1.5° and tilts up to ±3° with the finger's speed, with a deep shadow (`--lift-3`). Folders keep their own tilt and add 3°. The spot it left is a dashed slot; neighbours slide over 260 ms with a little overshoot, and the drop glides home in 320 ms with a small landing beat. A shopping row stays in its aisle: pull it out and the aisle shakes no.
- **The task card's buttons**, its tick, its photo and its count (for something kept stocked), are one look: a 40px disc of near-white glass (light enough to show on lemon) with no stroke, one above the other on the card's right edge. The count opens into − n + of the same height, in ink whatever the level.
- **Where a drag lands** ([`ui/dropMark.ts`](../src/app/ui/dropMark.ts), drag.css "Landing"; where, [`app/outline.ts`](../src/app/outline.ts)) is said the same way by every drag, in darkened gray only, never a person's or folder's color. What it goes into darkens (`--drop-fill`: a group, a folder card, a step of the path, a tab). Among rows, they part and a gray gap opens right where it lands, at that level's indent; where it came from stays a dashed slot. One or the other, never both: a task taking a subtask shows only the gap, opened inside it where the subtask will be, and doesn't darken itself. Tasks and subtasks move the way outliners and most to-do apps move them: **up and down is its place, right and left is its level**. Moving a task up or down only ever reorders it, however long the hand rests on a row, so reordering can't nest by accident. Pulled right (`DIST.nest`, from where the press began) it goes under the task just above where it would land (the slot the list has open for it), at the end of its subtasks; a task with folded subtasks unfolds after a moment so it can go among them. Pulled left, a subtask comes out of its task, right after it (in place, on a sister, or on the gap). A pull lasts until the hand comes half the way back or moves on up or down. Going down through a task that shows its subtasks goes among them: over a subtask's upper or lower half, the gap opens before or after it. As cards they sit side by side, so sideways is just moving and there's no pull: a card goes under another by resting on it (held still for `HOLD.nest` over that card's place, it comes back under the hand, a gray box opens at its foot exactly where the subtask will be (the card itself doesn't darken: the spot is the message), and the one in the hand becomes the ↳ chip; moving on takes it back). Subtasks unfolded in a card are small rows on gray tiles across its foot, not cards in a card. The card in the hand is the very card at its own size on a lifted shadow, and where it lands is one plain gray slot, no card under it. A row in the hand is never swiped: pulling it sideways is the drag's. While a task is in the hand (in a list) a small ink pill rides above its far end (`PullHint`: an arrow leaning right, the subtask mark, "Subtask"; as cards, the subtask mark and "Hold on a card"); it waits a beat, so a quick reorder never sees it, and goes once the pull takes hold. A subtask dragged out of a folder list settles into the gap (a preview); a task in the hand shows a chip (↳ under a task, ⇱ out on its own). On a task's page, pulling a subtask left takes it out (its step of the path darkens). Escape puts a drag back.
- **Ticking** ([`ui/useSettle.ts`](../src/app/ui/useSettle.ts)): the ring pops, the tick draws itself, a line strikes the title, and the row folds away after about half a second. The data changes at once; only the row waits.
- **Hold and slide** ([`TabBar.tsx`](../src/app/components/TabBar.tsx)): hold the bar still for 240 ms and slide. The tab under the finger lights up, swells with its neighbours (`--d`) and is named in a black bubble; letting go goes there, lifting the finger 72 px above the bar cancels. Rest past the outermost tab in view (or in the edge fade) for 300 ms and the dock steps one tab, then another every 230 ms, so the edge tab itself can always be picked. A tap is still instant and a quick swipe still scrolls the dock. The first time the bar holds 6 or more, it says so once: "Hold and slide to pick".
- **Sheets and toasts** follow the finger ([`ui/overlays.tsx`](../src/app/ui/overlays.tsx), the math in [`ui/motion.ts`](../src/app/ui/motion.ts)): a sheet pulled short springs back over 420 ms with `cubic-bezier(.34,1.4,.64,1)`; a toast swiped past 64 px (or flicked) flies off. A folded toast pops once more.
- **Haptics** ([`ui/haptics.ts`](../src/app/ui/haptics.ts)): `haptic('select' | 'tick' | 'lift' | 'drop' | 'success' | 'warn')`, off with the device's Vibration switch in Settings (phones and tablets only).
- With reduced motion there is no tilt, scale or overshoot; the shadow and the slot stay. The bar's pill doesn't slide and nothing swells while scrubbing.

### Drag recipe

To make a new list reorderable, wrap it in `Sortable` and let each item call `useSortableItem` ([`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx); `SortableItemRow` in `ItemRow.tsx` is the simplest example):

```tsx
<Sortable ids={rows.map((r) => r.id)} onMove={(next, id) => save(next, id)} label={(id) => titleOf(id)} renderOverlay={(id) => <ul className="rows"><Row id={id} /></ul>}>
  <ul className="rows">{rows.map((r) => <SortableRow key={r.id} row={r} />)}</ul>
</Sortable>

function SortableRow({ row }) {
  const s = useSortableItem(row.id);
  return <li ref={s.ref} style={s.style} className={`row ${s.className}`} {...s.props}>…</li>;
}
```

- `renderOverlay` draws the lifted copy; it floats in a portal, so a card's rounded clip never cuts it.
- Rows: the default `layout="rows"`; cards in a grid: `layout="grid"` with `lean={(id) => ({ rest, land })}` for their own tilt.
- `bounds="refuse"` keeps a row in its section (`data-sort-bounds`) and shakes it no; `"soft"` rubber-bands at the list's edges.
- Editors with a handle pass `grips` and put `<button data-grip ref={s.gripRef} {...s.gripProps} aria-label="Move …">` on it; the keyboard then moves a row from its grip (Space, arrows, Space).
- Save in `onMove` only: it runs once, on drop. `onPreview(draft | null)` follows the drag live.

## Accessibility

Ink on every palette color passes WCAG AA, and so does every text gray (4.5:1 or more on the canvas and on tiles). The lightest gray is kept for placeholders and decoration. Color dots carry a darker rim of their own hue so lemon still shows on gray. Visible focus rings, 44 px minimum touch targets on checks, and desktop shortcuts (`N`, `/`, `1–9` for the tabs).
