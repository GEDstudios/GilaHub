# 01 · Research

> What ~40 to-do, grocery, chore and couples apps teach us — and what Gila Hub does about it.
> Research done Nov 2026. Sources at the bottom.

## The short version

Every app in this space fails the same way: **it either does too little, or it does everything and makes you manage it.** The couples who stick with an app describe the same three feelings: *"I can see at a glance what needs doing"*, *"it never makes me feel guilty"*, and *"we never had to set it up"*. The apps people leave are the ones that charge for sharing, nag, keep score, or lose sync silently.

Gila Hub's whole strategy follows from that:

| Lesson from the market | Gila Hub's answer |
|---|---|
| Red overdue piles create "guilt and anxiety with a dash of existential dread" (Todoist's own words) | No red alarms. Late things wait calmly in **From earlier** with "since Tue". |
| Chore apps become "nagging someone else or parenting your partner" (MIT Technology Review) | No points, streaks or leaderboards. Credit goes to whoever did it. One-tap ♡ thanks. |
| Sharing is the #1 paywall (Sweepy, Tody, Todoist, Cozi, Splitwise) | Everything free, forever: you host it yourselves on a free tier. |
| Silent sync failure is the worst failure (Apple Reminders, Paired, To Do) | Local-first: works offline, merges field by field, always shows sync status. |
| Hebrew is unsupported by mainstream auto-sorting (Apple Reminders has no Hebrew) | Built-in bilingual catalog of ~650 items; Hebrew spelling variants match. |
| Onboarding asks for six things before your first task (Todoist) | One question: your name. The tutorial *is* a list you tick off. |
| No app offers per-item privacy inside a shared list | Three levels on every list and item: **Ours · Mine · Only me** (real encryption). |

---

## 1. To-do apps

| App | Worth stealing | Worth avoiding |
|---|---|---|
| **Things 3** | Calm. Missed dates quietly roll into Today — never "overdue". Details "tucked away until you need them". Starter project *is* the tutorial. | Apple-only, no sharing. |
| **Todoist** | Best natural-language quick add ("every Sunday", "#project", "@label"); "every" vs "every!" (fixed vs from-completion repeats). One-click Reschedule. | Onboarding friction; Pro price hike (Dec 2025); deadlines paywalled. |
| **TickTick** | Free shared lists for 2 people; "Plan your day" triage. | Feature soup, cluttered sidebar. |
| **Microsoft To Do** | My Day resets to a blank slate each morning. | Retiring June 2027; misreads dates ("food for April" — April was the cat). |
| **Apple Reminders** | Grocery lists auto-sort and remember corrections; @assign in shared lists. | Apple-only; no Hebrew sorting; one user got "20+ notifications in 10 minutes" from a partner adding items. |
| **Superlist** | Live shared lists, deep nesting, great UI. | Sync bugs; 5 shared lists on free. |
| **Any.do / OmniFocus / Structured** | Morning review rituals; defer dates. | Ad notifications, paywall at sign-up, steep learning curve. |

**Patterns that reduce overwhelm:** soft dates that carry over quietly; one-tap catch-up presented as normal; progressive disclosure (a new item is just a circle and a title); parsing that *highlights* what it understood so people learn by seeing; asking for notification permission only when someone sets their first reminder.

## 2. Shopping-list apps

| App | Worth stealing | Worth avoiding |
|---|---|---|
| **OurGroceries** | The simplicity benchmark: one household, crossed-off items sink to the bottom, a remembered "master list", no subscription. | An update wiped custom categories. |
| **AnyList** | Suggestions mark items that are already on the list; per-store aisle order. | Setup is "an absolute chore"; store order paywalled. |
| **Bring!** | Joyful item icons; a single **Urgent** label; one-tap partner messages ("going shopping"). | Sponsored products inside your list. |
| **Listonic** | Learns the order you check off aisles and reorders to match. | AI assistant you can't switch off. |
| **Apple Reminders** | Auto-aisles that learn from one correction. | Hebrew unsupported; notification floods. |
| **Sidecart (2025)** | "Partner started shopping" alert; paste a list from a chat. | iPhone only. |
| **Reshima, ListNest (Israel)** | Hebrew-first, sorted by supermarket department. | Small, single-platform. |

**What actually matters:** fast entry from *your own* history; never a duplicate ("Milk is already on the list — +1?"); categories that learn from one correction *for both partners*; trustworthy offline sync; a few meaningful partner alerts instead of one per item; forgiving check-off with undo.

**Gimmicks for a couple:** AI list generators, fridge photos, pantry/expiry tracking, price tracking, loyalty cards, location reminders, barcode scanning.

**Shopping mode done right:** checked items slide into a collapsed **In the cart** section (nothing deleted until **Finish**); tall full-width rows; screen stays awake; partner's additions appear live and highlighted; planning clutter (suggestions) hidden.

## 3. Household, chores & couples apps

**Scheduling models** (the core of requirement 3 — chores "markable outside of scheduled hours"):

- **Need-based** (Tody, Sweepy): "clean when it's needed, not when it's Tuesday" — a freshness meter drains from green to red; resets when done.
- **Fixed calendar** (OurHome, Flatastic, Skylight): good for bin night, bad for mess; rotations break when a chore is skipped.
- **Todoist's split** — `every` (calendar) vs `every!` (from completion) — proves people understand both if they're named plainly.

**Gila Hub adopts exactly two repeat types, in plain words:**

1. **"Every N days after it's done"** (default for cleaning) — next = the day it was done + N. Done early or late, the clock restarts that day.
2. **"On set days"** (bins, bills) — a completion counts for the nearest occurrence not yet done. Early → "Counts for Thursday"; late → missed ones collapse into one. **Never a pile-up.**

Plus: **Done** is available on every chore at all times (Today / Yesterday / pick a date); **Not now** = snooze, skip, or pause (seasonal); and a household **Away mode** that freezes every clock so you don't come home to a wall of overdue chores.

**Fairness without scorekeeping.** Research is clear that *perceived* fairness predicts relationship quality better than hours logged, and that leaderboards "create competition rather than cooperation". So: owners are **Mine / Yours / Either / Take turns**, either partner can complete anything, credit goes to whoever did it, nobody approves anyone's work, and the only "score" is a shared one ("This week together: 23 things ✓").

**Privacy models.** Cozi: none. TimeTree: per calendar. FamilyWall: per list. Honeydue: three levels per account *and* hide single transactions (for gifts). Nobody does per-item privacy inside shared lists — Gila Hub's three-level tag is genuinely new.

## 4. Technical feasibility (2026)

| Question | Finding | Consequence |
|---|---|---|
| Free + iPhone without the $99/yr Apple fee? | Only a web app. iOS 26 installs "Add to Home Screen" sites **as web apps by default**; push notifications and app badges work for home-screen web apps since iOS 16.4. | Gila Hub is an installable **PWA** — one codebase for iPhone, Android, Mac, Windows. |
| Free, private sync with no third party reading data? | Cloudflare Workers Free plan includes SQLite-backed Durable Objects (100k requests/day, 5 GB, 10 ms CPU per request) and free static hosting. | One Worker you own serves the app **and** a relay that only ever sees ciphertext. Two people use well under 1% of the free quota. |
| Will iOS delete local data? | The 7-day eviction applies to Safari, not home-screen web apps (they keep their own usage counter); persistent storage is granted heuristically to home-screen apps. | Request persistent storage; the relay is a backup anyway. |
| Haptics on iPhone? | No Vibration API; an `<input type=checkbox switch>` click produces a system haptic on iOS 18+ (may be patched in later releases). | Progressive enhancement: haptic tick on check-off where available. |
| Keep the screen on while shopping? | Screen Wake Lock API is supported in Safari 16.4+ and Chromium. | Shopping mode requests a wake lock. |

---

## Sources (selected)

**To-do apps** — [Things features](https://culturedcode.com/things/features/) · [Things: repeating to-dos refined (2026)](https://culturedcode.com/things/blog/2026/08/repeating-to-dos-refined/) · [Todoist: to-do list bankruptcy](https://todoist.com/inspiration/todo-list-bankruptcy) · [Todoist recurring dates](https://www.todoist.com/help/articles/complete-a-task-with-a-recurring-date-dmI6SVqdP) · [Todoist pricing update 2025](https://www.todoist.com/help/todoist/billing/todoist-pro-pricing-update-in-2025-bxBvHZuJZ) · [TickTick review (TidBITS)](https://tidbits.com/2025/08/14/ticktick-provides-a-focused-daily-task-list-and-more/) · [Microsoft To Do retirement (Windows Latest)](https://windowslatest.com/2026/11/19/microsoft-is-killing-to-do-and-telling-you-to-choose-another-app-after-it-reportedly-paid-up-to-200-million-for-wunderlist-and-killed-it-for-to-do) · [Reminders in iOS 26 (9to5Mac)](https://9to5mac.com/2025/10/13/heres-everything-new-in-reminders-with-ios-26/) · [Superlist review (TechRadar)](https://www.techradar.com/pro/superlist-review)

**Shopping apps** — [OurGroceries user guide](https://ourgroceries.com/user-guide) · [AnyList features](https://anylist.com/features) · [Bring! labels](https://getbring.com/blog-posts/new-labels-for-more-efficient-grocery-planning) · [Listonic suggestions](https://listonic.com/f/product-suggestions) · [Apple: grocery lists in Reminders](https://support.apple.com/105086) · [NerdWallet: best grocery list apps](https://www.nerdwallet.com/article/finance/best-grocery-list-apps) · [Apple Community: sync failures](https://discussions.apple.com/thread/255514220) · [Israel food price transparency law (Globes)](https://en.globes.co.il/en/article-israeli-retailers-must-publish-prices-on-internet-1000983383)

**Household & couples** — [Tody method](https://todyapp.com/method) · [Sweepy review (Apartment Therapy)](https://www.apartmenttherapy.com/sweepy-cleaning-app-review-37027260) · [MIT Technology Review: chore apps](https://www.technologyreview.com/2022/05/10/1051954/chore-apps/amp/) · [MIT Sloan: hacking inequality at home](https://sloanreview.mit.edu/article/hacking-inequality-at-home) · [Perceived fairness & relationship quality (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6426245) · [Honeydue privacy](https://support.honeydue.com/en/articles/3179542-will-my-partner-see-my-bank-account-balances-and-transactions) · [TimeTree visibility](https://support.timetreeapp.com/hc/en-us/articles/900002172746-Can-other-calendar-members-see-my-events) · [Cozi Gold](https://www.cozi.com/cozi-gold/)

**Technical** — [Durable Objects on the Workers Free plan](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier) · [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits) · [Web Push for Web Apps on iOS (WebKit)](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Badging for Home Screen Web Apps (WebKit)](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/) · [iOS PWA compatibility notes (firt.dev)](https://firt.dev/notes/pwa-ios/) · [iOS 26 web app changes (heise)](https://heise.de/-10749652) · [WebKit storage policy](https://webkit.org/?p=14403) · [HTML switch control (WebKit)](https://webkit.org/?p=15054)

**Design reference** — [MoMA: NYCTA Graphics Standards Manual](https://www.moma.org/collection/works/89303) · [Standards Manual reissue](https://standardsmanual.com/products/nyctacompactedition) · [AIGA: The (Mostly) True Story of Helvetica and the NYC Subway](https://gwern.net/doc/www/www.aiga.org/ee9fbb05bc37c056a78b174381125586cae4b7c7.html) · [Untapped Cities: 10 facts about the manual](https://untappedcities.com/10-fun-facts-about-the-nyc-transit-authority-graphics-standard)
