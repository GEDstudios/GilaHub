# 04 · Features

Legend: **●** in v1 (this build) · **◐** next (v1.1) · **○** later. Every feature traces to a numbered requirement from the brief.

## 0 · Simplicity & clarity: the rules every feature obeys

- **●** Onboarding is two light steps: your name and color, then the projects you want (four starters, or start empty). No account, no email, no tour.
- **●** A new item is a circle and a title. Details stay out of sight until the item is opened.
- **●** A bottom bar you arrange: **Today**, then up to three of your choice (Shopping, Chores, or any project), then **Projects**. Change it in Settings, or with "Show in bottom bar" on any project. It follows you across your own devices.
- **●** Adding happens inline, in a row at the end of each list. `N` opens the **New** composer on desktop.
- **●** Today links straight to what's due: tap a project tag or a project name to open it.
- **●** Quick add shows what it understood as chips. Tap a chip to undo it. **New** shows a live color card that says, in one sentence, what you're adding.
- **●** Inline controls: under every item, *Date · Repeat · Remind me · Who · Ours · Urgent* chips open their options in place. No forms.
- **●** No red, no badge spam, no streaks. Late items say "since Tue".
- **●** Nothing is imposed: every project, including shopping and chores, can be renamed, recolored, archived or deleted.

## 1 · Smart shared grocery list

- **●** One bar for adding *and* searching. As you type it filters what's on the list, then your history, then a built-in catalog of ~550 items in English and Hebrew.
- **●** No duplicates. An item already on the list is highlighted with **+1**. One you crossed off comes back with **Bring back**.
- **●** Quantities are optional and parsed in English and Hebrew: `2 milk`, `milk x2`, `500g cheese`, `1 ק"ג עגבניות`, `חצי קילו גבינה`.
- **●** Auto-aisles, ordered the way an Israeli supermarket is walked. Correct an item once and both phones remember it.
- **●** Priority means a single **Urgent** flag that pins the item to the top. Drag to reorder within an aisle.
- **●** Search matches across spelling variants (עגבניה / עגבנייה, with or without geresh or niqqud, final letters, plurals).
- **●** Paste a list from WhatsApp and it splits into items, each sorted into its aisle.
- **●** **Buy again**: at most 6 calm, dismissible suggestions. They're based on how often *you* buy things, appear only after two purchases, and never show during a trip.
- **●** **Shopping mode** turns on tall rows and keeps the screen awake. Checked items slide into **In the cart** with undo. Your partner's additions arrive live and highlighted, and **Finish** files the trip into history.
- **◐** Per-store aisle order, learned from the order you check things off.
- **○** Recipe → list, pantry, prices (deliberately left out; see Research).

## 2 · Shared house shopping list

- **●** A separate **Home shopping** list with its own departments (Kitchen, Bath, Tools, Electrical…).
- **●** The Shopping tab shows **Both** combined, or **Groceries** or **Home** alone. In Both, each item carries its list's bullet.
- **●** Adding from **Both** routes smartly: "light bulbs" goes to Home and "milk" goes to Groceries. A chip shows the destination, and you can tap it to switch.

## 3 · House chores

- **●** Repeats in plain words, including **days of the month** ("every month on the 1st and 15th", "last day of the month", "כל 1 ו-15 לחודש").
- **●** Two repeat types in plain words: **"Every N days after it's done"** and **"On set days"**. A new chore starts fresh: it first comes due one period from now, not today.
- **●** **Done** is always available, not only when a chore is due. Pick *Today*, *Yesterday*, or a date. An early tick on a set-days chore "counts for Thursday", and a late one collapses every missed occurrence into one, so chores never pile up.
- **●** **Not now**: Snooze (flexible chores), Skip this one (set days), or Pause (seasonal).
- **●** **Away mode** freezes every chore clock while you travel.
- **●** Owner per chore: **Me · Partner · Either · Take turns**. With Take turns, the turn moves only when the chore is done.
- **●** Freshness in words and a draining bar: *Fresh → Soon → Today → When you can*.
- **●** History of who did what and when. A one-tap **♡ thanks** on your partner's work, and no scores.

## 4 · Reminders & dates

