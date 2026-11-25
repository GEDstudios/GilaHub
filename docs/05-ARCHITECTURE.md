# 05 · Architecture

## Constraints → decisions

| Constraint | Decision |
|---|---|
| Completely free | No app-store fees. A **PWA** hosted on the **Cloudflare Workers free plan**, which you own. No paid services. |
| Private | **Local-first** data on each device, plus an **end-to-end encrypted** relay that only ever stores ciphertext. No accounts, no analytics, no third-party scripts, self-hosted fonts. |
| Cross-platform | One web codebase, installable on iPhone/iPad (Safari → Add to Home Screen), Android (Chrome → Install), Mac (Safari *Add to Dock* or Chrome) and Windows (Edge/Chrome → Install). |
| Two people, many devices | A household has 2 members (N supported), each with any number of devices. |

```
 Guy's phone ─┐                                       ┌─ Hila's phone
 Guy's Mac ───┤   WebSocket, ciphertext only          ├─ Hila's laptop
              ▼                                       ▼
        ┌───────────────── Cloudflare (your free account) ─────────────────┐
        │  Worker: serves the PWA (static assets) + /api                  │
        │  Durable Object "Household" (SQLite): encrypted op log,        │
        │     push subscriptions, encrypted reminder queue, alarm        │
        │  Durable Object "Invites": short-lived encrypted invites       │
        └─────────────────────────────────────────────────────────────────┘
              │ Web Push (VAPID, RFC 8291 encrypted)
              ▼
   Apple / Google / Mozilla push services → service worker decrypts → notification
```

## Client

- **Vite + React 19 + TypeScript.** No UI framework: a hand-built design system (`src/styles`).
- **Store (`src/core/store.ts`)**: an in-memory replica, persisted to IndexedDB.
  - Every entity is a map of fields, and **every field carries its own Hybrid Logical Clock** timestamp (`src/core/hlc.ts`).
  - Merge = keep the newest timestamp per field: deterministic, commutative, idempotent.
  - Two people editing different fields of one item never conflict. For the same field, the same winner is chosen on every device.
  - Deletes are tombstones. Ordering uses fractional index keys (`src/core/order.ts`), so a reorder touches one item.
- **Outbox**: every local write is queued as an op, so the app works offline indefinitely. Ops are sealed only at send time.
- **Domain layer (`src/core/actions.ts`)**: user intents (add, complete, move, set privacy, finish trip…) expressed as store writes.
- **Smart layer (`src/smart/`)**: quick-add parser, quantity parser, bilingual categorizer, recurrence engine, buy-again suggestions. All pure functions with unit tests and no network.
- **Service worker (`src/sw/sw.js`)**: precaches the app shell for offline use, receives push and decrypts it with the household or personal key from IndexedDB, and handles notification taps.

## Data model

| Table | Purpose |
|---|---|
| `member` | Name and line color per person. |
| `list` | Name, kind (`tasks` / `shopping` / `chores`), flavor (grocery / home), color, icon, owner, visibility, order. |
| `item` | Everything on a list. Nests via `parentId` without limit. Holds dates, repeat rule, owner, privacy, urgent flag, quantity, aisle. |
| `log` | Completions of repeating items and purchases (for history, ♡ thanks and buy-again). |
| `memory` | Learned aisle corrections per item name, shared by both partners. |
| `store` | (v1.1) Per-store aisle order. |

## Privacy model: scopes and keys

- **Household key** (32 random bytes). Shared by every device of both partners.
- **Personal key** (32 random bytes per member). Only on that member's devices.
- Every entity lives in a **scope**:
  - `h`: sealed with the household key.
  - `p:<member>`: sealed with that member's personal key.
  - Scope is derived from privacy: a private list, a private item, or any private ancestor puts the entity in the owner's personal scope.
- **Changing scope** (`Store.setScope`) does two things. It announces the move under the *old* scope, so devices that could see the item learn it left. Then it replays the full state under the *new* scope.
  - A device that can't read the new scope **purges** the entity and keeps only a marker, so stale ops can't resurrect it.
  - Making something shared again replays it under the household key.
