# Task Log

A running record of work done on this project, in plain language.

---

## Infra check-in

**Date:** 2026-08-23

**Task:** Asked for a gut-check on whether the current infrastructure is in
good shape, after the day's round of persistence/realtime fixes (offline-aware
turn rotation, instant-leave-on-close, presence-timeout room disband).

**Assessment:** Overall solid for what this is — Neon Postgres for durable
state, Upstash Redis for live state/pub-sub, SSE instead of polling, atomic
CAS writes on the shared editor, lazy cleanup instead of a cron. Today's
changes closed the real gaps that existed (rotation landing on offline
players, rooms never getting disbanded, no instant leave on tab close).

**One real risk worth knowing about:** SSE over Vercel serverless functions
is an awkward fit at real scale — every connected client holds both a Node
function alive *and* a dedicated Redis subscriber connection for as long as
the stream stays open. Vercel's function max-duration will eventually
force-disconnect long-running sessions (invisible to users — the client
already reconnects on its own — just periodic churn), and Upstash's
concurrent-connection cap is the more likely real ceiling if many rooms are
ever open at once.

**How to apply:** Fine as-is for personal/small-group use. Before assuming
this scales further, check the Upstash plan's max concurrent connections
against realistic simultaneous-room/participant counts — that's the number
that would actually need attention first.

---

## Leave instantly on tab close (Meet-style), keep presence timeout as fallback

**Date:** 2026-08-23

**Task:** Follow-up to the previous entry's presence-timeout-based room
disband — asked whether a Google Meet-style "closing the tab leaves the room
immediately" approach would be better.

**Approach:** Better for the common case, not a replacement for the fallback.
Added a `pagehide` listener in `app/room/[id]/page.tsx` that calls
`navigator.sendBeacon('/api/rooms/${roomId}/leave')` the moment the tab
actually closes or navigates away (skipped when `event.persisted` — that's
the page being frozen into the back/forward cache, not a real departure).
`sendBeacon` is what makes this reliable during unload, where a normal
`fetch` can get cancelled before it reaches the network. The existing
`/api/rooms/[id]/leave` route needed no changes — it already doesn't read a
request body, and `sendBeacon` carries the session cookie same-origin, so
Clerk auth just works.

This sits on top of the presence-timeout fallback from the previous entry,
not instead of it — `pagehide` never fires for a crash, a force-quit, or the
OS killing the tab, so that fallback is still what eventually cleans those
cases up. Clean tab-closes now disband a now-empty room immediately (via the
existing `leaveRoom` → `deleteRoom` path); everything else still gets swept
within `EMPTY_ROOM_GRACE_MS` the next time someone reads the room.

---

## Disband a room once everyone's been offline for a while

**Date:** 2026-08-23

**Task:** A room only ever got deleted from Postgres when the last member hit
Leave explicitly. If everyone just closed their tabs — no explicit Leave —
the room (and its participant/session/turn rows) sat in the database
forever.