- **●** One soft date (plus optional time) per item. It carries over quietly into **From earlier**, with one-tap *Today / Tomorrow / Someday / Let go*.
- **●** Reminders at the time, or 15 min / 1 h / 1 day before. Notification permission is asked only when you set your first reminder.
- **●** Repeating tasks ("Pay rent every month on the 1st") use the same two repeat types as chores.
- **●** Push notifications through your own relay. They're end-to-end encrypted, so the relay can't read them. Without a relay, reminders still fire while the app is open.
- **●** Natural language in English, plus basic Hebrew: `tomorrow 6pm`, `every sun`, `in 3 days`, `next week`, `5/12`, `מחר`, `בשישי`, `כל שבוע`.
- **◐** Optional daily summary, composed on the device (the relay never sees the content).

## 5 · Infinite subtasks, projects & lists

- **●** Items nest without limit. Opening an item drills into its own screen with a breadcrumb, so you never wade through deep indentation.
- **●** Progress like "3/5" on parents. Completing a parent asks whether to complete its steps too.
- **●** Unlimited projects, each with one of six colors (a new project gets one nobody's using) and a type (Tasks · Shopping · Chores). They sit like folders, each with a slight tilt.
- **●** Drag to reorder items, shopping items within an aisle, and project folders (long-press on phones). Move items between lists. Duplicate, archive, delete — all with undo.
- **●** **Uncheck all** for reusable checklists (packing, trips).
- **●** New project: a live color card you name in place, plus a few starters (Groceries, Home shopping, Chores, To do, Next trip, Gift ideas).
- **●** Global search across every list you can see.

## 6 · Private + shared, per list *and* per item

| Level | Who sees it | Who can change it | How it's protected |
|---|---|---|---|
| **Ours** | Both | Both | Household key (E2E) |
| **Mine** | Both | Both. It's mine, and my partner can see it and help. Only I can change who sees it, or delete the project | Household key (E2E) |
| **Only me** | Only me. My partner can't tell it exists | Only me | **Personal key, which never leaves my devices** |

- **●** Set on a list (it becomes the default for its items) and override on any single item. A surprise gift can hide inside the shared grocery list.
- **●** Steps inherit privacy from their parent.
- **●** Making an *Ours* item private asks once: "This will disappear for Hila."
- **●** "Only me" really is cryptographic. The partner's phone never receives the key, so it can't read the item even with full access to the relay.

## 7 · Gila Hub

- **●** A calm, light brand after Tasky by H3Y Lab: one color card per screen, inline chips, stacked strips, name-tag cursors, Newsreader and Figtree. See [Brand](02-BRAND.md).

## 8 · Extras we think you'll love

- **●** **Live "shopping now"**. When one of you starts a trip, the other sees *"Hila is shopping. Need anything?"* and anything added lands at the top of the shopper's list. Notifications for this can be switched off.
- **●** **Together card**: *"This week together: 23 things done."* One shared number. It never compares you.
- **●** **♡ Thanks** on anything your partner finished.
- **●** **"I'll take it"** on any unowned shared task.
- **●** **Requests**: set Who to your partner (or type `@hila`) and it's a request, tagged "Guy asked" on their rows. It lands under **Waiting on you** on their Today, dated or not (a dated one sits in Today itself). Turn on **Needs my OK when done** and their tick waits for you in Waiting on you (OK / Not yet); confirming credits them. What you asked shows as a quiet line, "You asked Hila for 2 things". Each step can notify the other phone. On your own, Who is a dashed "Ask your person" chip that leads to pairing.
- **●** **Make it theirs**: any item can be Ours, Mine, *Hila's* or Only me, and rows say so with a small tag whenever it differs from the project (an ink "Only me", "Mine" in your color, "Hila's" in hers). Theirs lands on their Today, under Waiting on you when it has no date. The rules live in `src/app/privacy.ts`.
- **●** **Project icons**: 26 line icons or any emoji, shown on the project's tile in the bottom bar and on its folder.
- **●** Works fully offline, with honest sync status. When a new version is published, a small "A new version is ready · Refresh" note appears.
- **●** One-tap **export** (JSON) and import. Your data is yours.
- **●** App badge for today's items (opt-in), haptics, and desktop keyboard shortcuts. Light only, on purpose.
- **◐** Share-sheet import (Android), Hebrew interface, month calendar, small item photos, import from Microsoft To Do (it retires June 2027), Todoist and Reminders.
- **○** Meal plan → groceries, household info card (Wi-Fi, landlord, plumber), shared expenses, home-screen widgets via a native shell.

## Deliberately *not* included

Points, streaks and leaderboards · AI chatbots · sponsored items · location tracking · partner-triggered nagging · accounts/emails/passwords · ads or analytics of any kind.
