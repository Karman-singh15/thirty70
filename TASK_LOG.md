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

---

## Room UI pass: participant visibility, mic/camera groundwork, visual redesign

**Date:** 2026-08-15

**Task:** You asked for three things: confirm turn-gating (only the
current player can edit) actually works, make it possible to see who's
joined, add mic/camera controls, and make the whole room UI read as more
professional/minimal rather than a generic AI-generated first draft.
Checked turn-gating first — it was already correct (`readOnly` in
`page.tsx` ties to `currentTurnUserId`, fails safe while auth loads) —
so no fix needed there.

For mic/camera, you confirmed (asked directly, since it's a real infra
decision): UI groundwork now, not full peer-to-peer calls — real browser
permission requests and a local self-preview, with on/off state shared
with the room, but audio/video isn't sent to other participants yet
(that needs a signaling channel, same category of work as the websockets
you're deferring).

**What changed:**
- `lib/roomState.ts` — added `setMediaState`/`getMediaState`: two Redis
  sets (`mic On`/`camera On`) per room, same pattern as presence.
  `removePresence` now also clears a departing user from both.
- New `app/api/rooms/[id]/media` route — `POST {mic?, camera?}`, member-
  only, just writes the on/off flag.
- `app/api/rooms/[id]/sync` — now also returns `onlineUserIds` (real
  presence, not just static membership), `micOn`, `cameraOn`, fetched in
  the same parallel batch as everything else (no new round trips added).
- New `components/MediaControls.tsx` — mic/camera toggle buttons that
  call real `getUserMedia`, show a small local camera preview, and report
  on/off state up to the room.
- `components/ParticipantsList.tsx` reworked: overlapping avatar stack
  (was spaced-out circles), a real online/offline presence dot per person
  instead of a static "N online" count, an emerald ring on anyone with
  their camera on, and a small mic badge on anyone unmuted.
- New `components/RoomHeader.tsx` — consolidated what used to be two
  separate stacked bars (name+participants, then a permanently-open
  invite-URL bar) into one toolbar: back button, room name, media
  controls, participants, invite.
- `components/InviteLink.tsx` — was a persistent full-width bar showing
  the raw URL; now a single icon button that copies on click.
- `components/TurnBar.tsx` — tightened spacing and type, current player
  now shown with their avatar instead of just a name, timer chip uses
  tabular numerals, and the owner's turn-length control is now a preset
  dropdown (30s/1m/1.5m/2m/3m/5m/10m) with a "Custom…" option that reveals
  a plain number input — replaces the always-visible raw number input.

**Verified:** clean `tsc --noEmit` and `eslint` on every changed file —
no new violations (the two pre-existing `page.tsx` warnings from the
first Postgres/Redis pass are still there, untouched, not something this
pass introduced).

**Known limitation:** mic/camera are honestly local-only right now — the
icons and preview are real (your browser's mic/camera indicator will
light up), but no audio or video reaches other participants. That's
explicitly deferred until there's a signaling channel, alongside the
websockets work.

---

## Google Meet-style layout: 70% problem/editor, 30% video tiles

**Date:** 2026-08-15

**Task:** You asked for a Google Meet vibe — the problem+editor area
taking ~70% of the room, with the rest as a column of participant
boxes showing their camera if it's on.

**What changed:**
- New `hooks/useLocalMedia.ts` — pulled the mic/camera `getUserMedia`
  logic out of `MediaControls` so the raw camera `MediaStream` can be
  shared with more than one place on the page (the header toggle and
  the new video tile) instead of being trapped inside one component.
- `components/MediaControls.tsx` — now a plain controlled component
  (props: `micOn`/`cameraOn`/`error`/`onToggleMic`/`onToggleCamera`)
  instead of owning the stream itself; dropped its old inline preview
  thumbnail since the real tile now lives in the new side panel.
- New `components/VideoTile.tsx` — a single Meet-style tile: live
  video for your own camera (mirrored), an avatar placeholder for
  everyone else (no signaling channel yet, so remote camera-on just
  shows "Camera on" over their avatar rather than a real feed), a
  mic on/off badge, name label, and a dimmed "Offline" state.
- New `components/ParticipantsPanel.tsx` — vertical scrollable stack
  of `VideoTile`s for every participant, self included.
- `app/room/[id]/page.tsx` — main content row restructured from a
  flat `[problem 45%][editor rest]` split into `[70% problem+editor
  wrapper][30% ParticipantsPanel]`; now owns `useLocalMedia` directly
  and passes both the toggle handlers and the camera stream down to
  `RoomHeader`/`ParticipantsPanel`.
- `components/RoomHeader.tsx` — updated to the new controlled
  `MediaControls` prop shape (`myMicOn`/`myCameraOn`/`mediaError`/
  `onToggleMic`/`onToggleCamera`) instead of the old
  `onMicChange`/`onCameraChange` callback pair.

**Verified:** clean `tsc --noEmit`; `eslint` clean on every new/changed
file (the two pre-existing `page.tsx` warnings from earlier passes are
still there, untouched). Booted the dev server and confirmed it starts
and compiles with no runtime errors. Could not click through the actual
room UI in a browser from this sandbox — `/room/[id]` redirects to
Clerk sign-in before the page renders, and no session is available
here — so the visual layout (proportions, tile sizing, mirrored self
video) is worth a manual look before calling this fully done.

---

## Make the three room panes resizable by drag

**Date:** 2026-08-15

**Task:** Follow-up to the Meet-style layout — you wanted to be able to
resize the panels yourself instead of being locked to the 70/30 split.

**What changed:**
- New `components/ResizeHandle.tsx` — a thin draggable divider (pointer
  events, not mouse events, so it works with trackpad/touch too) that
  reports raw `deltaX` to whoever renders it; the caller decides which
  panel grows/shrinks and by how much.
- `app/room/[id]/page.tsx` — the problem panel, editor, and participants
  panel are now three independently-sized panes separated by two
  `ResizeHandle`s, instead of fixed `w-[45%]`/`w-[70%]`/`w-[30%]`.
  Problem and participants widths are held in state (px) and clamped to
  sane min/max ranges (problem: 280–800px, participants: 220–520px,
  editor: 360px floor); the editor itself just fills whatever's left via
  `flex-1`. Initial widths are seeded once from the row's real measured
  width (roughly matching the old 70/30 look) via a `ResizeObserver`-free
  one-shot effect gated on a ref, then left entirely alone — from that
  point on, sizing is 100% user-driven.

**Verified:** clean `tsc --noEmit`; `eslint` clean on both new/changed
files (same two pre-existing unrelated `page.tsx` warnings as before).
Monaco already runs with `automaticLayout: true`, so the editor reflows
correctly as its container is resized — no changes needed there. Booted
the dev server and confirmed both `/` and `/room/[id]` respond with no
compile errors; couldn't drag-test the actual handles in a browser from
this sandbox (same Clerk sign-in gate as the previous entry) — worth a
manual drag test to confirm feel/clamping before considering this done.

---

## Fix slow turn-duration changes + add a host pause/resume timer control

**Date:** 2026-08-15

**Task:** You reported changing the turn timer takes a few seconds to
land, and asked for a way for the host to pause the timer.

**Diagnosed the slowness first:** `handleSetTurnDuration` (and
`handlePassTurn`) in `page.tsx` were awaiting the `PATCH`/`POST` to
`/api/rooms/[id]/turn` — which already computes and returns the fresh
`room` in its response — and then throwing that response away and
calling `syncState()`, a second full `/sync` request that reruns
`getRoom` (relational Postgres query + Redis reads) from scratch. Every
duration change or turn pass was paying for two sequential full
room-state round trips instead of one. `setTurnDuration` itself also
did a `findFirst` just to check ownership before its `UPDATE`, adding a
third round trip before the mutation even started.

**What changed:**
- `app/room/[id]/page.tsx` — `handlePassTurn`, `handleSetTurnDuration`,
  and the new `handleTogglePause` now apply the `room` object already
  returned by the mutation directly to state (`applyRoomUpdate`),
  instead of discarding it and re-fetching via `syncState()`. Falls
  back to `syncState()` only if the request itself failed.
- `lib/rooms.ts` — `setTurnDuration` folds its ownership check into the
  `UPDATE ... WHERE id = ? AND owner_id = ?` itself (via `.returning()`)
  instead of a separate `findFirst` beforehand — one DB round trip
  instead of two before the `getRoom()` refetch.

**Pause/resume timer (host-only):**
- `lib/roomState.ts` — new `turnPausedRemainingMs` field on the live
  Redis hash. `pauseTurn()` snapshots however much time was left and
  clears `turnEndsAt` (so the existing timeout-auto-advance check in
  `getRoom()` leaves a paused turn alone for free — it only fires when
  `turnEndsAt` is non-null). `resumeTurn()` sets a fresh `turnEndsAt`
  from the saved remainder. Both new turns (`startTurn`) and new
  sessions (`resetLiveStateForSession`) explicitly clear any stale
  pause state so it can never leak across turns.
- `lib/rooms.ts` — new host-only `pauseTurn`/`resumeTurn`, and
  `turnPausedRemainingMs` added to the `Room` shape returned everywhere.
- `app/api/rooms/[id]/turn` `PATCH` now also accepts `{ paused: boolean
  }` alongside the existing `turnDurationSeconds` body.
- `app/api/rooms/[id]/sync` now also returns `turnPausedRemainingMs`.
- `components/TurnBar.tsx` — new Pause/Resume button next to "Pass
  turn", visible only to the host whenever a turn is active. The
  countdown chip shows an amber "Paused · mm:ss" instead of ticking
  while paused (the existing 1s-tick effect already stops itself
  automatically, since it's keyed on `turnEndsAt` being non-null, which
  becomes `null` while paused).

**Verified:** clean `tsc --noEmit`; `eslint` clean on every changed
file (the two pre-existing `page.tsx` warnings are still there,
untouched). Booted the dev server and hit `/`, `/room/[id]`, and a
`PATCH .../turn` with `{"paused":true}` — all compiled and responded
with no server errors (auth-redirected as expected, no session in this
sandbox). Didn't get to click an actual pause button in a browser here
— worth confirming the countdown visibly freezes/resumes and that
non-hosts can't trigger it.
