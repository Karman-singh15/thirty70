# LeetDuel — collaborative LeetCode

Solve LeetCode problems together, one keyboard at a time. A room holds a
shared Monaco editor, a rotating turn timer, and everyone's mic and camera —
only whoever holds the turn can type, and when their time runs out the turn
moves on.

## How it works

Two stores, split by how often the data changes.

**Postgres (Neon)** owns the durable record: users, rooms, memberships, the
problem catalogue, and the session/turn history. Read through Drizzle, and
cached in Redis for 5 minutes (`room:<id>:meta`) because a Neon round trip is
~250-550ms and the room reads this on nearly every action.

**Redis (Upstash)** owns everything live: the shared document, the turn and
timer state, presence, mic/camera flags, and the WebRTC signaling queue. It's
also the pub/sub bus every room event travels on.

**One SSE connection per browser tab** (`/api/rooms/[id]/stream`) carries all
of it — the editor document, room state, judge results, and WebRTC signaling
multiplexed onto a single Redis subscriber. There is no polling anywhere.
Clients only ever POST; everything they read arrives pushed.

**The editor** is not driven by a React `value`. `useSharedEditor` owns the
Monaco model directly: local keystrokes go up as ranges, remote ranges are
patched in, and each write is a compare-and-set against a document version so
two people typing can't silently clobber each other.

**Audio/video** is full-mesh WebRTC, browser to browser. Only the handshake
touches the server. There is deliberately no TURN relay, so restrictive
networks will fail to connect — the tile says so rather than sitting blank.

**Run/Submit** goes through the `extension/` browser extension, which drives
the user's own logged-in LeetCode session in a background tab. The server
never sees a LeetCode credential; it only fans the result out to the room.

## Setup

```bash
npm install          # also vendors Monaco into public/monaco (see scripts/copy-monaco.mjs)
npm run db:migrate
npm run dev
```

### Environment

`.env.local`:

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Auth ([clerk.com](https://clerk.com)) |
| `DATABASE_URL` | Postgres. Use the **pooled** Neon string — `lib/db/index.ts` sets `prepare: false` for pgbouncer |
| `REDIS_URL` | Upstash `rediss://` URL |
| `NEXT_PUBLIC_APP_URL` | Public origin, used for checkout return URLs |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_PRO_PRODUCT_ID` | Billing |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` (default) or `live_mode` |
| `NEXT_PUBLIC_LEETCODE_EXTENSION_ID` | The unpacked extension's id — see `extension/README.md` |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/sweep-rooms`. **The route refuses to run without it** |

## Deployment notes

- **The SSE route is capped at 60s** (`maxDuration` in
  `app/api/rooms/[id]/stream/route.ts`), which is Vercel's Hobby ceiling. The
  stream is cut on that schedule and `EventSource` reconnects; every
  connection opens with a full snapshot, so a reconnect is also a resync.
  Raise it if you move to a plan with a longer limit.
- **Every reconnect costs a Redis connection**, since each tab gets its own
  subscriber. This is the main thing that will bite at scale — see
  `TASK_LOG.md` for the shared-subscriber plan.
- **Rooms are disbanded** five minutes after the last person disconnects, by
  whoever next reads the room. `/api/cron/sweep-rooms` (daily, `vercel.json`)
  is the backstop for rooms nobody ever reads again.
- **Room size** is capped at 4 (8 on Pro) by `lib/roomLimits.ts`. Full mesh
  doesn't hold up much past that without an SFU and a TURN relay; treat the
  Pro number as aspirational until those exist.

## Layout

```
app/
  (app)/                dashboard, competitive, settings — behind the sidebar layout
  room/[id]/            the room itself
  join/[code]/          invite-link handler
  api/
    rooms/[id]/stream   SSE: the one connection everything live rides on
    rooms/[id]/editor   the editor's write path (CAS + deltas)
    rooms/[id]/turn     pass, pause/resume, turn length, expiry
    rooms/[id]/judge    fans one client's Run/Submit out to the room
    rooms/[id]/signal   WebRTC signaling relay
    cron/sweep-rooms    daily abandoned-room sweep
    webhooks/dodo       subscription lifecycle
hooks/
  useSharedEditor       owns the Monaco model + the SSE connection
  useWebRTC             the peer mesh
lib/
  rooms.ts              durable room record (Postgres) + orchestration
  roomState.ts          live room state (Redis) + pub/sub
  editorDoc.ts          wire types, shared by client and server
extension/              the LeetCode bridge extension
```

`proxy.ts` is the Clerk middleware — Next 16 renamed the `middleware`
convention to `proxy`.
