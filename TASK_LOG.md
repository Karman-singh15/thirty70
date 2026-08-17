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

---

## Real peer-to-peer video/audio (WebRTC over the existing polling)

**Date:** 2026-08-16

**Task:** You couldn't see or hear another participant who had their
camera/mic on — only the on/off indicator was shared, which was the
limitation flagged in the two previous media entries. You framed this
as "we'll add realtime afterwards", so the important correction is:
**transmitting audio/video doesn't require WebSockets.** WebRTC media
flows browser-to-browser (never through our server); only the ~2-second
connection handshake needs a message channel, and that rides fine on
HTTP polling. So this is built now and doesn't block on, or get
thrown away by, the PartyKit/WebSocket work later — that swap just
makes the handshake faster.

**What changed:**
- `lib/roomState.ts` — per-user signaling inboxes in Redis
  (`room:{id}:signal:{userId}`). `pushSignals` writes a batch (capped
  at 200 entries, 120s TTL, so an inbox nobody drains can't grow
  unbounded or linger); `drainSignals` reads-and-clears in a `MULTI`
  so a message pushed mid-drain isn't silently lost.
- `lib/rooms.ts` — added `isRoomMember`, a single indexed lookup, so
  the signaling routes can authorize without paying for a full
  `getRoom` on a hot path.