- **Cipher**: AES-256-GCM with a random 96-bit IV per op. The associated data binds each ciphertext to `household | scope`.
- **Relay auth**: devices present `HKDF(householdKey, "gila-hub/auth")`. The relay stores only its SHA-256 and can never derive the key.
- **What the relay can see**: opaque blobs, sizes, timestamps, which scope (household vs. *whose* personal) each blob belongs to, push endpoints, and reminder fire times. **It cannot see** any list, item, name or note.

## Pairing (no accounts)

1. Guy taps **Invite Hila**. His device makes an 8-symbol code (`K7QM-2XPA`, ~40 bits) and stretches it with **PBKDF2-SHA-256 (210k iterations)** into an AES key *and* a lookup id.
2. It uploads `seal(invite, key)` under that id. Invites expire after 30 minutes and are deleted when claimed.
3. Hila types the code, or opens the link, inside her installed app. Her device derives the same id and key, fetches and opens the invite, and joins with her name and color.
4. **Partner invites** carry the household key only. **Add-my-device invites** also carry your personal key and member id.
5. The server-visible id comes from the same slow derivation, so the code can't be brute-forced from server data. Online guessing is bounded by expiry and the platform's request limits.

> iOS note: home-screen web apps have storage separate from Safari. That's why joining happens *inside the installed app*, by typing the code, rather than only through a link.

## Sync protocol (WebSocket, JSON)

```
client → {type:"hello", dev, member, cursor}
server → {type:"ops", ops:[{seq, k, c}], cursor, more}      // paginated backlog
client → {type:"pull", cursor}                              // next page while more=true
client → {type:"push", ops:[{cid, k, c}]}                   // sealed outbox entries
server → {type:"ack", acks:[[cid, seq]], cursor}            // sender
server → {type:"ops", ops:[…], cursor}                      // everyone else, live
client ↔ {type:"presence", state:"shopping"|null}           // ephemeral
```

- The relay only sends a device the scopes it may read (`h` + its member's personal scope).
- Pages are small (≤ 250 ops) to stay well inside the free plan's 10 ms CPU per invocation.
- WebSocket Hibernation keeps the Durable Object asleep between messages, so idle connections cost nothing.

## Reminders & push

- When an item with a reminder changes, the editing device upserts `{id, at, members, sealed payload}` to the relay and schedules the next few occurrences of repeating items.
- The Durable Object sets an **alarm** for the earliest reminder. On alarm it sends **Web Push** with a VAPID JWT (ES256). The payload is encrypted per RFC 8291 (`aes128gcm`), verified against the RFC's published test vector.
- VAPID keys are generated by the Durable Object on first use, so there is nothing to configure.
- The service worker opens the app-level sealed payload with the key in IndexedDB, then shows the notification. Push services and the relay see only ciphertext.
- **Shopping presence** notifications ("Hila is shopping") are opt-out per device.

## Deploy (free)

```
npm install
npx wrangler login        # opens the browser once
npm run deploy            # vite build + wrangler deploy
```

This gives you `https://gila-hub.<you>.workers.dev`. Open it on each device and install it. A GitHub Action (`.github/workflows/deploy.yml`) can deploy on every push to `main` once you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets.

**Free plan headroom** for two people: roughly 1–3k requests/day against a 100k limit, and a few MB of storage against 5 GB.

## Testing

- **Unit (Vitest)**: store convergence and privacy transitions, HLC, order keys, crypto, invite derivation, recurrence rules (early/late/collapse), quick-add parser (EN/HE), quantity parser, categorizer, buy-again.
- **Web Push**: RFC 8291 Appendix A test vector.
- **End-to-end (Playwright)**: two browser contexts (Guy & Hila) against `wrangler dev`. They pair, add items, see live sync, and confirm "Only me" items never reach the partner.
- **Visual**: screenshots at phone and desktop widths in light and dark.
