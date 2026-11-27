# 03 · Design system

Tokens live in [`src/styles/tokens.css`](../src/styles/tokens.css). The visual language follows Tasky by H3Y Lab (see [Brand](02-BRAND.md)).

## Principles

1. **Calm canvas, one color moment.** Screens are near-white and soft gray. Color is reserved for the card that says *which project*: never for alarms, never on every row.
2. **Inline, not forms.** You change things where they are. Chips under a card open their options in place. Adding happens in a row after the open items, or with New.
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
| **Header** | Quiet top row (a 42 px gray circle for back and actions, or your avatar), then a serif title. On scroll, a frosted bar keeps the name. Every tab's title sits at the same height. The right slot holds at most one gray button and then **New**, the black "+" (always rightmost). |
| **Color card** | Radius 24–30, the project color, serif title top-left, a sentence bottom-left, an optional black badge top-right. On an item's or a project's page it's the hero, and its title is edited in place (tap it, type, Enter). |
| **Project page** | The hero, then "Want to modify something?" and *Color · Icon · Ours · In bar* chips, each opening its panel in place ([`ProjectFields`](../src/app/components/ProjectFields.tsx), the same chips as New project, which adds *Kind*). *In bar* is a toggle: lit in my color when the project is in the bottom bar. The "…" keeps only the rare things: Uncheck all, Archive, and Delete project in red, last. |
| **Rows** | One gray tile (radius 20) per group, rows 58 px with hairline dividers. A thin 24 px check ring; done fills with the project color. Done rows are struck through in gray. |
| **Add row** | One component (`AddRow`) in every list: a dashed plus, the input, and a black arrow once there's text. It sits after the open rows and before Done (Shopping pins it at the top, where it also filters). On focus it lifts into a white card and opens a row of small chips: who sees it always, plus *Every week* and *Who* for chores. What it understood from your words shows as tokens. |
| **Labels** | Everything that labels a block reads the same: section titles, aisle names, "Want to modify something?" (the one prompt above chips, on items, projects, the composer and my card in Settings). 14 px, medium, `text-2`, 2 px in from the card's edge, a count in `text-3` beside it. |
| **Chips** | 38 px gray pills: gray text when unset, ink when set, black when open (its icon lit in my color). Urgent is lemon, with a lightning icon. A toggle chip with no panel (*In bar*) lights its icon when on and says so with `aria-pressed`. A dashed ghost chip is an invitation, not a setting ("Ask your person" while on your own). A quantity stepper sits among chips at their height. |
| **Panel** | Opens under the whole chip row, full width: white, radius 22, soft shadow, with 36 px option pills (the chosen one is black) and at most one quiet line of explanation. |
| **Row tags** | 22 px word pills in a row's meta (`ui/tags.tsx`): lemon **Urgent** with its lightning (in the trail); **whose** only when it differs from the project: an ink "Only me" with a lock, "Mine" in my soft color, "Hila's" in hers, "Ours" in gray inside a Mine project; **who asked whom** in the other person's soft color with Tasky's cursor ("Hila asked", "Asked Hila", "Hila did it · OK?"). The row's avatar is the doer, never the owner. |
| **Strips** | Overlapping bands (−16 px) with a big serif number and a small label. The one colour moment on Today. |
| **Summary** | Today's gray tile (radius 26): one sentence ("You have 4 things to tackle today", "All done for today. Enjoy it.") and overlapping tags that sit beside it when they fit and drop below when they don't. Up to 3 project tags, or 2 plus a **person tag** in the partner's color with Tasky's cursor, which jumps to Waiting on you. |
| **Quiet line** | A 44 px text row under a tile for a follow-up that would otherwise be a section: "You asked Hila for 2 things", "4 from earlier · Show". A chevron on the right turns when open. |
| **Ahead tiles** | Coming up as Tasky's horizontal tiles (140 × 124, radius 20, gray): the day (short: "Fri · 09:30") with a lightning chip when urgent, a two-line title, the project tag at the bottom. No check: it's a glance. They end in a hatched 72 px slot with a white "+" circle ("Plan something", for tomorrow). The row bleeds to the screen edges and snaps. |
| **Arranger** | One editor for "what goes where" ([`Arranger`](../src/app/components/Arranger.tsx)): Edit Today and the bottom bar in Settings. Locked anchors are outlined with a small lock and shake when tapped (Summary "Always first"; Today "Always first", Projects "Always last"); slots are 66 px gray tiles: mark, title, one-line live preview, × to hide, a grip to drag (or hold the slot on touch). Then "Add to …" with tokens to bring things back, each led by its mark with a quiet + after it (one can open a white panel of choices), and a quiet "Back to the default" once something changed. Hidden slots fold away; returning ones flash lemon. |
| **Settings** | One calm page ([`Settings.tsx`](../src/app/screens/Settings.tsx)) where everything changes in place: my color card (the name is the serif title, edited in place; a black sync pill; one line about us; my person's name tag on its edge, or a white "Your person?" tag), then *Color · Name · Add a device* chips. The bottom bar on a gray stage, the real bar's markup ([`TabBarView`](../src/app/components/TabBarView.tsx)) following a drag as it happens, above its arranger; the preview scrubs like the real bar (hold and slide; letting go flashes that tab's row), and past 5 tabs a quiet line says so. The tray of + tokens sits right under the rows, under a quiet label. Then the Today page arranger and grouped rows: one plain line under each, a chevron on rows that open something, a separate group for Reset. The update pill says what it found and never reloads by itself. |
| **Tab bar** | A floating white bar ([`TabBarView`](../src/app/components/TabBarView.tsx)): Today, your pins, Projects, no central button and no limit. A soft gray pill marks the active tab. Up to 5 tabs show icon and label; 6–7 show icons only and the active one rises to show its name; 8 or more dock: Today and Projects stay put around a middle that scrolls sideways, fades at its edges and keeps the active tab centered. Hidden on Settings, which previews it. On desktop, a light sidebar with a black "New" pill lists the same tabs, then the projects not pinned there; brand, New and Settings stay put and only the middle scrolls. A new project gets an icon from its name (Rome: a suitcase, Garden: a plant) and a color its neighbours don't have, so a crowded bar stays readable. |
| **Sheets** | Bottom sheets with radius 30 and a serif title. They're used for "New", the "…" menus and a shopping item. Never a sheet on a sheet: a choice inside a sheet opens as an inline panel (the shopping item's *Aisle* and *List* chips too). Pull one down by its handle or title, or by its body once it's scrolled to the top: the scrim fades with the finger, a pull past 28% of its height (140 px at most) or a flick closes it, anything less springs back. Pulled up, it gives 24 px at most. |
| **Ideas tag** | One small paper tag ([`Ideas.tsx`](../src/app/components/Ideas.tsx)), drawn once by the app shell: white, 23 px showing, its left end cut to a point with a punched hole, a 16 px bulb and the open count, leaning −4° and straightening with a spring under the finger. It sits in the header just right of the avatar (or Back), on every screen and over the compact header too, so it never covers rows and nothing at the bottom makes room for it; on desktop it sits in the corner. Its button is a 44 px square around the paper. A 10 px dot in the partner's color means they added or edited an idea since this device last opened the sheet. It steps aside while a sheet is open or the keyboard is up. The sheet: an add row with a growing textarea (Enter adds, Shift+Enter breaks the line), then rows `[author dot][text · meta][check][grip]` (tap the text to edit in place), **Resolved** folded, and a quiet "Copy open ideas". |
| **Toasts** | A black pill above the tab bar with at most one lemon action (Undo). At most two show; the older steps aside. Toasts of one kind fold into one while it shows ("3 done", "3 in the cart") and its Undo undoes them all, newest first. Swipe one sideways to send it away; a finger on it keeps it. They sit above anything floating on the bar (the shopbar sets `--float-h`), lower where there's no bar (Settings), and at the top while you type in a field near the bottom. In the store the shopbar itself says what went in the cart, with Undo, instead of a toast. |
| **Shopping** | A card per aisle, the aisle's glyph and name above it. Urgent things get the screen's one lemon card, its serif title and count inside it, read in walking order (it isn't arranged; the aisles are), and keep a lemon *Urgent* tag in their own aisle. Every aisle and home department has a glyph. A ticked row strikes and folds in its aisle, then joins **In the cart**. The floating shopbar is *Start shopping*, or in the store "n left · n in the cart" with the one **Finish**; a tick briefly turns it into "milk is in the cart · Undo" (no separate toast), and it steps aside while the bar is held; outside the store, Finish trip is a quiet button under the cart. |

### Adding

Every screen that holds things has exactly two adds ([`addAction.ts`](../src/app/addAction.ts), [`QuickAdd.tsx`](../src/app/components/QuickAdd.tsx)):

1. **New**: the black "+" (`NewButton`), rightmost in the header. It opens a sheet already pointed at where you are: the composer (Today: due today; a project: that project; Shopping: the list the item belongs on; Chores: a chore), or New project on Projects. The `N` key and the sidebar's New do the same thing.
2. **In place**: the add row, or the dashed tile on the Projects grid.

**The composer** (Tasky's "New task"): one sentence to type, a live color card of what you're adding (for shopping, its aisle), then "Want to modify something?" chips: *List · Date · Repeat · Remind · Who · Ours · Urgent* for tasks, *List · Repeat · Who · Ours* for chores, *List · Urgent · Ours* for shopping. A chip always wins over the words; the words it overrides go back to being plain text. Add closes the sheet, says "Added to To do", and the new row glows sky blue where you can see it.

**Empty lists** show only the add row, with up to four gray tokens to add in one tap where it helps (chores: Dishes, Laundry, Bins, Sheets; shopping: what you often buy). The big serif line is kept for "gone" and "not found".

### The building blocks

Every recurring piece of UI is one component, and every screen uses it rather than its own copy.

| Need | Component (file) | Notes |
|---|---|---|
| Choose where something goes: a folder, or a task in one | `PlaceTree` ([`components/PlaceTree.tsx`](../src/app/components/PlaceTree.tsx)) | Folders fold, tasks and subtasks unfold, a long press opens, a search field on top, a faint line per level. Move, Also in, a filtered list's folder, a folder on Today, Show tasks from…, the composer's place. |
| On/off with a label | `SwitchRow` ([`components/pickers.tsx`](../src/app/components/pickers.tsx)) | The whole row flips the `Switch`. `panel` for the quieter size inside an editor. |
| One of a few, inline | `Seg` (raised pill), `Options` (wrapping pills) | |
| − n + | `Stepper` ([`ui/primitives.tsx`](../src/app/ui/primitives.tsx)) | `nullable` goes below its lowest to "off"; `size` sm, `look` tile / card / bare, `tone` low / out. |
| Keep it on Today | `StarButton` | A task's Highlights and a folder's block on Today: one star, one sound, one undo. |
| A round glyph button | `IconButton` | `pressed`, `disabled`, `small`. |
| A "…" menu | `ActionSheet` | Closes, then runs the action. Whatever deletes goes last and is `danger`. |
| A sheet's answers | `Choices` | Stacked, or side by side (`row`). |
| How things are said | [`app/labels.ts`](../src/app/labels.ts) | Names, who does it, when, how it repeats, when it notifies. |
| What a glyph means | [`ui/glyphs.ts`](../src/app/ui/glyphs.ts) | `G.subtask`, `G.close`, `G.highlight`…: components name the meaning, never a raw glyph. `G_TEXT` for notification titles. |

### Component families

One job per family.

| Family | Only job | Size | Examples |
|---|---|---|---|
| `.btn` / `.btn--quiet` | Commit an action / secondary action | 54, 40 with `--sm` | Add, Finish, Bring them in |
| `.iconbtn` | Header and sheet chrome, always gray (`IconButton`) | 42, 36 with `--sm` | Search, …, Back, Close, the star |
| `.echip` | A property of the thing; opens an inline panel | 38 (34 in the add row) | Date, Repeat, Who, Ours, Urgent, List |
| `.option` | A choice inside a panel or sheet | 36 | Ours / Mine / Only me, Every week |
| `.token` | A suggestion or parsed result to tap (add, keep, drop) | 34 | "Sunday ×", Dishes, Buy again, templates |
| `.mini` | An in-row action on a tile | 30 | OK / Not yet, Today / Tomorrow, Restore |
| `.textbtn` | A disclosure or low-emphasis link | — | Show / Hide, Edit Today, Invite your person |
| `.urgent` `.vtag` `.rtag` (+ project `.tag`) | Read-only status | 22 (project tag 30) | Urgent, Mine, Hila asked |

- Nothing but New is a black circle. Dashed borders mean "create or bring in", and nothing else: the add row's plus, the New project tile, the invite card and the ghost Who chip.
- **Disclosure** (`Disclosure` in [`primitives.tsx`](../src/app/ui/primitives.tsx)): a section title with its count, and "Show" / "Hide" on the right. In the cart, Done, Paused and Archived all fold this way. ("n from earlier" on Today is a quiet line instead, because it lives inside the Today block.)
- **"…" menus** hold only rare or destructive things. Whatever deletes or removes goes last and is red (`OptRow danger`, `--danger`): Delete, Delete project, Remove from list, Reset this device.
- **One Finish.** The shopbar's in the store; a quiet button under the cart otherwise.
- **Same words for the same thing** (`app/labels.ts`): a date and time read "Fri 4 Dec · 17:00" in a row, a chip and a notification, and "Fri 4 Dec at 17:00" in a sentence; the sync dot has one set of titles wherever it shows.

## Icons — Gila Duo

Every icon is an **ink line** and a solid **light** behind it, drawn from Phosphor Duotone (MIT, see [THIRD-PARTY](THIRD-PARTY.md)) on a 256 grid. The light rests as a faint ink tint and switches on, in your color, for the one thing that is on. Guy's icons light lemon, Hila's light pink.

| State | Line | Light | Offset |
|---|---|---|---|
| Rest | text-3 in chips and tabs, text-2 in rows | ink 7% | 0 |
| Set (has a value) | ink | ink 7% | 0 |
| **Lit**: active tab or nav item, open chip, picked option, chosen picker cell | ink (canvas on ink) | `--me-light` (my color) | 1.25 px down-right, springs in over 280 ms |
| Project identity (lists, sidebar, bar editor) | ink | the project's color | 0 |
| Project in the tab bar or sidebar, inactive | text-3 | the project's color at 45% | 0 |
| On color (folder cards, the urgent chip and tag, emoji tiles) | ink | ink 12% | never |
| On ink (New, toasts) | canvas | canvas 16% | 0 |
| Whose (`mine`, `theirs`, `heart-fill`) | as context | mine, my partner's color, pink: always | follows state |
| Control (plus, check, x, chevrons, arrows, more, grip, undo, refresh) | as context | none: the button is the light | n/a |

- **One lit per group.** Only the active tab, the open chip, the picked option or the chosen icon cell lights up. Chips that merely have a value, and settings rows whose switch is on, stay at rest.
- **Controls are line only.** Their button is the light.
- **No light-only signals.** Lemon on white is about 1.1:1, so "on" also changes the line color, the label weight and `aria-current` / `aria-pressed`.
- **The offset appears only when lit** (and grows to 2.5 px while a row is lifted, `.is-lifted`).
- **Privacy family:** Ours is two overlapping circles whose shared lens is the light; Mine fills my circle in my color; my partner's fills theirs in their color; Only me is a lock.
- **Sizes** are set with `--s` (px), never width/height: 24 tab bar and folder cards · 22 default (icon buttons) · 20 sidebar, settings rows, icon picker, aisle headers · 18 chips and options (`.icon--sm`) · 16 the Ideas tag · 15 meta and tokens (`.icon--xs`) · 14 card lock and the urgent tag · 13 add-row plus and token ×. Never above 28 px: the line gets too heavy.
- **One meaning, one glyph.** Components use [`G`](../src/app/ui/glyphs.ts) (`<Icon name={G.subtask} />`), never a raw glyph name, so the same idea always looks the same and no glyph means two things (the star is "keep it on Today", for a task and a folder alike; the To-Do folder's mark is a tick).
- **Adding an icon:** add one row to `MAP` in [`scripts/build-glyphs.mjs`](../scripts/build-glyphs.mjs) (our own drawings go in as `['custom', [light, line]]`) and run `npm run glyphs`, then give it a meaning in `G`. Never hand-edit `src/app/ui/icons.gen.ts`. `lit` lights it when no parent state does.

## Scales

Every value comes from one scale; [`tests/unit/tokens.test.ts`](../tests/unit/tokens.test.ts) fails when a stylesheet steps off one.

- **Space** (padding, margin, gap): 2 4 6 8 10 12 14 16 20 24 28 32 36 40 48 56 64. Stacking blocks use `--space-1…5` (8 12 16 24 36). The page gutter is 24.
- **Radius**: 2 4 6 8 10 12 14 16 18 20 22 24 28 30 32 36 40, 50% and 999px for round.
- **Type**: whole pixels; 11–18 for what you read, the serif larger. A field you type into is at least 16 px (a phone zooms in on smaller ones).
- **Stacking** (`--z-*` in tokens.css): raised 20 · band 30 · fab 35 · bar 40 · sheet 60 · search 70 · toast 80 · drag 200 · effects and the cursor on top.
- **Feel** ([`ui/tokens.ts`](../src/app/ui/tokens.ts), mirrored in tokens.css): `HOLD.press` 350 ms is every press-and-hold (a row, a subtask, a note, a group, a tree row); `HOLD.handle` 120 ms a grip; `HOLD.bar` 240 ms the tab bar's scrub. `SLOP` says how far a pointer may wander; `DUR`, `EASE` and `TOAST` the timings; `calm()` is reduced motion. [`ui/pointer.ts`](../src/app/ui/pointer.ts) is the one place that asks what the device points with.

The styles are one family per file: [`styles/components/`](../src/styles/components) and [`styles/screens/`](../src/styles/screens), imported in cascade order by `components.css` and `screens.css`; tokens in `tokens.css`; the computer layout in `desktop.css`.

## Motion

140–320 ms with `cubic-bezier(.2,.8,.2,1)`. A spring on checks, switches and swatches. `prefers-reduced-motion` turns movement off.

- **Drag to reorder** is one component, [`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx), for rows, steps, aisles, folders and the Settings arrangers. A long-press (`HOLD.press`, so an unhurried tap still opens the row) lifts a row on a phone; a grip starts after 4 px with a mouse. The lifted copy floats above everything at 1.035×, leans 1.5° and tilts up to ±3° with the finger's speed, with a deep shadow (`--lift-3`). Folders keep their own tilt and add 3°. The spot it left is a dashed slot; neighbours slide over 260 ms with a little overshoot, and the drop glides home in 320 ms with a small landing beat. A shopping row stays in its aisle: pull it out and the aisle shakes no.
- **Where a drag lands** ([`ui/dropMark.ts`](../src/app/ui/dropMark.ts), drag.css "Landing"; where, [`app/outline.ts`](../src/app/outline.ts)) is said the same way by every drag, in darkened gray only, never a person's or folder's color. What it goes into darkens (`--drop-fill`: a task, a group, a folder card, a step of the path, a tab). Among rows, they part and a gray gap opens right where it lands, at that level's indent; where it came from stays a dashed slot. Tasks and subtasks move outliner style, and one drag both nests and places: over a subtask's upper or lower half, the gap opens before or after it (a task dragged there becomes a subtask, right there); over a task's middle, it goes under it at the end, and a task with folded subtasks unfolds after a moment so it can go among them; pulled right (`DIST.nest`, from where the drag began), under the one above; pulled left, out of its task, right after it (on the gap too). A pull holds until the hand moves up or down. A subtask dragged out of a folder list settles into the gap (a preview); a task in the hand shows a chip (↳ under a task, ⇱ out on its own). On a task's page, pulling a subtask left takes it out (its step of the path darkens). Escape puts a drag back.
- **Ticking** ([`ui/useSettle.ts`](../src/app/ui/useSettle.ts)): the ring pops, the tick draws itself, a line strikes the title, and the row folds away after about half a second. The data changes at once; only the row waits.
- **Hold and slide** ([`TabBar.tsx`](../src/app/components/TabBar.tsx)): hold the bar still for 240 ms and slide. The tab under the finger lights up, swells with its neighbours (`--d`) and is named in a black bubble; letting go goes there, lifting the finger 72 px above the bar cancels. Rest past the outermost tab in view (or in the edge fade) for 300 ms and the dock steps one tab, then another every 230 ms, so the edge tab itself can always be picked. The Settings preview scrubs the same way. A tap is still instant and a quick swipe still scrolls the dock. The first time the bar holds 6 or more, it says so once: "Hold and slide to pick".
- **Sheets and toasts** follow the finger ([`ui/overlays.tsx`](../src/app/ui/overlays.tsx), the math in [`ui/motion.ts`](../src/app/ui/motion.ts)): a sheet pulled short springs back over 420 ms with `cubic-bezier(.34,1.4,.64,1)`; a toast swiped past 64 px (or flicked) flies off. A folded toast pops once more.
- **Haptics** ([`ui/haptics.ts`](../src/app/ui/haptics.ts)): `haptic('select' | 'tick' | 'lift' | 'drop' | 'success' | 'warn')`, off with the device's Vibration switch in Settings (phones and tablets only).
- With reduced motion there is no tilt, scale or overshoot; the shadow and the slot stay. The bar's pill doesn't slide and nothing swells while scrubbing.

### Drag recipe

To make a new list reorderable, wrap it in `Sortable` and let each item call `useSortableItem` ([`ui/Sortable.tsx`](../src/app/ui/Sortable.tsx); `Children.tsx` is the simplest example):

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
- Save in `onMove` only: it runs once, on drop. `onPreview(draft | null)` follows the drag live, for a preview like the Settings bar.

## Accessibility

Ink on every palette color passes WCAG AA, and so does every text gray (4.5:1 or more on the canvas and on tiles). The lightest gray is kept for placeholders and decoration. Color dots carry a darker rim of their own hue so lemon still shows on gray. Visible focus rings, 44 px minimum touch targets on checks, and desktop shortcuts (`N`, `/`, `1–9` for the tabs).
