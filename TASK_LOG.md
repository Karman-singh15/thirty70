# Task Log

A running record of work done on this project, in plain language.

---

## Set up PostgreSQL (persistent data) + Redis (live room state)

**Date:** 2026-08-15

**Task:** Replace the in-memory `Map` that was holding all room data with a real
persistence layer — Postgres for anything that needs to survive a restart
(users, rooms, problems, session history), Redis for fast-changing live state
(current code, presence, and turn/timer primitives for the upcoming turn system).

**Approach:** Confirmed Neon (Postgres) and Upstash (Redis) as the hosting
choice, then chose to fully migrate the existing room CRUD flow onto the new
stack rather than just scaffolding schema/clients unused.

**What changed:**
- Added a Drizzle Postgres schema (`lib/db/schema.ts`) with `users`, `problems`,
  `rooms`, `room_participants`, `sessions` (one row per problem attempt in a
  room), and `turns` (one row per player's turn — ready for the turn-based UI
  once it's built).
- Added a Drizzle client singleton (`lib/db/index.ts`) and `drizzle.config.ts`,
  plus `db:generate` / `db:push` / `db:migrate` / `db:studio` npm scripts.
- Added an `ioredis` client singleton (`lib/redis.ts`) and a helper module
  (`lib/roomState.ts`) covering live code/language, presence (10s heartbeat
  window), and turn order/current turn/timer deadline primitives.
- Rewrote `lib/rooms.ts` to read/write through Postgres (durable room,
  participant, and problem data) and Redis (live code + presence) instead of
  the in-memory `Map`. Selecting a new problem now closes out the previous
  session and opens a fresh one, so history accumulates in Postgres.
- Updated all five `/api/rooms/*` routes to `await` the now-async data layer.
- Added `.env.example` (committed) documenting the required env vars, and
  wired `DATABASE_URL` / `REDIS_URL` into `.env.local` (not committed).

**Not done (intentionally out of scope):** No turn-taking UI yet — no timer
bar, no "pass turn" button, no turn-gated read-only editor. The Redis/Postgres
primitives for it exist (`turnOrder`, `startTurn`, `advanceTurn`, `turns`
table) but nothing in the UI calls them yet.

---

## Run the Postgres/Redis migration + build the turn-taking UI

**Date:** 2026-08-15

**Task:** Apply the schema to the real Neon/Upstash instances now that
credentials were provided, then build the actual turn system described in the
product spec: a timer per turn, a "pass turn" button, and an editor that's
only writable by whoever currently holds the turn. Per your answers: turn
length is configurable and only the room owner (host) can change it.

**What changed:**
- Ran `db:generate` + `db:migrate` against Neon — `users`, `problems`,
  `rooms`, `room_participants`, `sessions`, `turns` tables now exist for
  real. Verified table creation and a basic Redis read/write directly
  against both services.
- Added `rooms.turn_duration_seconds` (default 120s, owner-editable) via a
  second migration.
- `lib/roomState.ts`: turns now track `turnStartedAt` (for accurate history)
  and a `tryClaimTurnTimeout` lock so multiple people polling at once can't
  double-advance a turn when it expires.
- `lib/rooms.ts`: `setRoomProblem` is now host-only, orders participants by
  join time, and immediately starts turn 1; `updateRoomCode` now rejects
  writes from anyone who isn't the current turn holder; added `passTurn`
  and `setTurnDuration` (host-only, 10s–3600s range). `getRoom` itself now
  auto-advances a turn whose clock ran out (see the perf fix below).
- New route `app/api/rooms/[id]/turn`: `POST` to pass your turn, `PATCH`
  (host-only) to change turn length.
- `app/api/rooms/[id]/sync` now checks for turn timeouts on every poll and
  returns the current turn/timer state alongside code and participants.
- New `components/TurnBar.tsx`: shows whose turn it is, a live mm:ss
  countdown, a "Pass turn" button for the active player, and an inline
  turn-length control for the host.
- `app/room/[id]/page.tsx`: editor is now `readOnly` for everyone except the
  current turn holder; problem search is hidden from non-hosts; picking a
  problem and setting its starter code now happens in one atomic request
  instead of two (needed so the starter code isn't itself blocked by the
  new turn gate).

**Verified:** Clean `tsc --noEmit` and `eslint` on all changed files (two
pre-existing lint warnings in `page.tsx`, unrelated to this change, were
left alone). Confirmed live connectivity to both Neon and Upstash directly.
Was not able to reliably smoke-test the full flow in a browser from this
environment (local dev server port binding behaved oddly in this sandbox,
unrelated to the app code) — worth clicking through manually with two
accounts before considering this done.

**Known limitations, not built:** no code runner/judge yet, so "attempt
fails → turn passes" isn't wired up (only manual pass and timeout rotate
the turn, as agreed). Turn order is fixed at problem-selection time — a
player who joins mid-session isn't inserted into the rotation. A player
who leaves mid-turn isn't skipped early; the turn just times out normally.

---

## Fix slow /sync polling (4.9s–10.3s per request)

**Date:** 2026-08-15

**Task:** You reported the dev server logging `/api/rooms/[id]/sync`
requests consistently taking 5-9 seconds. Diagnosed rather than guessed:
wrote a throwaway script hitting Neon/Upstash directly with the same
1.5s gap the UI polls at. Findings — the *very first* query after Neon's
compute had been idle took 9.4s (its free-tier autosuspend/cold-start,
not fixable from app code), but even "warm" queries were 400-800ms each,
and the sync route was making ~5-6 of those *sequentially* per request:
a standalone timeout check, then a room lookup, then a parallel batch
that still waited on the room lookup for owner/problem data, then two
separate presence writes (zadd, then a second round trip for expire).
That's what turned a couple hundred ms of real work into several seconds.

**What changed:**
- `lib/rooms.ts` — `getRoom` now fetches the room together with its owner
  and problem in one relational query (`with: { owner, problem }`), run in
  the same `Promise.all` as the participants query and the Redis reads,
  instead of fetching the room first and only then looking up owner/problem.
  The turn-timeout check that used to be a separate `checkAndHandleTimeout`
  call before every `getRoom` is now folded into `getRoom` itself, using the
  live state it already fetched — so every caller gets timeout handling for
  free, and the common case (no timeout) pays no extra round trip.
- `lib/roomState.ts` — every Redis write that used to be a `hset`/`zadd`
  followed by a separate `expire` call now goes through one `.pipeline()`,
  cutting each of those in half (one round trip instead of two).
- `app/api/rooms/[id]/sync/route.ts` — dropped the now-redundant
  `checkAndHandleTimeout` call.

**Verified:** wrote a script exercising the real `getRoom` +
`touchPresence` path (same functions the route calls) four times with
1.5s gaps, same as the UI's poll interval — landed at 650ms-1.1s per
call, down from the 4.9-10.3s you saw. Typecheck and lint stayed clean.
The first request after any period of inactivity will still be slow
(Neon waking up) — that's a property of the free-tier database, not
something the app can hide.