**Approach:** No background sweep/cron exists in this app, so this piggybacks
on the same lazy-settle pattern `getRoom()` already uses for turn timeouts
("whoever reads the room next notices and fixes it"). `getRoom()` now also
fetches `getOnlineUserIds` and, when a room comes back empty, checks how long
it's been that way via a new Redis marker
(`roomState.markRoomEmptySince`/`clearRoomEmptySince` — first-empty
timestamp, cleared the moment anyone's online again). Once a room has been
empty for `EMPTY_ROOM_GRACE_MS` (5 minutes), the *next* read of it — a poll
from a tab still open elsewhere, an invite-link visit, or the room owner's
own dashboard listing every room they belong to — disbands it via a new
`deleteRoom()` helper (extracted from the inline delete `leaveRoom` already
did on its own "last person out" path, now shared by both).

5 minutes is deliberately generous — long enough that a refresh, a laptop
going to sleep, or a brief wifi drop doesn't cost anyone their room.

**Known limitation:** if literally nobody — not even the owner — ever
reopens the dashboard or the invite link again, the room is never read
again, so it never gets disbanded either; it just sits there harmlessly
(Redis's own live-state TTL still expires in 7 days regardless). Fixing that
fully would need a real background sweep (e.g. Vercel Cron), which felt like
more infrastructure than this warranted — flagged here in case that
changes.

---

## Extension worked on localhost, not on the Vercel deploy

**Date:** 2026-08-23

**Task:** Run/Submit worked against `localhost:3000` but not against
`https://thirty70.vercel.app`.

**Cause:** `extension/manifest.json`'s `externally_connectable.matches` only
listed `localhost:3000` and a placeholder domain — Chrome refuses
`chrome.runtime.connect` from any origin not on that list, silently (no
error surfaces on thirty70's side, the port just disconnects). Replaced the
placeholder with `https://thirty70.vercel.app/*`.

**Still needed on the user's end (can't be done from here):** reload the
extension at `chrome://extensions` to pick up the manifest change, and
confirm `NEXT_PUBLIC_LEETCODE_EXTENSION_ID` is set under the Vercel project's
Environment Variables (it's inlined at build time, so setting it in the
dashboard alone doesn't take effect until the next deploy) — then redeploy.

---

## Skip offline participants when rotating the turn

**Date:** 2026-08-23

**Task:** The turn rotation (`advanceTurn` in `lib/roomState.ts`) picked the
next person in `turnOrder` blindly — pass, timeout, or someone leaving could
all hand the turn to a participant who wasn't actually online to take it,
stalling the room until their turn timed out too.

**Approach:** Added `pickNextTurnHolder(order, onlineUserIds, afterUserId)`
in `lib/roomState.ts` — walks the turn order starting just after
`afterUserId`, wrapping all the way around, and returns the first *online*
candidate. Only falls back to the old blind "next in rotation" pick when
nobody in the order is online at all (better to hand it to someone than
strand the room with no turn holder). `advanceTurn` now calls this instead
of indexing `order` directly, so pass/timeout/leave-triggered rotation all
pick up the fix automatically — none of their own call sites had to change.
`setRoomProblem` (the very first turn, when a problem is picked) uses the
same helper with `afterUserId: null`, so the opening turn also skips
straight to the first online participant.

Deliberately scoped to rotation only — this doesn't interrupt someone
mid-turn the instant they go offline (presence has up to a ~50s window
before someone reads as offline anyway, per `PRESENCE_WINDOW_MS`), it just
keeps the *next* hand-off from landing on them.

---

## Run/Submit against LeetCode via a companion browser extension

**Date:** 2026-08-23

**Task:** Add Run and Submit buttons to the room editor, mirroring
leetcode.com's own — Run grades against the public example test cases,
Submit grades against LeetCode's real hidden suite so it counts toward the
user's actual LeetCode streak/progress.

**Approach:** LeetCode has no public submission API, and the real run/submit
endpoints require an authenticated session — storing users' LeetCode session
cookies on our own server was the first idea but was rejected in favor of a
companion Chrome extension. The extension opens a hidden (`active: false`)
`leetcode.com` tab and runs a content script inside it, so it calls
LeetCode's `interpret_solution`/`submit` endpoints as same-origin requests —
the browser attaches the user's existing LeetCode session automatically.
Nothing sensitive is ever read, stored, or sent to thirty70's servers or DB;
the whole feature is client-side, no backend changes were needed.

**What changed:**
- New `extension/` folder (kept separate from the Next.js app): a Manifest V3
  extension — `background.js` (opens the hidden LeetCode tab and relays
  messages), `content-scripts/leetcode.js` (calls LeetCode's run/submit
  endpoints and polls for the graded result), and a README with load/setup
  steps. Registered against thirty70's origin via `externally_connectable`.
- `lib/leetcodeBridge.ts` — client-side wrapper around
  `chrome.runtime.connect` that the website uses to talk to the extension,
  with typed run/submit payloads and results.
- `components/JudgePanel.tsx` — a slide-up panel covering the bottom half of
  the code editor pane, showing a staged loader ("Opening LeetCode...",
  "Running...", "Submitting...") and then per-testcase pass/fail (Run) or
  Accepted/Wrong Answer + runtime/memory percentiles (Submit).
- `components/CodeEditor.tsx` — added Run/Submit buttons (visible once a
  problem is loaded, disabled when it isn't the user's turn) that drive the
  bridge and render `JudgePanel`.
- `lib/leetcode.ts` — added an exported `LEETCODE_LANG_SLUGS` map (our editor
  language values -> LeetCode's langSlug values), replacing a duplicate map
  that lived locally in the room page.
- `app/room/[id]/page.tsx` — threads `questionId`/`exampleTestcases`/slug and
  the shared editor's `getCode()` down into `CodeEditor`.
- `.env.local` — added `NEXT_PUBLIC_LEETCODE_EXTENSION_ID` (empty; filled in
  after loading the extension unpacked once, per its README).

**Follow-up (same day):** a real Wrong Answer submit ("38/65 testcases
passed") showed no detail on what failed — `normalizeResult()` for submit
mode only ever mapped status/counts/runtime/memory, never the failing case.
Added `failingCase` (input/actual/expected for the first hidden case that
failed, when LeetCode's check response includes one) to the submit result
shape and rendered it in `JudgePanel`.

**Follow-up (same day): broadcast Run/Submit to the whole room.** Results
were only visible locally to whoever clicked. Buttons stay turn-gated (only
the turn holder can trigger a run/submit — that's still enforced both by
hiding the buttons in `CodeEditor` and, now, server-side), but the loader and
result are now broadcast so everyone in the room watches the same thing.

- `lib/editorDoc.ts` — added `JudgeBroadcast`/`JudgeEvent` wire types
  (loading stage / result / error, tagged with the acting user's id + name).
- `lib/roomState.ts` — added `publishJudgeEvent`, publishing onto the same
  Redis room channel turn/presence/media updates already use.
- `app/api/rooms/[id]/judge/route.ts` — new route the acting client posts
  each stage/result/error to. Re-validates turn-holder status server-side
  (same `currentTurnUserId === userId, else membership` rule as the editor's
  write path) so the broadcast can't be forged by someone who isn't holding
  the turn, even though the extension call itself still only ever runs in
  the turn holder's own browser (it's the only one with their LeetCode
  session).
- `hooks/useSharedEditor.ts` — added an `onJudgeEvent` callback alongside the
  existing `onRoomEvent`/`onSignal`, fed by the same SSE connection/Redis
  subscriber.
- `app/room/[id]/page.tsx` — judge state (and the actual `runOnLeetCode`
  call + POSTing progress to the new route) moved up from `CodeEditor` into
  the page, since broadcasting needs `roomId`/`myUserId`/participant names
  that `CodeEditor` didn't otherwise need. A local `judgeDismissed` flag lets
  each viewer close their own view of the panel without affecting anyone
  else; it resets whenever a fresh run/submit's first ("opening") stage
  arrives.
- `components/CodeEditor.tsx` — now purely presentational for this feature:
  takes `onRun`/`onSubmit`/`judgeState`/`isJudgeSelf`/`onCloseJudge` as props
  instead of owning the extension call itself.
- `components/JudgePanel.tsx` — header now reads "Submitting…"/"Run Result"
  for the acting user and "{name} — submitting…" etc. for everyone else
  watching.

**Scope notes for next time:** an Accepted submit still doesn't write back
into the `turns`/`sessions` tables (turn `result: "solved"`, session
completion) — left open pending a decision on whether a non-Accepted submit
should still end the turn.

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

---

## Cap rooms at 4 people (free-tier limit)

**Date:** 2026-08-22

**Task:** Full-mesh WebRTC (every participant connects to every other one
directly) stops scaling past a handful of people — bandwidth and CPU both
grow per person with room size, since each device uploads its own camera
once per peer it's sending to. Rather than let a room limp along past that
point, we agreed to make 4 people a hard ceiling now, framed as the free
tier's room size (a paid tier with an SFU behind it, for larger rooms, is a
future project — not built here).

**What changed:**
- New `lib/roomLimits.ts` — `MAX_ROOM_PARTICIPANTS = 4`, free of any
  runtime dependency so both server code and client components import the
  same constant without either pulling in the other's stack.
- `lib/rooms.ts` — `joinRoom`'s insert and its capacity check are now one
  atomic statement (`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) <
  MAX_ROOM_PARTICIPANTS ON CONFLICT DO UPDATE`), so two people joining at
  the same moment can't both slip past the check and land at 5 — the
  database enforces it, not a check-then-insert race in application code.
  The joining user's own row is excluded from the count, so someone
  already active (a duplicate join call) or rejoining after leaving is
  never blocked by their own past membership. A join that's turned away
  throws, rather than silently returning null like a not-found room, so
  the route can tell the two cases apart.
- `app/api/rooms/join/route.ts` — catches that throw and returns `409`
  with the message, instead of the generic room-not-found `404`.
- `app/join/[code]/page.tsx` — the invite-link landing page now renders an
  actual card (icon, heading, plain-language explanation, a way back to
  the dashboard) instead of a bare line of red text, and reads the `409`
  specifically to show "This room is full" rather than a generic error.
- `components/ParticipantsList.tsx` — the header's participant count now
  reads `{joined}/{MAX_ROOM_PARTICIPANTS} in room` at all times (e.g.
  "4/4"), instead of the old online/total split — the cap is visible
  before anyone hits it, not just at the moment a join is refused. Online
  status is unchanged, still shown per-avatar via the presence dot.

**Verified:** clean `tsc --noEmit`. `eslint` and a live dev-server boot were
both still queued when this was written — the dev toolchain in this
sandbox session was unusually slow to respond (long stretches at near-zero
CPU on tsc, eslint, and `next dev` alike), separate from anything in this
change. A static, pixel-matched preview of the two UI states (real markup
and color values, copied out of the actual files) was rendered instead to
confirm layout and copy read correctly.

**Not verified in a browser:** the actual 409 path end to end — that
needs a room already at 4 real members and a 5th real account attempting
to join, which two sessions can't easily set up alone. Worth a real
five-account pass before trusting this in production: confirm the 4th
join succeeds, the 5th is refused with the popup shown above, and that
someone leaving frees a slot for the next joiner.

---

## Dodo Payments — Pro subscription unlocking bigger rooms

**Date:** 2026-08-23

**Task:** Set up Dodo Payments so users can subscribe to a "Pro" plan.
Scoped down from the original ask (which also mentioned premium LeetCode
problems) after establishing that premium-problem content is gated by
LeetCode's own API requiring a Premium session cookie — a separate,
riskier piece of work with nothing to do with payments — so this pass only
gates room size, bumping the room-owner's cap from the free tier's 4 (see
the prior entry) to 8 for Pro. That cap is still a modest bump, not a real
scale-up: rooms still ride the same full-mesh WebRTC, which is the actual
ceiling until an SFU exists.

**What changed:**
- `lib/db/schema.ts` — `users` gains `plan` (`user_plan` enum: `free` |
  `pro`, default `free`), `dodoCustomerId`, `dodoSubscriptionId`.
  Migration: `drizzle/0002_naive_morlocks.sql`.
- `lib/roomLimits.ts` — added `MAX_ROOM_PARTICIPANTS_PRO = 8`, a `UserPlan`
  type, and `getMaxParticipants(plan)`. Still dependency-free so client
  components can compute the cap without pulling in server code.
- `lib/dodo.ts` — the `dodopayments` SDK client. Defaults to `test_mode`
  rather than the SDK's own `live_mode` default, so a missing/misconfigured
  `DODO_PAYMENTS_ENVIRONMENT` can't accidentally take a real payment.
- `lib/billing.ts` — `getUserPlan`, `createUpgradeCheckout` (creates a Dodo
  checkout session for the Pro product, stamping `metadata.userId` with the
  Clerk id so the webhook can match a subscription back to a row without
  trusting anything client-supplied), and `applySubscriptionEvent` (applies
  a verified webhook's subscription status to that user's `plan`/Dodo ids —
  matches by `metadata.userId` first, falls back to matching by
  `dodoSubscriptionId` for events that don't carry it, e.g. dashboard-
  initiated changes).
- `app/api/billing/checkout/route.ts` — POST, auth'd via Clerk, returns a
  `checkoutUrl` to redirect the browser to.
- `app/api/billing/status/route.ts` — GET, returns the caller's plan.
- `app/api/webhooks/dodo/route.ts` — verifies Dodo's signature
  (`dodo.webhooks.unwrap`, 401 on failure) and applies every
  `subscription.*` event type to the matching user.
- `proxy.ts` — added `/api/webhooks/dodo` to the public-route matcher, since
  Dodo calls it server-to-server with no Clerk session; the route verifies
  Dodo's own signature instead.
- `lib/rooms.ts` — `Room` and `joinRoom` now resolve the cap from the room
  owner's plan (`getMaxParticipants(roomRow.owner.plan)`) instead of the
  flat free-tier constant, still inside the same atomic
  insert-if-under-capacity statement so the check-and-join can't race.
- `lib/roomState.ts` — `CachedRoomMeta` gained `ownerPlan`, threaded through
  from Postgres so the cached record carries it too.
- `components/PlanStatus.tsx` — new dashboard widget: shows a Pro badge or
  an "Upgrade to Pro" button that POSTs to the checkout route and redirects.
  After a `?upgrade=success` bounce back from checkout it polls
  `/api/billing/status` briefly (webhook processing lags the redirect by a
  beat) rather than showing "Free" for a plan that's actually already Pro.
- `app/dashboard/page.tsx`, `components/RoomHeader.tsx`,
  `components/ParticipantsList.tsx`, `app/room/[id]/page.tsx` — threaded
  `ownerPlan`/`maxParticipants` through so the room header shows the real
  cap (e.g. "3/8 in room" for a Pro-owned room) instead of the hardcoded
  free-tier number.
- `.env.local` — added the (empty) Dodo env vars with comments on where to
  find each value in the dashboard: `DODO_PAYMENTS_API_KEY`,
  `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT` (defaults to
  `test_mode`), `DODO_PAYMENTS_PRO_PRODUCT_ID`, `NEXT_PUBLIC_APP_URL`.

**Verified:** clean `tsc --noEmit`, clean `next build` (confirms the
`Suspense` boundary around `<PlanStatus />` — required because it calls
`useSearchParams()` — doesn't force `/dashboard` off the static path; it's
still prerendered). `eslint` unchanged at the same pre-existing 2 errors in
`app/room/[id]/page.tsx` plus one new one of the same already-established
shape in `PlanStatus.tsx:33` (calling an async fetch function directly in a
`useEffect` body) — consistent with the pattern already used for
`fetchRoom` in the room page, not a new category of issue.

**Not done / needs the user:** the Dodo dashboard side — no account existed
yet. They still need to sign up at dashboard.dodopayments.com, switch to
test mode, create a Pro subscription product, generate an API key, and
register a webhook endpoint (`/api/webhooks/dodo`) subscribed to at least
`subscription.active`, `subscription.renewed`, `subscription.cancelled`,
`subscription.expired`, `subscription.failed`, `subscription.on_hold` — then
fill in the five env vars above and run the pending migration
(`npm run db:migrate` or `db:push`). Nothing here has been exercised against
a live Dodo checkout or a real webhook delivery.

**Incident during this task:** two sequential `git stash && ... ; git stash
pop` commands (used to diff current changes against a clean tree, to tell
which lint/type errors were pre-existing) resulted in the second `stash`
capturing only 5 of the 12 modified tracked files — the other 7
(`app/dashboard/page.tsx`, `components/ParticipantsList.tsx`,
`lib/db/schema.ts`, `lib/roomLimits.ts`, `lib/roomState.ts`, `package.json`,
`package-lock.json`) had reverted to match `HEAD` by the time that second
stash ran, for a reason that isn't understood — no destructive command was
knowingly run against them in between. Recovered by reading the content
back out of the first stash's dangling commit (`git show <sha>:<path>`,
found via `git fsck`) and rewriting each file; `package-lock.json` was
regenerated with `npm install` instead of restored by hand. Confirmed fully
recovered via `tsc`, `eslint`, and `next build` all passing clean
afterward. Takeaway: don't use `git stash` as a scratch diffing tool on a
tree with real uncommitted work — compare with `git show <sha>:<path> |
diff -` or a worktree instead, so there's nothing for a failed pop to lose.

---

## UI overhaul — new landing page, sidebar app shell, competitive mode, settings

**Date:** 2026-09-06

**Task:** Replace the whole UI. New landing page; signed-in users land on a
dashboard that sits inside a persistent left sidebar carrying a mode
switcher (Rooms / Competitive) and, at its foot, a profile block with
settings and the Pro subscription. Ran the `redesign-existing-projects`
design skill's audit over the existing pages first — the fixes below track
its findings (generic 3-card feature row, no empty/loading states, no
active-nav indication, missing 404/legal/skip-link, flat surfaces).

**What changed:**
- `app/(app)/layout.tsx` — new route group holding every signed-in surface
  behind one shell: `<Sidebar />` plus a `<main>`. The group parens keep the
  URLs (`/dashboard`, `/competitive`, `/settings`) unchanged, so nothing
  that links to `/dashboard` had to move. `Sidebar` is wrapped in
  `Suspense` because it reads `useSearchParams()` (via the billing hook) —
  without it the whole group drops off the static path.
- `components/dashboard/Sidebar.tsx` — brand mark, nav (`Rooms`,
  `Competitive`) with an active state driven by `usePathname`, and a footer
  block: inline "Upgrade to Pro" (hidden once the user is Pro), Clerk
  avatar + name, plan line, and a gear linking to `/settings`.
- `hooks/useBillingPlan.ts` — the plan-fetch / post-checkout polling /
  upgrade-redirect logic lifted out of `PlanStatus` so the sidebar pill and
  the settings card share one implementation instead of two copies of the
  `?upgrade=success` poll.
- `components/PlanStatus.tsx` — now the settings page's billing card (plan
  name + perk list + upgrade CTA) rather than a dashboard-header pill; the
  compact plan display lives in the sidebar.
- `app/(app)/dashboard/page.tsx` — moved from `app/dashboard/`. Header
  removed (the shell provides it), plan widget removed (now in the
  sidebar), skeleton rows replace the "Loading rooms..." text, and the
  empty state is a composed block rather than a bare line.
- `app/(app)/competitive/page.tsx` — new. Competitive mode has no backend
  yet, so this is an honest "in development" page (1v1 duels, brackets, a
  local-only notify toggle) instead of a dead nav item.
- `app/(app)/settings/page.tsx` — new. Account row with Clerk's
  `openUserProfile()` for credential management, the subscription card, and
  an explicit sign-out.
- `app/page.tsx` — rebuilt landing page: asymmetric hero with a static room
  mockup instead of the centered-hero-plus-three-equal-cards layout, a
  two-up feature row, a "two ways to show up" section previewing
  Rooms/Competitive, and a footer with legal links.
- `app/privacy/page.tsx`, `app/terms/page.tsx` — new, so the footer links
  aren't dead. Both added to `proxy.ts`'s public-route matcher since they
  must render signed-out.
- `app/not-found.tsx` — new branded 404.
- `app/layout.tsx` — skip-to-content link, OG metadata.
- `app/globals.css` — smooth scroll, tabular figures, selection colour, a
  focus-visible ring, an SVG-noise `.grain-overlay`, and a `fade-in-up`
  entry animation.
- `app/sign-in/…`, `app/sign-up/…` — brand mark above the Clerk card and
  `appearance.variables` matched to the palette (note: Clerk 7 renamed the
  theming keys — it's `colorForeground` / `colorMutedForeground`, not
  `colorText` / `colorTextSecondary`, which fail typecheck).

**Untouched:** `app/room/[id]` and `app/join/[code]`. The room is a
full-bleed editor surface, not a dashboard page, so it keeps its own
`Header` and stays outside the shell.

**Verified:** clean `tsc --noEmit`; clean `next build` with `/dashboard`,
`/competitive`, `/settings`, `/privacy`, `/terms` all still prerendered
static. `eslint` back at the pre-existing baseline of 3 errors (2 in
`app/room/[id]/page.tsx`, 1 `set-state-in-effect` that moved with the
billing logic from `PlanStatus.tsx` into `useBillingPlan.ts`). Walked the
running dev server in Chrome: landing (redirect temporarily stubbed to see
the signed-out view, then restored), dashboard, competitive, and settings
all render, nav active states track the route, no console errors.

**Not done:** competitive mode is presentation only — no matchmaking,
rooms, or scoring behind it, and the notify button doesn't persist
anywhere.

---

## Leaving a room: confirmation on the way out, one room per user, host succession

**Date:** 2026-09-06

**Task:** The back arrow in the room header walked out of the page without
ever leaving the room, so the membership stayed behind. It now asks first
and actually removes you. On top of that: a user may only be in one room at
a time, and a host who leaves hands the room to the next person in the turn
queue rather than taking it with them.

**What changed:**
- `components/ConfirmDialog.tsx` — new. Small modal (backdrop click, Escape,
  focus on the confirm button). Deliberately not `window.confirm()`: that
  blocks the tab, which in a room means the realtime stream and the turn
  clock stall behind the prompt.
- `components/RoomHeader.tsx` — the back arrow was a `<Link href="/dashboard">`,
  which is exactly the hole: a client-side navigation fires no `pagehide`,
  so the beacon in `app/room/[id]/page.tsx` never ran and the person stayed
  a member of a room they'd walked out of. It's now a button, and both it
  and the existing Leave button open the same confirmation. The dialog's
  wording follows the situation — last one out ("the room will be closed"),
  host ("the next person in the turn queue becomes the host"), or a plain
  member who can rejoin with the invite link — which needs the two new
  props, `isHost` and `participantCount`.
- `lib/rooms.ts` — `leaveOtherRooms(userId, keepRoomId)`, called at the end
  of `createRoom` and `joinRoom`. After, never before: a join that turns out
  to be full shouldn't cost someone the room they were already in. One room
  per person is what the rest of the app already assumes — presence, the
  turn slot, and the WebRTC mesh are all per-user, and a stale membership
  would keep occupying a seat against the room's cap and a place in its
  rotation.
- `lib/rooms.ts` — `leaveRoom` promotes a new host when the departing user
  owned the room and anyone is left: `nextInQueue()` walks the turn order
  from the leaver, wrapping, for the first member still present, falling
  back to the longest-standing member if the rotation hasn't been seeded
  yet. Consequence worth knowing: the participant cap follows the new host's
  plan, so a Pro-sized room inherited by a free host can't grow further
  (nobody already inside is removed).
- `lib/editorDoc.ts`, `lib/rooms.ts` — `RoomSnapshot` now carries `ownerId`
  and `ownerPlan`. Without them a promoted host's client kept hiding the
  host-only controls until a refresh, since ownership was only ever seeded
  by the one-shot `GET /api/rooms/[id]`.
- `lib/rooms.ts` — `deleteRoom` broadcasts a final snapshot with an empty
  participant list before the row goes away. Found while testing: a second
  tab sitting in a room that got disbanded just kept rendering it. Every
  other exit broadcasts a list the client can find itself missing from, but
  a deleted room can't broadcast for itself and there's no poll left to trip
  over a 404. Clients already treat "I'm not in the participants" as "go to
  the dashboard", so this reuses that path. Covers the empty-room sweep in
  `getRoom` too.

**Verified:** clean `tsc --noEmit` and `next build`; `eslint` unchanged at
the pre-existing 3 errors. Walked it in Chrome against the dev server: back
arrow opens the dialog, "Stay" dismisses it, "Leave room" removes you and
lands on the dashboard with the room gone. Two-tab test of the one-room
rule — in room "alpha", created "beta" from a second tab; the dashboard then
listed only "beta", and (after the closure broadcast above) the tab still
sitting in the disbanded room bounced itself to the dashboard.

**Not verified:** host succession end to end — that needs a second account
in the room, which this session had no way to sign in as. The transfer is
covered by types and build only.

**Note:** testing created and removed rooms in the dev database, and an
existing empty test room named "ewf" was disbanded by the first leave test.

---

## Room panes open 25/50/25 instead of near-equal thirds

**Date:** 2026-09-06

**Task:** The three panes in a room (problem, editor, participants) opened at
roughly equal thirds. The editor is the pane people are actually working in
for the whole turn, so it should get the space.

**What changed:**
- `app/room/[id]/page.tsx` — the first-render seeding now gives the problem
  and participant columns 25% of the row each, leaving the editor ~50%.
  Previously it was `0.7 * 0.45` (31.5%) for the problem and `0.3` for
  participants, which left the editor with about the same share as each
  side pane. The existing min/max clamps are unchanged, so narrow windows
  still floor at `MIN_PROBLEM_WIDTH`/`MIN_PARTICIPANTS_WIDTH` and very wide
  ones still cap the side panes rather than letting them grow forever.
  Seeding still happens once per page load — dragging a handle after that
  is untouched.

**Verified:** clean `tsc --noEmit`; `eslint` unchanged at the pre-existing 3
errors.

**Not verified in the browser, deliberately:** the account was sitting in a
live room ("rfew") at the time. Both ways of checking this would have
disrupted that session — creating a new room evicts the user from their
current one under the one-room rule, and merely opening then closing the
live room fires the `pagehide` leave beacon, which would drop their other
tab out of the room too. The change is two constants in the same clamped
expression; it takes effect on the next room page load.

---

## Repo audit: removed dead code, catalogued architectural risks

**Date:** 2026-09-09

**Task:** Sweep the whole repo for unnecessary code to delete, and for
architectural decisions worth revisiting.

**What changed (deletions only — no behaviour change):**
- `lib/roomState.ts` — dropped `patchCachedRoomMeta` (never called; every
  caller uses `setCachedRoomMeta` with a spread instead) and `setLiveCode`
  (only reachable through the legacy whole-document save below).
- `lib/rooms.ts` — dropped `updateRoomCode` and the `UpdateCodeResult` type.
  The live editor path (`/api/rooms/[id]/editor`, compare-and-set + deltas)
  replaced it; no client sends a code-only body any more. Also dropped
  `Room.code` / `Room.language`: nothing reads them, and `GET
  /api/rooms/[id]` was shipping the entire editor document (up to
  `MAX_DOC_CHARS`, 200k) in a response the client uses only for name/owner/
  invite code — `/stream` sends the document a moment later regardless.
- `app/api/rooms/[id]/sync/route.ts` — removed the unreachable code-only
  branch. The route now does exactly one thing (set the problem); comment
  updated to say the name is a leftover.
- `lib/leetcodeBridge.ts` — dropped `isExtensionConfigured` (never called).
- `lib/leetcode.ts` — stopped requesting `metaData` and `sampleTestCase` from
  LeetCode's GraphQL API; neither is read anywhere, and `metaData` is a large
  JSON blob that was being fetched and cached for nothing.
- `components/RoomHeader.tsx` — removed the `participantCount` prop, which
  duplicated `participants.length` from the prop right next to it.

**Verified:** clean `tsc --noEmit`; `next build` succeeds; `eslint` unchanged
at the same 3 pre-existing `react-hooks/set-state-in-effect` errors
(`app/room/[id]/page.tsx` ×2, `hooks/useBillingPlan.ts` ×1).

**Not changed, reported instead:** turn-timeout latency now bounded by the
20s SSE heartbeat; no `maxDuration` on the SSE route (Vercel will cut the
stream at the platform default and each reconnect opens a fresh Redis
subscriber); Pro's 8-person cap on full-mesh WebRTC with no TURN; unvalidated
`judge.result` payload that can crash every other client's render; the
write-only `sessions`/`turns` tables and the never-read `rooms.status`
column; the dashboard's room *list* under a one-room-per-user invariant; and
a README that still describes an in-memory store with 1.5s polling.

---

## Fixed the audit findings: turn clock, judge validation, SSE limits, history

**Date:** 2026-09-09

**Task:** Work through the issues found in the repo audit above.

**P0 — things that were actively failing:**

- `app/api/rooms/[id]/stream/route.ts` — added `maxDuration = 60`. An SSE
  stream is a function that never returns, so Vercel was cutting it at the
  Hobby default with no acknowledgement anywhere that this happens; now it's
  deliberate and documented, and `PRESENCE_WINDOW_MS` (50s) already rides out
  the reconnect gap. Also halved the per-connect cost: the route built a full
  room snapshot for the connecting client and then `broadcastRoomUpdate`
  built a *second* one to announce them. Since `touchPresence` already ran,
  the first snapshot is correct for both — one `getRoom` per connection
  instead of two, on a path that now runs every 60s per tab.
- `app/api/rooms/[id]/judge/route.ts` — the payload is validated field by
  field and rebuilt, rather than the envelope being checked and the rest
  cast. Previously `judge.result` was unvalidated and published straight to
  every other client, where `JudgePanel` renders it: a member could send
  `cases: "x"` and take down everyone else's room page with a render-time
  `.map is not a function`. Strings and array lengths are capped, since this
  is a broadcast path. `userId` now comes from the session rather than the
  body, so the actor can't be spoofed either.
- Turn expiry is now enforced, not advisory. `roomState.isTurnExpired` is a
  pure check on state the hot paths already read, so `/editor` and `/judge`
  reject writes past the deadline for free — before this, whoever held the
  turn when it expired kept typing until an unrelated read noticed.
- New `POST /api/rooms/[id]/turn/expire` plus an effect in `TurnBar`: with
  polling gone, nothing server-side watched the clock, so the rotation only
  moved on the 20s SSE heartbeat and a turn could sit visibly at 0:00 for
  most of that. Every client already counts the same deadline down, so the
  first to reach zero says so. Safe to be hit by everyone at once —
  `settleExpiredTurn` claims the turn number atomically — and safe to be hit
  early or by a skewed clock, since the server re-checks the deadline itself.

**P1 — correctness:**

- `getRoom` now rebuilds an empty `turnOrder` from the participant list when
  the room has a problem loaded. Two ways in: the Redis key expiring or being
  evicted, and the last queued player leaving a room that still holds an
  offline participant (`leaveRoom` empties the queue and `addToTurnOrder`
  won't reopen an empty one). Either left the room permanently stuck —
  `advanceTurn` can only answer null, so the timer never fires and Pass does
  nothing, with no recovery short of picking a new problem. Also starts a
  turn if nobody holds one, so a rebuilt rotation doesn't look like the stall
  it just recovered from.
- `POST /api/rooms/join` returned `{ room: null }` with a 200 when the room
  vanished mid-join; the client reads `room.id` off it and throws. Now a 404.
- The empty-room sweep is extracted to `sweepIfAbandoned` and backed by
  `/api/cron/sweep-rooms` (daily, `vercel.json`, `CRON_SECRET`-gated,
  exempted from Clerk in `proxy.ts`). The read-path sweep stays — it's what
  makes the five-minute grace window feel like five minutes — but it was the
  *only* sweep, so a room whose members never came back was never read again
  and its Postgres rows sat there forever.

**P2 — history tables, now actually usable:**

- `LiveRoomState` gains `turnJudgeOutcome`. A turn's result is only known when
  the turn *ends*, but a failed submit doesn't end anything, so the verdict
  has to be remembered across the rest of the turn.
- `recordSubmission` (called from the judge route, the only place a real
  LeetCode verdict reaches the server) marks the session `completed` with
  `finalCode`/`finalLanguage` on an accepted submit, guarded on
  `status = 'in_progress'` so the first solve is the one that closes it and
  so it can't race `persistSessionChange`'s abandon.
- `finalTurnResult` writes `solved`/`failed` instead of a flat `passed_turn`.
  Between them, `sessions.status`, `finalCode`, `finalLanguage` and the
  `solved`/`failed` enum members all mean something now; before this they
  were schema nothing ever wrote.
- Dropped `rooms.status` — written once per problem pick, read nowhere, and
  redundant now the session status is real. Migration generated
  (`drizzle/0003_fresh_zarek.sql`) and **since applied** — the `status`
  column and the `room_status` type are both gone from the database, and
  `drizzle.__drizzle_migrations` records four migrations. (This entry
  originally said "not applied"; corrected 2026-09-09 after checking the
  live schema.)

**P3 — cleanup:**

- Dashboard rewritten around one room instead of a list. `leaveOtherRooms`
  has always enforced one active membership per user, so the grid could only
  ever hold one card while implying you could keep several going.
  `getRoomsForUser` → `getCurrentRoomForUser` (`limit(1)`), `GET /api/rooms`
  returns `{ room }` not `{ rooms }`, sidebar label singular.
- `nextInQueue` and `pickNextTurnHolder` were the same walk with different
  eligibility; both now sit on `nextInRotation`.
- One `ParticipantDisplay` type replaces five copies of
  `{userId, name, imageUrl}`; `ProblemPanel`/`ProblemSearch`/the room page
  use `LeetCodeProblemDetail`/`LeetCodeProblemSummary` instead of
  hand-copying them; `RoomData` is now `RoomSnapshot & {id, name,
  inviteCode}` rather than a restatement.
- README rewritten — it still described an in-memory store reset on restart
  and 1.5s polling, and pointed at a `.env.local.example` that doesn't exist.
- **`eslint` is clean for the first time** (was 3
  `react-hooks/set-state-in-effect` errors). `useBillingPlan` and the room
  page now split reading from writing — `readStatus`/`readRoom` return the
  data and the effect decides whether it still wants it — and the room page
  derives `shownProblem` instead of nulling `problemDetail` via setState.

**Verified:** clean `tsc --noEmit`, clean `eslint`, `next build` succeeds.
Not exercised in a live room — that needs two signed-in accounts, and the
turn-expiry and judge-validation paths in particular are worth a manual pass.

**Note:** `.next/` had accumulated iCloud conflict copies (`routes.d 2.ts`
and friends) which `tsc` picks up via the `.next/types/**/*.ts` include and
fails on. Deleted; they come back on any sync, so `find .next -name "* [0-9].*"
-delete` is the fix if `tsc` starts reporting duplicate-identifier errors in
`.next`.

---

## Deferred: one Redis subscriber per room instead of per tab

**Date raised:** 2026-09-09
**Status:** not started

`subscribeRoomChannels` opens a Redis connection per browser tab, and with
the SSE stream cut every 60s on Hobby, each tab opens a fresh one that often.
A four-person room is four connections churning every minute; Upstash bills
and caps on concurrent connections, so this is the ceiling this design hits
first.

The fix is one subscriber per room per server instance, fanning out in-process
to every connected tab, with refcounted teardown when the last tab for a room
disconnects. Deliberately deferred: it's a real refactor with more failure
modes (a leaked subscriber, a room whose last listener leaves mid-publish),
and the `maxDuration` fix plus halving the per-connect work bought enough
headroom to do it properly rather than under pressure.

---

## Deferred: TURN server, and what Pro actually sells

**Date raised:** 2026-09-09
**Status:** not started

Rooms are full-mesh WebRTC with STUN only. Two consequences, both currently
shipped:

1. Anyone behind symmetric NAT or a restrictive corporate network can't
   connect at all. `VideoTile` says "Can't connect" rather than showing a
   blank tile, which is honest but isn't a fix.
2. `MAX_ROOM_PARTICIPANTS_PRO = 8` means 28 peer connections and 7 outbound
   video streams per person. That will not hold up on a home connection, so
   Pro currently advertises a capacity the transport can't deliver.

The plan is to put a TURN relay behind the Pro subscription — which fixes (1)
outright and makes (2) a bandwidth question rather than a connectivity one.
Past roughly 5 people it still wants an SFU, so the 8-person cap should be
revisited alongside that, not before it. Left at 8 for now, deliberately.

---

## Finished the cron setup: generated `CRON_SECRET`, verified all three paths

**Date:** 2026-09-09

**Task:** "Set up cron." The sweep itself was already written in the audit-fix
round — `/api/cron/sweep-rooms`, the daily schedule in `vercel.json`, the
Clerk exemption in `proxy.ts`, the README row. What was missing was the one
thing none of that can supply: an actual `CRON_SECRET` value. Without it the
route answers 503 by design, so as shipped the cron would have run once a day
and done nothing.

**What was done:**

- Generated a 32-byte hex secret and appended `CRON_SECRET` to `.env.local`
  (gitignored), with a comment noting it has to match the value on the Vercel
  project or the cron gets a 401.
- Exercised the route against a local dev server, all three branches:
  unauthenticated → 401 from the *route* rather than a Clerk redirect (which
  is what confirms the `proxy.ts` public-route exemption actually works),
  wrong bearer → 401, correct bearer → 200 `{"scanned":0,"disbanded":0}`.
  Not a 503, which is what confirms the secret is being read.
- Checked the `rooms` table first (empty), so the authorized run had nothing
  to delete — worth doing before firing a room-deleting endpoint by hand.

**Still needs doing by a human:** the same `CRON_SECRET` has to be set on the
Vercel project (Settings → Environment Variables) and the app redeployed.
Vercel only injects the bearer token into cron invocations for deployments
that have it set; until then production returns 503 and the sweep is inert.
`vercel.json` is also still untracked, and Vercel only registers the schedule
once it's committed and deployed.

**Note:** `npx tsc --noEmit` reports four pre-existing errors, all in
duplicated generated files under `.next/types/` (`cache-life.d 2.ts`,
`routes.d 3.ts` — file-sync artifacts, not source). Nothing in `app/` or
`lib/`. Worth deleting `.next/` at some point so the typecheck is clean.

---

## Design pass: reduced motion, dvh, OG image, hero typography

**Date:** 2026-09-09

**Task:** Ran the redesign skill over the project. Worth recording what it
*didn't* find: the app already had a considered design system — one accent
(emerald) on an off-black `#09090b`, Geist, a grain overlay, tinted shadows,
a real custom 404, empty states, loading skeletons, active nav states, a
skip-link, `:focus-visible` rings and legal links. Most of the standard audit
was already satisfied, so this was a narrow pass rather than a redesign.

**What was actually wrong, and fixed:**

- **Nothing honoured `prefers-reduced-motion`** — not one query in the
  codebase. The `fade-in-up` entrance, smooth anchor scrolling and every
  hover transition ran regardless of the OS setting. Added one global
  override in `globals.css` rather than per-component, so it can't be
  forgotten next time something animated is added.
- **`100vh` in 12 places** (`min-h-screen`/`h-screen` across 10 files) — the
  iOS Safari viewport bug, where the URL bar makes `vh` taller than the
  visible area and the layout jumps on scroll. All migrated to `dvh`.
- **No `og:image`.** Links shared anywhere rendered as a bare title. Added
  `app/opengraph-image.tsx` using the file convention, plus the
  `metadataBase` it needs to resolve to an absolute URL and a
  `summary_large_image` Twitter card. Also added a `themeColor` viewport
  export so mobile browser chrome stops showing a white bar above a
  near-black app.
- **Prose used tabular figures.** `body` sets `tabular-nums`, which is right
  for the turn clock and wrong for LeetCode problem statements — constraints
  like `2 <= nums.length <= 10^4` read with uneven gaps. Reset inside
  `.prose`.
- **A stray second accent**: the RoomPreview's second avatar was
  `bg-blue-500`, the only non-emerald hue on the page outside the code
  sample. Now neutral.
- **Hero tracking.** Tightened to `-0.035em` with `leading-[1.02]`.
  Deliberately *not* made larger: the hero column is ~571px at `max-w-6xl`,
  and 72px type overflows "in the same room." into a bad wrap. Presence came
  from tracking instead.

**Two things worth knowing:**

- `radial-gradient` does not survive satori (the renderer behind
  `ImageResponse`). The landing hero's emerald bloom, ported to the OG image,
  rendered as a hard green rectangle with visible seams — the box is drawn
  but the falloff to transparent isn't. Tried a wide box and a square one;
  both seamed. Settled on a full-canvas `linear-gradient`, which satori
  handles correctly and which has no edge to seam at. **Don't reach for
  radial gradients in `opengraph-image.tsx`.**
- Left alone deliberately: the audit calls for replacing Lucide icons to
  avoid the "default AI icon set" look, which would mean adding a dependency
  for a purely cosmetic change — not worth it against the "check the
  dependency file first" rule.

**Verified:** clean `tsc --noEmit`, clean `eslint`, `next build` succeeds and
prerenders `/opengraph-image` statically. Rendered the OG PNG and inspected
it (that's how the gradient bug was caught). Landing page and dashboard
checked in a real browser at 1440px. **Not** verified at a mobile viewport —
the resize didn't take effect, so the `dvh` change is reasoned but not
visually confirmed on a phone-sized window.

---

## White + blue theme, with a real light/dark token layer

**Date:** 2026-09-09

**Task:** Move off the emerald-on-near-black look to a white-first, blue
palette, and support both light and dark properly.

**Why it needed a refactor first:** every colour in the app was a hard-coded
Tailwind class — `bg-zinc-950`, `text-emerald-400` — 505 of them across 32
files. `bg-zinc-950` means "near-black" in every context, so there was
nowhere to say "this is the page ground, whatever the ground currently is".
A second theme was impossible without naming colours by *role* first.

**What was done:**

- `app/globals.css` now defines semantic tokens — `canvas`, `surface`,
  `elevated`, `line`, `ink`/`ink-soft`/`muted`/`faint`, `accent`, and the
  status trio `success`/`warn`/`danger` — mapped into Tailwind via
  `@theme inline`. Components use `bg-canvas`, `text-muted` and so on, and
  need no `dark:` variants: the variable underneath changes. The
  relationships invert between themes deliberately (in dark a panel is
  *lighter* than the page; in light it's slightly darker).
- Migrated all 505 usages with a scripted mapping table
  (kept at `scratchpad/migrate_colors.py`).
- Theme switching: `hooks/useTheme.ts` on `useSyncExternalStore` rather than
  `useState` + effect, because hydrating from localStorage in an effect trips
  the `react-hooks/set-state-in-effect` rule this repo treats as an error.
  An inline boot script in `app/layout.tsx` stamps `data-theme` before first
  paint so there's no flash. Three-way control (light/system/dark) in the
  sidebar and landing nav — a two-state switch can't express "follow my OS".
- Monaco is the one place that can't read CSS variables (it takes a theme by
  name), so it gets the resolved value via `useResolvedTheme()`.
- Clerk's `colorPrimary` and the OG image were both still emerald; both now
  match.

**Default is light, not system.** Initially built to follow the OS, which put
anyone on a dark machine straight into the dark theme — including the user,
who saw navy rather than the white this was meant to be. The design is
white-first, so dark is now opt-in: chosen outright, or via "system". The
`prefers-color-scheme` CSS fallbacks were removed for the same reason.

**Gotcha worth remembering:** the migration's first pass mangled 56 classes.
`text-zinc-50` was ordered before `text-zinc-500` in the mapping table, so it
matched the prefix and left `text-ink0`. Any string-replacement table like
this must order longer keys before their prefixes — the script now does, and
prints leftovers so a miss is visible rather than silent.

**Verified:** clean `tsc --noEmit`, clean `eslint`, `next build` succeeds.
Both themes checked in a real browser (light default confirmed, toggle
switches to dark and back). OG image re-rendered and inspected. **Not**
checked: the room page itself, which needs a live room with two accounts —
so the Monaco theme swap and the judge/turn colours are reasoned and
type-checked but not seen running.

---

## Adopted "Terminal Paper" as the visual direction

**Date:** 2026-09-09

**Task:** After reviewing seven mocked directions, picked Terminal Paper and
built it into the app for real.

**The direction:** a monospace instrument panel printed on warm paper rather
than glowing on a black console. Two rules hold it together, both written at
the top of `globals.css` so they survive the next person editing it:

1. **`accent` is ink, not a colour.** Buttons, the logo mark and active states
   are near-black on paper. Nothing competes for attention by being bright.
2. **`live` is the only hue**, reserved for what is *ticking* — the turn
   clock, its progress bar, the other player's caret. Rust (`#8A4B12`)
   appearing anywhere that isn't live would stop it meaning anything.

Status (`success`/`warn`/`danger`) stays separate from both: "Accepted" is a
statement about the code, not about the brand.

**What changed:**

- All token values in `globals.css`, light and dark. Dark is warm near-black
  (`#141311`), never a neutral grey — a cool dark under a warm light theme
  reads as two different products. The accent inverts with the ground: it is
  still "ink", which in dark is the light value.
- **Fonts swapped to JetBrains Mono + Instrument Sans** (from Geist). Mono is
  the *interface* font, not just the code font — that's the direction.
  Ligatures are disabled on `body` because JetBrains Mono renders `->` and
  `!=` as single glyphs that read as typos in UI labels; prose and code turn
  them back on.
- **Radius overridden once at the theme level** (`--radius-*: 2px`) rather
  than editing the ~80 `rounded-lg`/`rounded-xl`/`rounded-2xl` classes already
  written across 30-odd components. One block keeps the whole app consistent.
- New `live` token trio wired through `TurnBar` (the "your turn" strip, the
  ping dot, the label) and the collaborator caret.
- Clerk's `colorPrimary` and the OG image follow the ink/paper/rust palette.

**Caught by looking at it:** with mono as the body font, `/terms` and
`/privacy` became walls of monospace running text — the exact weakness noted
against this direction when it was still a mock. Fixed the way the mock
already solved it for problem statements: long-form prose gets
`font-sans`, headings keep `font-mono`. That split now applies in three
places (problem panel, terms, privacy) and is the rule to follow for any new
long-form page.

**Verified:** clean `tsc --noEmit`, clean `eslint`, `next build` succeeds.
Dashboard checked in both themes and the legal pages re-checked after the
prose fix. **Not** verified: the room page itself, which needs a live room
with two accounts — so the Monaco `vs`/`vs-dark` swap, the turn-bar live
state and the judge verdict colours are reasoned but unseen.

**Still open, and not a palette problem:** the dashboard is mostly empty space
with a dashed box in it. The empty state should offer the invite link and a
problem picker, and the room's turn timer / queue / participants are three
strips where one would do.

---

## Boot-log loader for room creation and room connect

**Date:** 2026-09-09

**Task:** Give room creation a real loading screen instead of a spinner.

**What was there:** two nearly invisible waits. Creating a room showed a 16px
`Loader2` inside the button; arriving at the room then showed the words
"Loading room..." centre-screen. Together that's a multi-second gap where the
app looks like it ignored the click.

**What replaced it:** `components/RoomBootLoader.tsx` — a full-screen mono
boot log, matching the Terminal Paper direction. A prompt marker per line, the
active line carrying a blinking block caret in `live` rust, finished lines
marked `ok` in `success`, and a running elapsed clock in tabular figures.

**The rule it follows: every line is a milestone actually observed.** The
create flow has two real phases — the POST in flight, then the navigation
that follows — and the room page has two more, the stream connecting
(`editor.connected`) and the snapshot arriving. Nothing is on a timer and no
step is invented. A fake four-step sequence that always takes the same time
is exactly what makes a loader feel cheap, and it also lies about where the
time is going.

**Deliberately the same screen in both places**, so going from "New Room"
straight into the room reads as one continuous wait rather than two unrelated
loading states.

**No-flash reveal:** the loader is held at `opacity: 0` for 140ms via a
`loader-in` animation with `both` fill, so a fast creation never flashes a
full-screen panel for one frame. Same reasoning as `TopProgressBar`'s CSS
delay, and it's CSS rather than a timer for the same reason.

**Three lint rules shaped this component, worth knowing before editing it:**

- `react-hooks/refs` — can't read a ref during render.
- `react-hooks/set-state-in-effect` — can't hydrate state from an effect.
- `react-hooks/purity` — can't call `performance.now()` during render, so the
  start time is stamped inside the effect, not at `useRef(...)`.

Per-step durations ("creating room … 340ms") were built and then removed:
holding them in a ref trips the first rule, holding them in state trips the
second. The total elapsed is honest and enough. Don't re-add them without a
plan for both rules.

**Verified:** clean `tsc --noEmit`, clean `eslint`, `next build` succeeds.
Exercised in a real browser with `/api/rooms` throttled to 7s to hold the
loader open — the clock counts, the active marker is rust, pending lines stay
dim. That run also created a real room, which incidentally confirmed the
room page under Terminal Paper (Monaco correctly on the `vs` light theme) —
previously listed as unverified.

---

## Monaco was still wearing its stock theme

**Date:** 2026-09-09

**Reported:** "regardless of what mode the monaco editor stays the default
colour."

**What was actually wrong:** not the light/dark *switch* — that worked. The
earlier change set `theme` to `"vs"` / `"vs-dark"`, and measuring in the
browser confirmed the class really did flip live on toggle. The problem was
that those are Monaco's **stock** palettes and neither matches this app:

| | editor | app canvas |
|---|---|---|
| light | `#FFFFFE` | `#FBFBF9` |
| dark  | `#1E1E1E` (cool grey) | `#141311` (warm) |

So in both modes the editor read as "default Monaco" — and since it's the
largest surface on the room page, that quietly undid the whole direction.
Worth remembering as a diagnosis: "doesn't change with the mode" and "changes
but to the wrong colours" look identical from the outside.

**Fix:** `lib/monacoTheme.ts` defines a real theme, `thirty70`. Rather than
hard-coding a second copy of the palette — which would drift the first time
`globals.css` changed — it **derives the theme from the CSS custom properties
at runtime** via `getComputedStyle`. One source of truth, and it follows any
future palette edit for free. Only solid hex tokens are usable; the `…-soft`
/ `…-line` rgba ones are filtered out, with per-token fallbacks for SSR.

Registered in `beforeMount` so the `theme` prop resolves to something Monaco
already knows, and re-derived in an effect on every switch: `data-theme` is
already stamped by then, so re-reading the variables picks up the new palette,
and redefining under the same name is what makes Monaco repaint.

Syntax colours follow the same restraint as the rest of the app — rust
keywords, green strings, ink greys for everything else, rust caret. No blues,
no purples.

**Caught by looking at the screenshot afterwards:** bracket-pair colourisation
ships on by default with a six-hue rainbow, so the braces were rendering blue
and yellow — the only colour on screen nobody had chosen. Disabled in the
editor options, and the six `editorBracketHighlight.foreground*` slots are
themed on-palette in case anyone re-enables it.

**Verified:** clean `tsc --noEmit`, clean `eslint`, build succeeds. Measured
in the browser in both modes — editor background now equals the app canvas
exactly (`rgb(251,251,249)` light, `rgb(20,19,17)` dark) and switches live
without a reload. Brackets re-checked at zoom after the fix.

---

## The editor wasn't broken — the room had no theme control

**Date:** 2026-09-09

**Reported:** "still white", with a screenshot of a room on the dev server.

**What was actually true:** nothing was broken. Measured on the running dev
server (`localhost:3000`, the same one in the screenshot):

| mode | editor background | app canvas |
|---|---|---|
| light | `rgb(251,251,249)` | `rgb(251,251,249)` |
| dark  | `rgb(20,19,17)` | `rgb(20,19,17)` |

Exact match in both, switching live without a reload. The stored preference
was simply `"light"`, so a pale editor was correct behaviour.

**The real defect** was that `ThemeToggle` only existed in the dashboard
sidebar and the landing nav. The room page had none — so the one screen that
is almost entirely editor gave you no way to change how it looks. You had to
leave the room to change the room. Added to `RoomHeader`, beside Invite.

**Worth keeping as a diagnostic habit:** three different faults present as
"the theme doesn't work" — the switch not firing, the switch firing but
painting stock colours (the previous entry), and the switch being unreachable
from the screen you're on (this one). Measuring the actual pixel values told
these apart immediately, where reading the code did not.

**One false alarm, recorded so it isn't re-investigated:** a scripted click on
"Dark" appeared to store `"system"`. It was my own automated click racing a
hot reload of the component I had just added. Clean clicks store correctly —
`Light` → `"light"`, `Dark` → `"dark"`, one radiogroup, `aria-checked`
tracking properly.

**Unrelated pre-existing errors:** the console carries two exceptions from
`monaco/vs/editorWorkerHost-*.js` (the Monaco web worker). They predate the
theming work and are what the Next devtools "1 Issue" badge is counting. Not
investigated — noting them so the badge isn't mistaken for a theme fault.

**Verified:** clean `tsc --noEmit`, clean `eslint`. Toggle exercised through
the real control in a live room on the dev server, both directions.

---

## Hairlines were too faint to do their job

**Date:** 2026-09-09

**Reported:** "the border in light mode is non existent."

**Measured before changing anything** (WCAG contrast against the ground):

| token | value | vs canvas | vs surface |
|---|---|---|---|
| light `--line` | `#dedcd4` | **1.33:1** | 1.25:1 |
| light `--line-strong` | `#c9c6bb` | 1.65:1 | 1.55:1 |
| `bg-elevated` used as a divider | `#edede8` | **1.13:1** | 1.07:1 |
| dark `--line` | `#2e2d28` | **1.35:1** | 1.25:1 |

So the report was exactly right, and measuring turned up a worse case nobody
had mentioned: the four vertical dividers in `RoomHeader` were drawn with
`bg-elevated` — a *surface* token, not a line token — at 1.13:1. That is the
faintest thing on the screen and effectively invisible. A divider is a line;
they now use `bg-line`.

**New values:** light `--line` `#cbc8bc` (1.62:1) and `--line-strong`
`#ada899` (2.29:1); dark `--line` `#38362f` (1.54:1) and `--line-strong`
`#57544a` (2.45:1).

**Dark was raised too, although only light was reported.** It measured the
same 1.35:1 weakness, and fixing one theme alone would have left the other
visibly flatter. Called out rather than done silently, in case that isn't
wanted.

This matters more in this direction than it would elsewhere: Terminal Paper
is a grid of hairlines with no cards, shadows or fills doing the work of
separation. If the rules don't read, the structure doesn't exist.

**Verified:** clean `tsc --noEmit`, clean `eslint`, build succeeds. Checked in
the browser in light mode on the dev server — dashboard and room header, the
latter zoomed to confirm the dividers now read.

---

## Default theme back to "follow the system"

**Date:** 2026-09-09

**Task:** A new user should start on their OS setting, not forced to light.

This reverses the earlier "white by default" decision, which had been made
after the first white-and-blue pass landed a dark-OS user in navy. With
Terminal Paper's dark being a warm near-black rather than that navy, following
the OS is the better default again.

**Dark now has two entry points**, which is what made this more than a
one-line change:

1. no explicit choice + a dark OS — the new-user path, handled in CSS by
   `@media (prefers-color-scheme: dark)` on `:root:not([data-theme="light"])`;
2. chosen outright, or chosen as "system" on a dark machine — stamped as
   `data-theme="dark"` by the boot script before first paint.

The `:not([data-theme="light"])` guard is what lets someone who deliberately
picked light stay light on a dark machine.

**The dark palette's values are now declared once**, as `--dark-*` custom
properties, and both selectors above assign from them. Two selectors each
restating twenty hexes is precisely the kind of duplication that drifts the
first time one colour is tweaked.

A missing storage key and an explicit `"system"` are treated as the same
thing, in both the boot script and `hooks/useTheme.ts` — so "never chose" and
"chose system" behave identically, and the toggle shows System selected.

**A side effect worth keeping:** because the CSS resolves dark on its own when
no `data-theme` is stamped, the page is now correct with JavaScript disabled.
The boot script's `catch` no longer forces light for the same reason.

**Verified** on the dev server, OS set to dark, all four states by reload:

| stored | data-theme | canvas |
|---|---|---|
| *(none — new user)* | `dark` | `rgb(20,19,17)` |
| `"light"` | `light` | `rgb(251,251,249)` |
| `"system"` | `dark` | `rgb(20,19,17)` |
| *(attribute stripped — no-JS)* | none | `rgb(20,19,17)` |

Plus clean `tsc --noEmit`, clean `eslint`, successful build.

**Gotcha that cost a build:** the boot script is a template literal, so a
backtick in one of its comments terminated the string and produced a parse
error. Don't put backticks inside `THEME_BOOT_SCRIPT`.

---

## Made the app usable on a phone

**Date:** 2026-09-09

**Reported:** the deployed site on a phone, with every heading breaking one
word per line.

**Cause:** the app shell had no breakpoints at all. `Sidebar` is a fixed
`w-60 shrink-0` rail, so on a 390px screen it took 240px and left the page
~120px. An audit of the whole tree found only 6 files carrying any responsive
class; 32 had none — including `app/room/[id]/page.tsx`, the core product.

**Shell:** new `components/dashboard/MobileNav.tsx`, a top bar shown below
`md`, with the sidebar now `hidden md:flex`. A bar rather than a hamburger
drawer on purpose — there are exactly two destinations, so a drawer would add
open/close state and an overlay to hide two links behind a tap. The layout is
`flex-col md:flex-row`, so the nav sits above the page on a phone and beside
it on a desktop.

**Room page:** the three panes were 280–800px + 360px min + a participants
rail — roughly 1000px minimum, so a phone just overflowed. They now stack
vertically below `md`. The pixel widths (which are drag state, not layout
constants) are passed as CSS custom properties so the media query can ignore
them — `w-full md:w-[var(--problem-w)]` — instead of an inline `width` that
applies at every size. `ResizeHandle` is hidden below `md`, since a
column-resize grip has nothing to drag in a stacked column. The editor gets
`h-[65dvh]` on a phone so it isn't a 40px sliver.

**Room header:** six controls plus five dividers don't fit 390px, so the row
wraps, and the participants list is hidden below `sm` — the same roster is in
the panel under the editor.

**Testing note worth keeping:** Chrome would not resize below **500px**, so
window resizing cannot verify a real phone width. Rendering each route in a
**390px iframe** does — an iframe gets its own viewport for media queries.
Measured `documentElement.scrollWidth` against `innerWidth` on
`/dashboard`, `/competitive`, `/settings`, `/room/[id]`, `/` and `/terms`:
390 = 390 on all six, no horizontal overflow. The only elements extending past
the viewport in the room are Monaco's own `lines-content` and `view-rulers`,
which live inside the editor's scroll container and are supposed to.

**Verified:** clean `tsc --noEmit`, clean `eslint`, build succeeds, plus the
iframe measurements above and screenshots of the dashboard and a live room at
the narrowest width Chrome allows.

**Gotcha:** `{/* … */}` directly inside `return (` is a sibling of the root
element and fails with "JSX expressions must have one parent element". Use a
plain `//` comment there — it sits in the parenthesised expression, not in
JSX.

---

## P0 from the review: tests, CI, logging, error boundaries

**Date:** 2026-09-10

**Task:** Work the P0 findings from the repo review.

**1 — Tests and CI, from zero.** Vitest, 37 tests over three files, and a
GitHub Action running `typecheck` + `lint` + `test` on push and PR.

Two extractions were needed first, and both are improvements in their own
right rather than test scaffolding:

- `lib/turnRotation.ts` — `nextInRotation`, `pickNextTurnHolder` and
  `isTurnExpired` moved out of `lib/roomState.ts`, which opens an ioredis
  connection at module scope. Checking a rotation rule should not require
  connecting to Redis. `roomState` re-exports them, so every existing caller
  is untouched.
- `lib/judgePayload.ts` — the judge validator, lifted out of the route. This
  is the one payload one client authors and every *other* client renders, so
  a bad shape throws inside someone else's browser mid-turn. The route went
  from 232 lines to 60.

The tests cover the cases the log says were real bugs: the rotation walking
from the front when the holder is no longer in `order` (a player who just
left), a paused turn never expiring, and a non-array `cases` reaching
`JudgePanel.map()`.

**The review said to start with `lib/editorDoc.ts` — that was wrong.** It's
types only, no runtime logic. The document CAS is a Lua script against Redis
and wants an integration test, not a unit test.

**A test caught a contract detail on the first run:** a judge result carries
its own `mode`, which `parseResult` requires to match the broadcast's. My
fixture omitted it and was correctly rejected. That invariant now has a test
of its own.

**2 — `lib/log.ts`.** Structured JSON lines, no dependency — Vercel parses
them into searchable fields. `report()` is the seam an error tracker plugs
into later: one call site rather than a dozen catch blocks to revisit.

Wired into the five silent failures that actually hide something: corrupt
cached room meta, a dropped WebRTC signal, a failed after-response history
write, a room the cron sweep can't process, and a rejected Dodo webhook
signature. **Deliberately not wired into the two SSE catches** — those are
client-disconnect races, expected on every stream close, and logging them
would bury the real entries.

**3 — Error boundaries.** `app/error.tsx`, `app/global-error.tsx` (renders its
own document, inline styles, since the failure may be in the layout that
provides the fonts and tokens), and `app/room/[id]/error.tsx`. The room gets
its own because its failure mode is specific — it renders state broadcast by
other clients — and because the right first move is reconnecting, not
reloading: the room and its timer are still running server-side. All three
log with the error's `digest`, which is what ties a user's screenshot to the
server log line.

**Verified:** 37/37 tests, clean `tsc --noEmit`, clean `eslint`, successful
build.

**Also:** `@types/node` moved from ^20 to ^24. Vitest 5 requires it, and ^20
was already behind the Node 26 runtime in use. Typecheck stayed clean.

---

## P1 from the review: indexes, rate limits, sanitising, shared subscribers

**Date:** 2026-09-10

**1 — Database indexes (`drizzle/0004_uneven_sersi.sql`).** The schema had no
secondary indexes at all. The one that mattered:
`room_participants` has primary key `(room_id, user_id)`, so a lookup by
`user_id` alone can't use it — and Postgres doesn't index foreign-key columns
by itself. `getCurrentRoomForUser` filters on exactly that and runs on every
dashboard load.

Added a **partial** index — `(user_id) WHERE left_at IS NULL` — which matches
the query and holds one row per person currently in a room rather than one per
room they've ever joined. Plus `sessions(room_id)`, `turns(session_id)` and
`rooms(updated_at)` for the sweep's ordering.

Verified with `EXPLAIN`. The table is empty so the planner still picks a seq
scan (correctly); with `enable_seqscan = off` it chooses
`Index Scan using room_participants_active_user_idx, Index Cond: (user_id = …)`,
which is what confirms the index actually serves the query.

**2 — `lib/rateLimit.ts`.** Fixed-window counter on the existing Redis, via one
Lua script. Not `@upstash/ratelimit`: that needs the REST client and its own
two environment variables, and this app talks to Upstash over ioredis with a
single `REDIS_URL`.

`INCR` and `EXPIRE` are in Lua rather than two client commands, because a crash
between them leaves a counter with no TTL and locks that caller out
permanently. It **fails open** — Redis being down already breaks the room, and
refusing every request on top turns a degraded app into a dead one.

Applied to the LeetCode proxy (60/min/user, the real abuse vector: those calls
go to leetcode.com from the deployment's IP, so one user in a loop gets
*everyone* blocked) and to the signal relay (240/min/room/user).

**Deliberately not applied to the editor.** It flushes on a 60ms debounce —
about 1,000 writes a minute while someone types continuously — so any limit low
enough to matter would break normal typing. Its protection is the CAS and the
existing `MAX_DOC_CHARS` / `MAX_CHANGES` caps.

Verified against real Redis with the exact Lua from the source: limit 5 over 8
calls gave 5 allowed / 3 blocked, TTL set on the first call and not reset by
later ones (so the window doesn't slide).

**3 — HTML sanitising.** The problem body is rendered with
`dangerouslySetInnerHTML`, so it's third-party markup executing on our origin
in a page holding a live Clerk session. Now sanitised in `lib/leetcode.ts` at
the fetch boundary — before it's cached by `next: { revalidate }`, stored, or
handed to any client, and in exactly one place.

**A test caught a real config bug:** `transformTags` adds `rel="noopener"` to
links, but `allowedAttributes` is applied *after* the transform, so omitting
`rel`/`target` there silently stripped the hardening straight back off.

**4 — One Redis subscriber per room, not per tab.** The documented ceiling.
`subscribeRoomChannels` keeps its signature, so the SSE route is untouched;
underneath, subscribers are shared per room per instance and refcounted.

Three details that are load-bearing: the teardown is idempotent (the SSE route
calls cleanup from several paths, and a second call would otherwise close a
connection other tabs still hold); the entry is removed from the map *before*
the connection closes, so a tab arriving mid-teardown builds a fresh subscriber
rather than attaching to a dying one; and each listener is called inside a
`try` — with one connection serving the whole room, a single throwing listener
would otherwise stop the fan-out to everyone.

Measured against real Redis via `connected_clients`:

| state | connections | reading |
|---|---|---|
| no streams | 1 | probe only |
| 1 stream | 2 | probe + one subscriber |
| **3 streams, same room** | **2** | still one subscriber — would have been 3 |
| 2 closed, 1 open | 2 | refcount holds |
| all closed | 1 | released, no leak |

**5 — Signal relay hardened.** `m.to` is now checked against the room's
participant list (delivery was already scoped to the room channel, but
`queueSignal` *persists*, so unchecked recipients let a member fill Redis with
messages nobody will read). Batch capped at 64, `data` at 16KB.

**Verified:** 45/45 tests, clean `tsc --noEmit`, clean `eslint`, successful
build, plus the live measurements above.

**Not done from P1:** nothing — but note the subscriber change is the one piece
here that wants a second pair of eyes in a real two-person room before it
ships, since a fan-out bug affects everyone in a room at once rather than one
tab.
