# 07 · Today, the home page

What the home page is for, how it's read, and why it looks the way it does. Read with
[Brand](02-BRAND.md) and [Design system](03-DESIGN-SYSTEM.md).

## 1 · Who opens it, and why

Two people, mostly on a phone, many short visits a day. Each visit has one job:

| Moment | The question | How often |
|---|---|---|
| Morning glance | What do I have to do today? Anything left from before? | Daily, first |
| A ping | Does my person need something from me? (an ask, an OK) | Several a day |
| Doing | Tick it off, right here | Many a day |
| Capture | Add a thing before I forget | Many a day |
| Planning | What's coming this week? Is Saturday busy? | Weekly-ish |
| Us | What did my person do? How did our week go? | Now and then |

So the page answers, in this order: **what now → who's waiting → what's next → us**.
The first two must be answered in two seconds, without scrolling, every time.

## 2 · What was wrong (both earlier versions)

- **The loudest things were the least useful.** The colour strips ("5 done together",
  "Keep a moment") took the page's colour and space; the things to do were grey.
- **Things said twice.** A summary sentence counted the list right under it; project tags
  repeated the rows' own project names; "Waiting on you" was a second list of things to do.
- **Hiding what matters.** Late things were folded into "n from earlier"; Coming up showed one
  thing per wide tile, mostly off-screen.
- **Too many blocks of the same weight.** Six headed sections, a filter row, a summary: no
  clear first read. The second attempt made a dashboard (a big number) instead of a page.
- **Off-brand.** The brand's rule is *calm canvas, one colour moment*. Both broke it: one with
  colour everywhere, one with a generic lemon stat card.

## 3 · Principles for this page

1. **One list of things to do.** Asks, things from earlier and today's are all *things I have
   to do*: one list, in the order to do them. An ask wears its "Hila asked" tag; a late thing
   says "since Tue"; an OK I owe shows OK / Not yet. No second list.
2. **The card is the sentence.** One colour card, the brand's device (serif title, one plain
   sentence, a black badge), says the day in words: how many, what's next, what's late. It's in
   *my* colour: my day.
3. **My person is a name tag, not a section.** The brand's two-cursor name tag sits on the
   card's edge: "Hila asked 2", "Hila · on Shopping", or just "Hila". Their cursor is alive.
   It's the way to what they need from me.
4. **The week at a glance, opened in place.** Seven days as a strip of dates, dots for how
   full each is; tap a day and its things open right under it (inline, not a new screen).
5. **Us, quietly.** One grey tile: done together this week (the one shared number), what my
   person did since yesterday (a ♡ to thank), what I asked them, and a moment to keep.
6. **Nothing empty draws.** A block with nothing to say is gone; the page gets shorter, not
   emptier.
7. **Capture is everywhere already** (the + and N): the page doesn't repeat it.

## 4 · The page

```
Morning, Guy!                         (screen title, date under it)
┌──────────────────────────────── my colour ┐
│ 4 things today                        2/6 │  serif title · black badge: done/total
│ Call mom at 6 pm is next. 2 from earlier. │  one plain sentence
│                                    ╭─────╮│
│                              ↖ Hila asked 2  name tag on the edge, live cursor
└───────────────────────────────────────────┘
 All 6 · Me · Hila · Urgent · tags…           the lens (only when there's something to narrow)
 TODAY 6
 ┌ ○ Fix the kettle        To do · Hila asked ┐ asks, OKs, late and today's: one tile
 │ ○ Return the books      since Tue          │
 │ ○ Call mom              18:00              │
 └───────────────────────────────────────────┘
 THE WEEK
  Fri  Sat  Sun  Mon  Tue  Wed  Thu            dates in serif, dots for how many
  27•• 28•  29   30   1••• 2    3
 ┌ ○ Book the dentist                         ┐ the chosen day's things, in place
 └───────────────────────────────────────────┘
 ┌ grey ─────────────────────────────────────┐
 │ 5 done together this week  · You 3 · Hila 2│ Us
 │ Hila did: Water the plants ♡              │
 │ You asked Hila for 1 thing ›              │
 │ ✦ Keep a moment ›                         │
 └───────────────────────────────────────────┘
 Pinned projects…
 Edit Today
```

On a computer: the card and Today on the left (the doing), the week and Us on the right
(the looking), both in sight.

## 5 · Blocks (Edit Today)

`today` (always first; holds asks, OKs, late and today's), `upcoming` ("The week"), `week`
("Us" / "Your week"), and up to 3 pinned projects. The summary card is fixed above them.