- New `app/api/rooms/[id]/signal` — `GET` drains my inbox, `POST`
  sends a *batch* of messages to peers (batched because ICE candidates
  trickle out a dozen at a time and shouldn't be a dozen requests).
- New `hooks/useWebRTC.ts` — full-mesh peer connections. Notable
  decisions: both audio and video transceivers are created up front in
  `sendrecv` even with no track attached, so toggling a camera later is
  just `replaceTrack()` on an existing sender — **no renegotiation**,
  which avoids a whole second offer/answer round trip through the slow
  polling channel. Which side offers is decided by `myUserId < peerId`
  so exactly one side initiates and handshakes can't collide. ICE
  candidates arriving before their remote description get buffered and
  flushed after. Signal polling is adaptive: 700ms while any peer is
  still connecting, 2.5s once everyone's connected.
- `hooks/useLocalMedia.ts` — mic stream moved from a ref into state and
  both `audioTrack`/`videoTrack` are now exposed, so the WebRTC hook
  can feed them to peers reactively.
- `components/VideoTile.tsx` — remote tiles now render the peer's real
  stream. The `<video>` element stays mounted whenever a stream exists
  even with their camera off, because that same element carries their
  audio; the avatar is drawn over it instead of replacing it. Self is
  muted (no feedback loop) and mirrored; remotes are not. Added an
  "Unmute" button that appears if the browser blocks autoplay — arriving
  in a room by navigation doesn't always count as the user gesture
  browsers require before playing audio.
- `components/ParticipantsPanel.tsx` / `app/room/[id]/page.tsx` —
  thread `remoteStreams` through. Connections are established for
  everyone present regardless of whether they have media on yet, so
  switching a camera on shows up immediately instead of starting a
  handshake at that moment.

**Verified:** clean `tsc --noEmit`; `eslint` clean on all new/changed
files (only the two known pre-existing `page.tsx` warnings remain).
Wrote a throwaway script exercising the real `pushSignals`/
`drainSignals` against live Upstash — confirmed messages route to the
right recipient, FIFO order is preserved (load-bearing: an offer must
be processed before its ICE candidates), the drain is genuinely
destructive, and payloads survive the round trip intact. Booted the dev
server and confirmed the new `/signal` route compiles and responds.

**Not verified — needs two real browsers:** I could not place an actual
call from this sandbox, so the end-to-end handshake, the video
rendering, and the audio path are unproven in practice. Test with two
accounts on two devices before trusting it.

**Known limitations:**
- **No TURN server.** Only free Google STUN is configured, so peers
  behind symmetric NAT or strict corporate firewalls will fail to
  connect (typical home and mobile networks are fine). A TURN relay
  carries every packet, which is why it costs money; Open Relay
  (metered.ca) has a free tier if this turns out to be a problem.
- **Full mesh**, so each participant holds a connection to every other
  one. Fine for a practice room of 3-4; it would need an SFU before it
  needed anything else.
- Connection setup takes a couple of seconds because signaling is
  polled. This is exactly what moving signaling onto WebSockets later
  fixes — the media path itself won't change.

---

## Add late joiners to the turn queue + a Leave Room button

**Date:** 2026-08-16

**Task:** You reported that passing the turn skips whoever joined after
the room's turn order was set, and asked for a Leave button that also
pulls the leaver out of the queue. Root cause: `turnOrder` in Redis is
only populated once, when the host picks a problem (`setRoomProblem`
snapshots whoever's a member at that moment) — anyone joining afterward
was never inserted into that list, so `advanceTurn`'s circular rotation
just never reached them. Separately, `leaveRoom` already existed in
`lib/rooms.ts` from the earlier Postgres/Redis migration but nothing
ever called it — no API route, no UI, and it never touched the turn
queue at all.

**What changed:**
- `lib/roomState.ts` — new `addToTurnOrder` (appends to the tail of the
  live Redis list, a no-op if the queue hasn't started yet or the user's
  already in it), `removeFromTurnOrder` (`LREM`), and `clearCurrentTurn`
  (ends the active turn with no successor, for when the last queued
  player leaves — leaves `turnNumber` alone so it resumes rather than
  restarts if the queue gains players again).
- `lib/rooms.ts` — `joinRoom` now calls `addToTurnOrder` after adding
  the participant, so anyone joining mid-session enters the circular
  queue immediately. `leaveRoom` now checks whether the leaver is
  queued: if they hold the current turn, it rotates to the next queued
  player first (reusing the existing `advanceTurn` math, which needs
  the leaver still present in the list to compute "next after them"
  correctly) and logs a `passed_turn` turn record, or clears the turn
  entirely if they were the last one queued — only *then* removes them
  from the list.
- New `app/api/rooms/[id]/leave` route — `POST`, calls `leaveRoom` for
  the authenticated caller.
- `components/RoomHeader.tsx` — new `onLeave` prop and a "Leave" button
  (red on hover) next to the invite link.
- `app/room/[id]/page.tsx` — new `handleLeaveRoom`: posts to the leave
  route, then routes to `/dashboard` via `useRouter`.

**Verified:** clean `tsc --noEmit`; confirmed the two `eslint` errors in
`page.tsx` (`setState` inside `useEffect`, lines 161/172) and the
`app/page.tsx` unused-import warning all pre-date this change (reran
lint against a stash of everything but this task's files — identical
errors, same line numbers shifted only by unrelated pending edits).
Did not click through an actual join/leave/pass-turn cycle in a browser
from this sandbox (same Clerk sign-in gate as prior entries) — worth
testing with two accounts: join mid-session and confirm the new person
gets a turn, then have the active player leave and confirm the turn
rotates immediately instead of waiting out the timer.

---

## Cross-check two parallel agents' work + fix a camera-stays-on bug

**Date:** 2026-08-16

**Task:** Two Claude sessions worked on this repo concurrently (one on
WebRTC peer-to-peer media, one on turn-queue joiners/leavers). You asked
for a check that we hadn't clobbered each other's files or broken
anything.

**Overlap result — no collisions.** Four files were touched by both
sessions (`lib/roomState.ts`, `lib/rooms.ts`, `app/room/[id]/page.tsx`,
`TASK_LOG.md`) but every edit was additive and in a different region:
new Redis helpers appended alongside each other, separate handlers and
imports in the page. Redis key namespaces don't overlap either —
`room:{id}:signal:{userId}` (WebRTC) vs `room:{id}:turnOrder` and
`room:{id}:state` (turn queue). Both feature sets are fully present; the
earlier layout/resize/pause work was committed as `807cbc4`, so nothing
was lost.

**Bug found and fixed (mine, surfaced by their change):**
`hooks/useLocalMedia.ts` released the mic/camera in an unmount cleanup
with an empty dep array, so the closure captured the *first* render's
stream values — both `null` — and stopped nothing. The camera and mic
hardware stayed live after leaving a room (browser recording indicator
still lit). It was latent before because unmounting only happened on
manual navigation; the new Leave Room button makes it a routine path,
which is what exposed it. Fixed by mirroring the streams into a ref
that the cleanup reads, so it sees the current streams instead of the
initial nulls. This also let the `react-hooks/exhaustive-deps`
suppression comment go away rather than being worked around.

**Verified:** clean `tsc --noEmit` across the merged tree. `eslint` over
`hooks/ components/ lib/ app/` shows only the three known pre-existing
problems (two `set-state-in-effect` errors in `page.tsx`, one unused
import in `app/page.tsx` — confirmed unmodified by either session).
Wrote a throwaway script running both feature sets against the same
room on live Upstash — 11/11 checks passed: late joiners append to the
turn order without disturbing queued signaling messages, signals stay
FIFO-intact across turn-order writes, pause/resume still behaves, and
critically the leave path still clears presence and media flags (that
presence removal is exactly what triggers WebRTC peer teardown on the
other clients, so the two features depend on each other here). Booted
the dev server and confirmed all five room API routes
(`signal`/`leave`/`turn`/`media`/`sync`) compile and respond with zero
server errors.

**Still unproven:** the actual two-browser call. Every prior media entry
carries this caveat and it hasn't been discharged yet — the WebRTC
handshake, video rendering, and audio path have never run against a
real second peer. The camera-release fix above is likewise only
verified by reading the code, not by watching the recording indicator
go out.

---

## Fix: remote camera feed never rendered

**Date:** 2026-08-16

**Task:** You tested the WebRTC work with a real second person and the
camera feed still didn't come through. Traced it by reading the code
rather than guessing — found two separate bugs, either of which alone
would produce exactly "no video".

**Bug 1 (root cause) — the video element never picked up the video
track.** `ontrack` fires *twice* per peer, once for audio and once for
video, because both transceivers are declared up front. The old handler
added each arriving track to one long-lived `MediaStream` and pushed
that same object into state each time. Since the audio transceiver is
created first, audio arrives first: `VideoTile` bound `srcObject` to a
stream that at that moment held only an audio track. When the video
track was added a moment later, the `MediaStream` object *identity*
never changed, so the tile's effect (deps `[stream, isSelf]`) didn't
re-run — and a `<video>` element does not reliably start rendering a
track appended to the stream it's already bound to. Net effect: audio
would have worked, video silently never appeared. Fixed by keeping the
peer's tracks in a `Map` keyed by kind and building a **new**
`MediaStream` on every `ontrack`, so the identity changes, the effect
re-runs, and `srcObject` is re-assigned with both tracks present.

**Bug 2 — autoplay rejection killed the picture, not just the sound.**
Remote tiles rendered `<video muted={false}>`, and browsers refuse to
autoplay unmuted media without a user gesture. A rejected `play()`
leaves the element paused entirely, so the *video* didn't render
either — the "Unmute" affordance was mis-framed as an audio-only
fallback when it was actually gating the whole picture. Now the element
is always mounted `muted` (video autoplay is never refused), and the
effect attempts to unmute remote peers immediately; if the browser
blocks that, it falls back to muted playback — keeping the picture —
and shows the button to enable sound under a real click.

**Also added — connection-state badges.** `useWebRTC` now tracks each
peer's `RTCPeerConnectionState` and `VideoTile` shows "Connecting…" or
"Can't connect" on a remote tile that hasn't reached `connected`.
Previously a peer that failed ICE was indistinguishable from one whose
camera was simply off — both were a blank tile — which is precisely why
this bug was hard to place. With no TURN server configured, "Can't
connect" is the expected outcome on a restrictive network, and now it
says so.

**Verified:** clean `tsc --noEmit`, `eslint` clean on all changed files
(only the two known pre-existing `page.tsx` errors), and a full
`npm run build` succeeds with all 17 routes including `/signal`.

**Still not verified in a browser.** I have no way to run two real peers
from this sandbox, so these are code-inspection fixes. If the feed is
*still* missing after this, the new badge is the thing to read: a tile
stuck on "Connecting…" or showing "Can't connect" means the handshake
or ICE is failing (network/TURN), while a tile with no badge at all
means the connection succeeded and the problem is downstream in
rendering — two very different fixes, and that badge tells us which.

---

## Fix: refreshing the page broke every connection

**Date:** 2026-08-16

**Task:** You reported that refreshing the page broke the whole system.

**Cause:** a reload gives you brand-new `RTCPeerConnection` objects, but
the *other* browser has no way to know that. Its presence entry for you
never lapses (a refresh takes ~1s against a 10s presence window), so the
reconciliation effect never tore down the now-dead connection — it kept
talking to a browser that no longer existed. Worse, because the offerer
was chosen purely by `myUserId < peerId`, if the person who refreshed
held the *higher* id they'd wait for an offer that was never going to
come: a permanent deadlock for one of the two directions, decided by
nothing more than how the two Clerk ids happened to sort.

**Fix — a per-page-load session id.** Every signal now carries a
`session` generated fresh on each load. A peer that receives a signal
whose session differs from the one it has on file knows the far side
reloaded, tears down the stale connection, and rebuilds. To cover the
direction where the reloader isn't the designated offerer, creating a
connection from presence discovery now also emits a `hello` announcing
the new session — that's what prompts the *other* side to rebuild and
re-offer. `hello` is only sent on presence discovery, never in reply to
an inbound signal, otherwise the two sides would ping-pong hellos
forever. The `initiate` rule stays id-ordered so exactly one side offers.

**Verified:** clean `tsc`, `eslint` back to only the three known
pre-existing problems, `npm run build` passes. Wrote a throwaway script
covering both reload directions — 13/13 checks: the `session` field
survives the Redis relay, `hello` is delivered ahead of the offer that
follows it (load-bearing, and it holds because the inbox is a FIFO
list), the previously-deadlocking case now has the non-reloading side
rebuild *and* re-offer, the reverse case rebuilds as an answerer without
a duplicate offer, an unchanged session doesn't churn a healthy
connection, and exactly one side initiates in every pairing.

**Note:** the session-role assertions are a model of the decision
predicates, not a live two-browser test — that remains unrun from here.

**Worth knowing for testing:** `getUserMedia` and `crypto.randomUUID`
both require a secure context. Testing two devices over a plain-http LAN
address (`http://172.20.x.x:3000`) means the camera never opens at all —
use `localhost` on one machine, or an https tunnel, or two profiles on
the same machine. (A non-crypto session-id fallback is in place for that
case, but it does not rescue `getUserMedia`.)

---

## Fix: video only flowed one way (offerer → answerer)

**Date:** 2026-08-16

**Task:** Two browsers on localhost. The host's camera reached the
participant, but the participant's camera never reached the host.

**Diagnosis came straight from the screenshot**, and the badge added in
the previous entry is what made it readable: the broken tile showed an
*avatar* with *no connection badge*. No badge means the peer connection
reached `connected`, so ICE, STUN and the signaling relay were all fine
— that ruled out the entire network layer. And an avatar rather than a
black frame means `stream` was null, i.e. `ontrack` never fired on the
host at all. A healthy connection carrying media in exactly one
direction points at one thing: the answerer never agreed to send.

**Cause.** Both sides pre-created their audio/video transceivers in
`createPeer`. That's correct for the offerer, but wrong for the
answerer: transceivers created locally ahead of time are not associated
with the m-lines of an incoming offer, so the browser builds its *own*
pair to answer with — and those default to **`recvonly`**. The answer
therefore advertised "I will only receive". The answerer's
`replaceTrack()` still resolved happily against its orphaned, never-
negotiated transceivers, so nothing looked wrong locally, but no media
left the machine and the offerer's `ontrack` never fired. Perfectly
asymmetric, and silent on both ends.

**Fix.** Only the initiator calls `addTransceiver` now. The answerer
starts with a bare connection and adopts the transceivers that
`setRemoteDescription` creates from the offer. New `applyTracks(pc)`
helper looks a connection's transceivers up by kind, forces each to
`sendrecv`, and attaches whatever local tracks currently exist. It runs
at three points: when the offerer builds its connection, in the
track-change effect when a camera/mic toggles, and — the load-bearing
one — **between `setRemoteDescription` and `createAnswer`**, which is
the only window where flipping the direction still lands in the answer
being sent.

**Verified:** clean `tsc`, `eslint` back to the three known pre-existing
problems, `npm run build` passes, and confirmed by inspection that
`addTransceiver` is now guarded by `initiate` and that `applyTracks`
sits at all three required call sites in the right order.

**Not verified in a browser** — same standing caveat. The reasoning
accounts for the exact observed asymmetry, but only a real two-peer test
settles it.

---

## Turn rotation: verified the backend, made the UI legible

**Date:** 2026-08-16

**Task:** You asked for joiners to enter the turn cycle, leavers to be
removed, the editor locked to the turn holder, a fix for turns "not
being passed", a more noticeable (but still subtle) your-turn cue, and a
visible sequence of upcoming turns.

**Tested the backend before changing it, and it was already correct.**
Two throwaway scripts against the real Neon/Upstash, 23 assertions in
total, all passing: a joiner is appended to the rotation and actually
receives a turn; a leaver is removed *and* the turn hands off
immediately if it was theirs; `passTurn` rotates and increments; a
non-holder can't pass; an expired turn auto-rotates on the next poll;
and the editor gate holds server-side — the holder can write, a
non-holder gets `not_your_turn`, a non-member gets `not_member`, a
rejected write leaves the stored code untouched, and edit rights follow
the rotation. Also confirmed `@monaco-editor/react` really does apply a
changed `readOnly` (it calls `updateOptions` whenever the options object
changes), so the client gate wasn't stale either.

**So "the turn is not being passed" wasn't a rotation bug — it was
invisibility**, and most likely this: with one player in the rotation,
`(0 + 1) % 1 === 0` hands the turn straight back to you. The turn number
advances but the holder doesn't change, which is indistinguishable from
a dead button. The queue UI below now makes that state self-evident, and
there's an explicit "only you in the rotation" note.

**What changed (all UI):**
- New `components/TurnQueue.tsx` — the rotation as a left-to-right
  timeline of avatar chips, driven by `turnOrder` (sequence) joined
  against `participants` (display data), with anyone who has since left
  dropped. Active player gets an emerald chip and ring; the next player
  up is tinted a step brighter than the rest; your own chip reads "You".
  Scrolls horizontally rather than wrapping.
- `components/TurnBar.tsx` — rebuilt around that queue. When it's your
  turn the whole bar takes a faint emerald wash plus a solid emerald
  left edge and a small pulsing dot: catchable in peripheral vision
  without becoming a banner that shouts over the problem. Header now
  reads "<name>'s turn" rather than a bare name.
- `components/CodeEditor.tsx` — the status chip is now an explicit
  lock/pencil state: "Read-only — not your turn" vs. a highlighted
  "You can edit", replacing the easily-missed grey sentence.
- `app/room/[id]/page.tsx` — `turnOrder` now flows into client state
  (the sync route was already returning it; the client had been
  discarding it) and down into `TurnBar`.

**Verified:** clean `tsc`, `eslint` at the three known pre-existing
problems, `npm run build` passes, and the turn lifecycle script re-run
after the changes still passes end to end.

**Not verified:** the visual result in a browser — worth a look to check
the queue doesn't crowd the bar once four or five people are in a room.

---

## Shared editor: one live document for the whole room

**Date:** 2026-08-16

**Task:** You asked for the editor to sync between users so everyone sees
changes as they're made, for the language to be common to everyone, and
for the editor's state to be shared the way a Google Doc is.

**What was actually wrong.** The code *was* being shared, but through a
path that couldn't feel live: the writer's editor debounced 500ms, saved
the whole file, and everyone else picked it up on a 1.5s poll — so two
seconds of lag, and every arriving update replaced the reader's entire
buffer, throwing away their scroll position. Language was worse: it lived
in local React state and only reached the server when the new language
happened to have a starter snippet, so it could silently disagree between
people.

**Kept turn-gating.** Only the current player can type — that's the
product, not a limitation, so this shares the document without opening
editing to everyone. Docs' hard problem (merging concurrent edits) doesn't
arise with a single writer, which is why there's no OT/CRDT here.

**Transport — server-sent events over Redis pub/sub.** Worth being clear
since WebSockets keep coming up: this needed a *push* channel, and SSE is
one, over plain HTTP. Measured it end to end through the running dev
server — publish to receive was 31ms, versus the ~2s the poll gave.
- New `app/api/rooms/[id]/stream` — an SSE route. Each connection opens
  with a full snapshot (so connecting and reconnecting are the same thing
  and there's no window where a client patches a stale buffer), then
  relays events. Each subscriber gets its own Redis connection, because a
  connection in subscriber mode can't serve anything else, and it's torn
  down on `req.signal` abort — verified that fires.
- The 1.5s `/sync` poll stays for turn state, presence and media; it's
  also what keeps presence alive. It no longer carries code or language,
  which would have fought the stream.

**Document model — versioned, server-authoritative.**
- `lib/roomState.ts` — the live state hash gains `docVersion`, plus
  `casSetCode`: a Lua compare-and-set that applies a write only if the
  version the writer was editing is still current. The client sends the
  full resulting text *and* the small changes that produced it; the text
  makes the write a single atomic operation, and the changes get fanned
  out so everyone else patches their editor by range instead of having
  the buffer replaced under them. Deliberately no string splicing in Lua
  — its byte indexing would corrupt any non-ASCII character in the file.
- New `app/api/rooms/[id]/editor` — `GET` the document (for recovery),
  `POST` an edit, a language change, or a cursor move. Authorized through
  a new `canEditRoom`, which resolves the usual case from Redis alone
  since it runs on nearly every keystroke.
- New `lib/editorDoc.ts` — the wire types, free of runtime dependencies so
  the browser can import them without pulling in the Redis client.

**Client — `hooks/useSharedEditor.ts`.** The editor is no longer driven by
a React `value` prop; it can't be, if remote edits are to land without
discarding the reader's scroll position, selection and undo history on
every keystroke. The hook owns the Monaco model directly. Notable
decisions: exactly one request in flight at a time (edits are a sequence,
and two racing requests could arrive out of order); a failed request puts
its edits back at the front rather than dropping them; each delta carries
the resulting document length, so a client whose replay didn't reproduce
the writer's text notices and refetches; and a page-load id distinguishes
our own echo from a second tab of the same account.

**Also — you can see where the other person is working.** The writer's
cursor is broadcast and drawn in everyone else's editor as a caret with a
tinted line, and named in the toolbar ("Alice · Ln 12, Col 5"). Cheap,
and it's most of what makes a Doc feel shared rather than merely synced.

**Bug found and fixed while building it.** `resetLiveStateForSession` set
the version back to 1 on each new problem. Since clients ignore any
document older than the one they hold, everyone already in the room would
have ignored the switch and sat on the previous problem's code. The
counter now keeps climbing for the room's lifetime.

**Verified:** clean `tsc`, `npm run build` (both new routes present),
`eslint` back to the two known pre-existing `page.tsx` errors and nothing
new. Two throwaway scripts against live Upstash — 28 assertions, all
passing: a viewer replaying broadcast deltas reproduces the writer's
document exactly across inserts, replacements, deletions, multi-change
events and non-ASCII text; versions arrive in unbroken order; the length
check agrees on every delta; a stale write is refused and hands back the
current document without modifying anything; exactly one of ten
concurrent writes lands; a mid-room problem switch is accepted by a
client already well ahead of version 1. Separately booted the dev server
and streamed real events through the actual SSE route: snapshot on
connect, heartbeats, three published events delivered in 31ms each with
no proxy buffering, and the subscriber torn down on disconnect.

**Not verified — needs two real browsers.** Everything above tests the
server and the sync algorithm; nothing here has driven an actual Monaco
model. The remote-cursor decorations and the in-place patching (that the
reader's scroll really does hold still while someone types above them)
are unproven in practice. Same standing caveat as the WebRTC entries.

**Known limitations (shared editor):** each SSE connection holds a Redis connection for
as long as it's open, which is fine for practice rooms but is the first
thing that would need pooling at scale. Deployed to a platform with a
function timeout, the stream will be cut at that limit — EventSource
reconnects and the snapshot makes that harmless, but it means a reconnect
every N minutes. And the writer's own cursor is the only one shared;
readers' cursors aren't, deliberately, since broadcasting those would
cost a membership lookup per move.

---

## Send anyone who is no longer in a room to the dashboard

**Date:** 2026-08-16

**Task:** You asked that a user who leaves be redirected to the dashboard.

**The Leave button already did that**, so the work was in the cases it
didn't cover — every other way someone stops being in a room:
- Leaving from a second tab. That tab kept polling, got `403 Not a
  member` every 1.5s, and sat on a room it could no longer act on.
- The room being torn down (it's deleted when the last person leaves).
  Any stale session polling it got `404` forever.
- Opening a room you were never in, or a dead invite URL — `fetchRoom`
  quietly did nothing, leaving "Loading room..." on screen permanently.

All three had the same root cause: `fetchRoom` and `syncState` both did
`if (!res.ok) return;`, throwing away the server's answer.

**What changed** (all in `app/room/[id]/page.tsx`):
- New `goToDashboard`, guarded by a ref so concurrent pollers can't fire
  the navigation twice, used by every exit path. It uses
  `router.replace` rather than `push` — the room is behind them, and the
  back button shouldn't walk them into a page that only bounces them out
  again.
- New `departedFromResponse`: 403 and 404 mean "you are not in this
  room" and redirect. Deliberately nothing else — a 500 or a network
  blip is treated as transient and left to the next poll, so a hiccup
  can't eject someone mid-session.
- `fetchRoom` and `syncState` both run it, and both bail early once
  departed so the 1.5s interval stops doing work during the navigation.
- `handleLeaveRoom` now redirects from a `finally`, so a failed leave
  request doesn't strand the user in the room they asked to leave.
  Presence lapses within ~10s and the turn times out normally, so the
  room recovers on its own without that request.

**Verified:** clean `tsc`, `npm run build`, `eslint` unchanged at the two
known pre-existing `page.tsx` errors. A throwaway script exercised the
real `createRoom`/`joinRoom`/`leaveRoom` against live Neon and Upstash,
reproducing exactly the checks `GET /api/rooms/[id]` makes — 9/9: a
leaver gets 403 while someone still in the room keeps getting 200 (so
nobody is ejected by *someone else* leaving), the last person out leaves
a room that returns 404, a stale session for that deleted room also gets
404 rather than hanging, and a non-member opening an existing room gets
403.

**Not verified in a browser:** the navigation itself. The redirect
triggers are proven; that `router.replace` lands on the dashboard from
each of these paths is not.

---

## Cut server latency ~20x, and show a loader while waiting

**Date:** 2026-08-17

**Task:** You said everything took too long to respond, asked for a
loader whenever a press is waiting on the server, and asked that none of
it break functionality.

**Measured before changing anything.** A script timed each primitive and
each real code path against the live Neon/Upstash instances:

| | before |
|---|---|
| Redis command | 30ms |
| Redis, 5 commands pipelined | 30ms |
| Postgres `select 1` | 248ms |
| Postgres **write** (any write) | 510ms |
| `getRoom()` | 549ms |
| **GET /sync** | **574ms** |

Two facts shaped everything below. First, a Postgres round trip costs
8–17x a Redis one, and the room polled Postgres several times a second
for data — room name, participants, which problem — that changes maybe
once an hour. Second, writes cost a flat 510ms each *regardless of what
they are*, and parallel writes overlap almost perfectly (2 writes in
`Promise.all` = 524ms, 4 = 560ms) — so what costs time is the number of
sequential write *phases*, not the number of writes.

**The main change: the room's durable record is cached in Redis.**
- `lib/roomState.ts` — new `room:{id}:meta` entry holding everything
  `getRoom` used to query Postgres for, with a 5-minute TTL. Every
  function that changes any of it either patches the entry or drops it,
  so a stale read isn't possible for anything the app itself does; the
  TTL only bounds drift from things we don't see, like a Clerk display
  name being edited elsewhere.
- `lib/rooms.ts` — `getRoom` now issues its three reads together and
  serves them entirely from Redis. `pauseTurn`/`resumeTurn` check
  ownership against the cached record instead of spending a round trip
  learning who owns the room before doing anything.

**Fewer round trips on the paths that remained:**
- `getOnlineUserIds` awaited its expiry sweep before reading, costing a
  second round trip on every poll — now one pipeline.
- `/sync` awaited `touchPresence` after everything else came back; it now
  goes out with the rest.
- The editor's write path read the live state twice (once to authorize,
  once for the language) and then wrote presence separately. Now one read
  serves both checks and presence rides in the same pipeline as the
  broadcast — ~150ms to ~60ms on a path that runs while you type.
- Turn history and session bookkeeping move off the response path via
  `after()`. Nothing on screen reads them back, so there's no reason a
  button press should wait ~510ms for one. Live state is in Redis, so a
  lost write there costs history, not a working room.
- `setRoomProblem` registered the problem and pointed the room at it as
  two separate writes, which *can't* overlap — `rooms.problem_slug` has a
  foreign key to `problems.title_slug`. They're now a single statement
  with a data-modifying CTE: inside one statement the constraint isn't
  checked until the whole thing completes, so both land in one round
  trip. Verified against the real database with a brand-new slug, which
  is the case that would fail if the ordering assumption were wrong.

**Results.** Both columns are measured end to end — the "before" ones by
checking the pre-change `lib/rooms.ts` out of git and benchmarking it
against the same live services, after an initial pass where they were
merely *derived* from component costs and turned out to be optimistic:

| | before | after |
|---|---|---|
| GET /sync | 574ms | **32ms** |
| Pass turn | 2382ms | **194ms** |
| Pause | 1220ms | **97ms** |
| Resume | 597ms | **64ms** |
| Pick a problem | 1855ms | **661ms** |
| Change turn length | ~610ms | **596ms** |

(Pass turn's figure includes one `getRoom` the harness itself makes to
find the current holder — ~615ms of the before, ~28ms of the after — so
the function alone went from roughly 1770ms to 166ms. Neon's timings
also wander: resume was measured anywhere from 557ms to 1227ms on the
old code, so treat these as the right order of magnitude rather than
exact.)

Turn length is deliberately unchanged: it's the one action still waiting
on a durable write. The cached record is rebuilt from Postgres whenever
someone joins or leaves, so a turn length that only existed in Redis
could quietly revert — not worth 500ms.

**Client side:**
- The `/sync` poll went from 1.5s to 700ms. It was 1.5s because each
  request cost ~570ms; at ~30ms it's cheap, and it halves how long a turn
  change takes to appear.
- Picking a problem fetched it from LeetCode, and then the panel effect
  fetched the very same thing again when the room updated. The host now
  hands the details it already has straight to the panel.

**The loader.** New `usePendingActions` tracks in-flight requests by
name, so overlapping ones don't make unrelated controls spin.
- Pass turn, Pause/Resume, turn length and Leave each swap their own icon
  for a spinner, disable while working, and say what they're doing
  ("Passing…", "Leaving…"). Swapping the icon rather than adding one
  keeps the button the same size so the bar doesn't jump.
- Problem search highlights the row you clicked and marks it "Loading…"
  until the problem is actually live in the room — it's the slowest
  action, so it gets the most explicit feedback.
- New `TopProgressBar`: a thin indeterminate sweep under the header while
  anything is pending. It's delayed 200ms *in CSS* rather than by a
  timer, so it never flashes on requests that now finish in 30ms, and it
  needs no state (which also kept it clear of the `set-state-in-effect`
  lint rule).

**Verified:** clean `tsc`, `npm run build`, `eslint` unchanged at the
three known pre-existing problems. Two throwaway suites against live
Neon/Upstash — 42 assertions on the caching change and 20 on the final
state, all passing. The load-bearing one is repeated at six different
points in a room's life: **a cached read is byte-identical to one that
went to Postgres**. Also confirmed the turn gate still refuses
non-holders and non-members, ownership checks still reject non-hosts,
join/leave still update the rotation, the shared editor's deltas still
replay exactly (including non-ASCII), and every deferred write really
does land — session rows, `rooms.problem_slug`, turn duration and turn
history all checked in Postgres afterwards.

**Not verified in a browser:** the loaders themselves. Worth a look that
the top bar genuinely doesn't flash on the now-fast actions, and that
the problem-search row reads well while loading.

**Known limitations:** the first request to a room after 5 minutes of
quiet still pays one ~660ms Postgres read to rebuild the cached record,
and Neon's free-tier cold start (~2.4s here, 9.4s when fully asleep) is
still there underneath — neither is fixable from app code. Deferred
writes are best-effort: if the process dies within ~1s of a click, that
room's history entry is lost, though the room itself stays correct.

---

## Delete the /sync poll: room state now pushes over the existing SSE stream

**Date:** 2026-08-17

**Task:** You wanted the repeated `/sync` calls gone. We talked through
WebSockets, a third-party realtime service, and extending the SSE channel
already in the app; you picked extending SSE, with a grace period so
presence doesn't flap.

**Two things went differently from the first sketch**, both worth
recording:

1. *One connection, not two.* Every SSE client holds a **dedicated** Redis
   connection — a connection in subscriber mode can't run anything else.
   A second stream for room state would therefore have doubled the
   connection count per browser tab for no reason. So `subscribeEditorEvents`
   became `subscribeRoomChannels`, which subscribes one connection to both
   `room:{id}:editor` and `room:{id}:room`. Connection count per client is
   unchanged at one.
2. *No bespoke grace-period timer.* An in-process "wait 5s then mark them
   offline" timer breaks the moment there's more than one server instance:
   a client can disconnect from instance A and reconnect on instance B,
   and A's timer fires anyway and flashes them offline. Instead presence
   is now refreshed by the stream's **existing 20s keep-alive heartbeat**,
   with `PRESENCE_WINDOW_MS` widened 10s → 50s (a bit over 2x the
   heartbeat, so one missed ping can't flap anyone). Nothing explicitly
   marks a user offline: pings stop, the entry ages out. That's stateless,
   survives multiple instances, and needed no new machinery.

**What changed:**
- `lib/editorDoc.ts` — added `RoomSnapshot`/`RoomEvent` alongside the
  editor wire types. Still runtime-dependency-free, so the browser imports
  them without pulling in Redis.
- `lib/roomState.ts` — new `roomChannel` + `publishRoomEvent`;
  `subscribeRoomChannels` replaces the editor-only subscriber;
  `PRESENCE_WINDOW_MS` 10s → 50s.
- `lib/rooms.ts` — new `getRoomSnapshot` (reuses a `Room` the caller
  already has, so it never costs a second `getRoom`) and
  `broadcastRoomUpdate`. Called from `joinRoom`, `leaveRoom`,
  `setRoomProblem`, `passTurn`, `pauseTurn`, `resumeTurn`,
  `setTurnDuration` — and from `getRoom` itself when it settles a
  timed-out turn, since that's a real change nobody explicitly asked for
  but everyone still needs to see.
- `app/api/rooms/[id]/stream` — subscribes both channels, opens with a
  doc *and* a room snapshot, refreshes presence on connect and on each
  heartbeat, and announces the new connection to everyone else.
- `app/api/rooms/[id]/media` — broadcasts after a toggle.
- `app/api/rooms/[id]/sync` — **the GET is gone**; only the two writes
  (problem select, legacy code save) remain.
- `app/room/[id]/page.tsx` — the 700ms `setInterval` is deleted. The
  initial `GET /api/rooms/[id]` stays, because it's also what tells us via
  a real status code whether we belong here at all. Mutation failures fall
  back to `fetchRoom()` instead of the removed `syncState()`.

**One case needed re-solving.** Removing the poll removed the 403 that a
*second tab* relied on to notice it had been removed (Leave clicked
elsewhere). Every broadcast already carries the participant list, so the
room handler now checks for its own absence — push instead of poll, and
no ambiguity about whether a failure was transient.

**Measured, against live Upstash** (counting real Redis commands by
wrapping the client's `sendCommand`):

| 3-person room, 60s | commands/min |
|---|---|
| Old: 9 cmds x 3 clients x 86 polls | **2314** |
| New, idle: 9 cmds x 3 clients x 3 heartbeats | **81** |
| New, plus 20 turn actions in that minute | **~521** |

28.6x fewer while idle, and still 4.4x fewer under heavy use — the old
number was the same whether the room was busy or not, which was the whole
problem.

**Verified:** clean `tsc`, `npm run build`, `eslint` unchanged at the
three known pre-existing problems. A 29-assertion suite against live
Neon/Upstash: one connection carries both channels without cross-talk,
every mutation broadcasts and the payload actually reflects the change
(problem, turn order, rotation, pause, duration, mic, leaver), presence
survives a missed heartbeat but a genuinely stale entry still expires,
the snapshot matches what `getRoom` reports, editor deltas still flow
alongside room events, and unsubscribing stops both channels. Then booted
the dev server and watched a real SSE connection through curl (via a
temporary unauthenticated mirror of the route, since Clerk gates the real
one, removed afterwards): doc + room snapshot on connect, heartbeats at
the expected interval, and a `passTurn` issued elsewhere arriving as
`turn=sc-b n=2` → `turn=sc-a n=3` about 170ms later, with the subscriber
torn down on every disconnect.

**Not verified in a browser:** two real tabs. The event plumbing is
proven end to end through the HTTP stream, but the React side — that the
turn bar and participant list actually re-render from these events, and
that presence doesn't visibly flicker across a reconnect — needs two
accounts to confirm.

**Known limitations / trade-offs:**
- **Staleness window is now 20s, not 700ms.** If a pub/sub message is
  ever missed, the client stays stale until the next heartbeat, which
  re-sends a full snapshot as a self-heal. That heartbeat is why one beat
  still costs 9 commands rather than the 2 a bare presence touch would —
  a deliberate trade of a little load for a bounded worst case.
- **A closed tab takes up to 50s to show as offline.** Deliberate: marking
  someone offline the instant the connection drops would flicker on every
  EventSource reconnect, which is worse. The Leave button still removes
  them immediately, which is the case that actually needs to be instant.
- Each SSE client still holds one Redis connection for as long as it's
  open. Unchanged by this work, but it's the first thing that would need
  pooling at real scale.

---

## Move WebRTC signaling's membership check off Postgres

**Date:** 2026-08-17

**Task:** After the `/sync`→SSE change above, you asked me to verify nothing
broke and to explain the still-frequent `/signal` requests. Those turned out
to be unrelated and pre-existing (WebRTC handshake polling, 700ms while
connecting / 2.5s once idle, for as long as anyone's in the room) — but
digging into them surfaced that every single poll, on both `GET` and `POST`,
was calling `isRoomMember()`, which reads Postgres directly. Unlike turn
state, presence, and the participant list — all served from the Redis-cached
room meta — this one check never got moved off Postgres, so it was paying a
real Neon round trip (this app's own numbers put that at ~250-550ms)
continuously, for every tab, forever, even in a fully idle room.

**What changed:**
- `lib/rooms.ts` — added `isRoomMemberCached`, which answers the same
  question from `getRoomMeta`'s cached participant list instead of a fresh
  query. `getRoomMeta` already falls back to Postgres on a cache miss, and
  `joinRoom`/`leaveRoom` already invalidate it synchronously as part of the
  request that changes membership — so this carries the same staleness
  guarantee (effectively none, in practice) that turn state and presence
  already rely on. The original `isRoomMember` is untouched and still used
  where a check runs once per connection/action rather than on a tight poll
  (`/stream` on connect, `/editor`'s pre-turn fallback).
- `app/api/rooms/[id]/signal/route.ts` — both `GET` and `POST` now call
  `isRoomMemberCached` instead of `isRoomMember`.

**Verified:** clean `tsc`, clean `next build`, `eslint` unchanged at the same
three pre-existing problems (confirmed via `git diff` that none of the
flagged lines belong to this change).

**Not verified in a browser:** same gap as the change above — two real tabs,
to confirm WebRTC handshakes still complete normally under the cached check.

---

## Mic only became audible after turning the camera on

**Task:** You reported that your mic did nothing until you toggled your
camera on — after that toggle, audio worked fine for the rest of the session.

**Cause:** `VideoTile` put a peer's audio and video on the *same* `<video>`
element. The peer connection carries both kinds from the moment it's
established (`useWebRTC` declares an audio and a video transceiver up front so
toggling a camera later is a bare `replaceTrack`), so a peer with their camera
off is still sending a video track — one that simply produces no frames. A
media element bound to a MediaStream that contains a video track won't advance
past `readyState 0` until frames actually arrive, and until it starts playing
it plays *nothing* — including the audio track sitting alongside it. So the
mic was flowing over the wire the whole time and just never got played out.
Turning the camera on delivered the first frames, playback finally started,
and the audio came with it — which is exactly why the camera looked like the
thing that "fixed" the mic.

**What changed:**
- `components/VideoTile.tsx` — remote audio now plays on its own `<audio>`
  element, fed a MediaStream built from only the stream's audio tracks; the
  `<video>` element gets only the video tracks and is muted permanently. With
  no video track gating it, the audio element starts as soon as sound arrives,
  independent of whether anyone's camera is on. The self tile is unchanged in
  behaviour — it stays video-only, since playing your own mic back is feedback.
- The autoplay-blocked fallback (the Unmute badge and the first-gesture retry)
  now targets the audio element. It also got simpler: there's no longer a
  "fall back to muted playback so at least the picture shows" step, because
  the picture is on a separate, always-muted element that was never at risk.

**Verified:** clean `tsc --noEmit`, clean `eslint` on the changed file.

**Not verified in a browser:** two real tabs with mic on and camera off, to
confirm audio is now audible without touching the camera.

---

## Monaco loaded from a CDN, so its web workers never spawned

**Task:** Three Monaco errors in the dev-server log — `Could not create web
worker(s)`, `Uncaught TypeError: url.startsWith is not a function` (twice), and
`Duplicate definition of module 'vs/cpp-...'`.

**Cause:** all three, one root. `components/CodeEditor.tsx` used
`@monaco-editor/react` without ever calling `loader.config`, so the loader fell
back to its pinned default and pulled Monaco from
`cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`. Monaco derives its worker
URLs from the base URL it was loaded from, and a browser will not construct a
`Worker` from a cross-origin script — so worker creation threw, Monaco caught
it and ran the language services on the main thread instead (that's the
"might cause UI freezes" warning, on the one thread two people are typing
into), the same fallback path threw `url.startsWith is not a function`, and
the AMD loader double-registered language modules. A version skew came free
with it: the CDN was serving 0.55.1 while `node_modules` had 0.56.0, so the
editor on screen wasn't the version in the lockfile.

**What changed:**
- `scripts/copy-monaco.mjs` (new) — vendors `monaco-editor/min/vs` into
  `public/monaco/vs`. Version-stamped, so it's a no-op unless the installed
  version actually changed rather than re-copying thousands of files on every
  `npm run dev`.
- `package.json` — `monaco-editor` promoted from an unlisted transitive peer
  to a real dependency (we now vendor from it, so it should be pinned);
  `postinstall`/`predev`/`prebuild` run the copy so a fresh clone just works.
- `lib/monacoSetup.ts` (new) — `loader.config({ paths: { vs: "/monaco/vs" } })`.
  Safe at module scope: `config()` only merges into the loader's own state
  object and touches neither `window` nor Monaco, so it's inert during SSR.
- `components/CodeEditor.tsx` — imports that module for its side effect.
- `.gitignore` — `/public/monaco` is generated, not committed (27MB).

I first tried bundling the workers directly
(`new Worker(new URL("monaco-editor/esm/...", import.meta.url))`), which is the
webpack-era idiom. Turbopack does not resolve bare package specifiers inside
`new URL()` and the build failed with module-not-found; self-hosting the
prebuilt AMD bundle avoids the bundler entirely and is Monaco's own documented
setup.

**Verified:** clean `tsc --noEmit`, clean `eslint`, clean `next build`. Every
AMD dependency in `editor.main.js`'s define() list plus `editor.main.css`
serves 200 from our own origin.

**Not verified in a browser:** the extension was disconnected, so I could not
watch the three console errors disappear or confirm the workers now spawn.
That is the one check still outstanding on this change.

---

## A missed WebRTC offer stranded the call permanently

**Task:** Follow-up to the mic fix above. While testing that in two browsers I
found the calls weren't connecting at all, and the reason wasn't the audio
change — it was that the handshake had no recovery path.

**Cause:** signaling is fire-and-forget. If the opening offer never reaches the
far side — they were still loading, their event stream was mid-reconnect and
an earlier connection had already drained the queued copy — the connection
parks at `connectionState: "new"` and stays there for the rest of the session.
Nothing recovers it: `"failed"` is never reached, so the teardown in
`onconnectionstatechange` never runs, and the reconciliation effect only
re-runs when presence, room id, or user id changes. The comment claiming the
reconciliation effect "rebuilds it on its next pass" was wrong — there is no
next pass. Observed live: one peer sat at
`signalingState: "have-local-offer", remoteDescription: false` indefinitely
while the other never sent so much as a `hello`.

**What changed** (all in `hooks/useWebRTC.ts`):
- A watchdog on a 4s interval re-sends the opening signal for any peer whose
  connection hasn't got a reply yet, and rebuilds any peer that's in the room
  but has no connection at all (the state a `"failed"` teardown leaves behind —
  so that path now genuinely does get rebuilt, as its comment always claimed).
  It replays the *existing* offer rather than creating a new one: the far side
  simply never saw it, and replaying is idempotent there — no new ICE
  credentials, no renegotiation churn.
- Anything past `setRemoteDescription` is deliberately left alone. From there
  ICE owns the outcome and does its own retrying, ending at `"failed"` if it
  genuinely can't connect, which the existing teardown already handles.
- Attempts are capped at 5 and counted per *peer*, not per connection, so a
  rebuild doesn't reset the budget and spin forever. The count clears when the
  peer connects or leaves the room. An unreachable peer (no TURN on a
  locked-down network) goes quiet instead of signaling for the whole session.
- A repeat `hello` from a peer we've already offered to and heard nothing back
  from now replays the offer instead of being ignored, so the answering side's
  nudge actually accomplishes something.

**Also fixed while in here:** the `window.__rtcPeers` debug handle was being
assigned during render, which is an eslint error (`react-hooks/refs`) and
genuinely invalid React. Moved into a mount effect — same handle, no error.

**Verified:** clean `tsc --noEmit`, clean `next build`, and `eslint .` back to
the same 3 pre-existing problems in `app/room/[id]/page.tsx` (it was 4 with the
render-time ref access).

**Not verified in a browser:** the extension stayed disconnected, so the
retry has not been watched actually rescuing a stranded handshake, and the
`<audio>`/`<video>` split from the previous entry still hasn't been confirmed
audible end to end. Both need two real tabs.

---

## GET /editor spent seconds in Postgres for a membership check

**Task:** `GET /api/rooms/[id]/editor` was showing 4.6s and 5.7s of
`application-code` time in the dev log, repeatedly.

**Cause:** measured rather than guessed — I timed both backing stores against
this project's own instances:

| call                                   | cold   | warm                    |
| -------------------------------------- | ------ | ----------------------- |
| Postgres (Neon) participant lookup      | 3047ms | ~263ms, spiking to 1265ms |
| Redis (Upstash) get                     | 28ms   | ~28ms                     |

The GET handler was calling `isRoomMember`, which goes to Postgres, and
awaiting it *before* the Redis document read rather than alongside it. So the
endpoint paid a full Neon round trip — several seconds on a cold connection —
before it even started fetching what it was asked for. `/signal` was moved off
this exact check earlier for the same reason; `/editor` never was.

That matters more here than the raw numbers suggest: GET /editor is the
recovery path, the thing a client hits when it has drifted or its event stream
never came up. It was the slowest endpoint in the app precisely when the app
was already in trouble.

**What changed** (`app/api/rooms/[id]/editor/route.ts`):
- `GET` uses `isRoomMemberCached`, and issues it together with `getLiveState`
  under one `Promise.all` instead of in series — so the check is ~28ms instead
  of 263-3047ms, and overlaps the read it used to block.
- `POST` uses `isRoomMemberCached` for its pre-turn fallback too. That branch
  runs on *every keystroke* for as long as a room has no turn started, so it
  was quietly putting a ~263ms Postgres round trip on the write path; the
  existing comment dismissed it as "rare", which it isn't.

Both are the same trust model already relied on elsewhere: `getRoomMeta` reads
Redis and falls back to Postgres on a miss (repopulating as it goes), and
`joinRoom`/`leaveRoom` invalidate it synchronously in the same request that
changes membership. No weakening of the check, just a different read path.

**Verified:** clean `tsc --noEmit`, clean `next build`, `eslint .` unchanged at
the same 3 pre-existing problems. The store-level timings above are measured;
the end-to-end endpoint timing is not, since reproducing it needs an
authenticated session.
