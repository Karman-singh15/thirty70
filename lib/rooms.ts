import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, roomParticipants, rooms, sessions, turns, users } from "@/lib/db/schema";
import * as roomState from "@/lib/roomState";
import { getMaxParticipants, type UserPlan } from "@/lib/roomLimits";

export interface Participant {
  userId: string;
  name: string;
  imageUrl: string;
  joinedAt: number;
}

export interface RoomProblem {
  titleSlug: string;
  title: string;
  difficulty: string;
  frontendQuestionId: string;
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerPlan: UserPlan;
  inviteCode: string;
  participants: Participant[];
  problem: RoomProblem | null;
  turnDurationSeconds: number;
  turnOrder: string[];
  currentTurnUserId: string | null;
  turnNumber: number;
  turnEndsAt: number | null;
  turnPausedRemainingMs: number | null;
  createdAt: number;
  updatedAt: number;
}

const MIN_TURN_SECONDS = 10;
const MAX_TURN_SECONDS = 3600;

// How long a room may sit with nobody online before the next person to check
// on it disbands it — long enough to survive a refresh, a laptop sleeping, or
// a brief wifi drop; short enough that an abandoned room doesn't just sit in
// the database forever.
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000;

// Permanently removes a room — cascades to its participants/sessions/turns in
// Postgres, and drops everything cached about it in Redis. Shared by the
// "last person explicitly left" path (leaveRoom) and the "everyone's been
// offline long enough" path (getRoom).
async function deleteRoom(roomId: string): Promise<void> {
  // Announce the closure while the room can still be read. Every other exit
  // broadcasts a participant list the departed client can find itself missing
  // from, but a room that no longer exists can't broadcast for itself — and
  // with polling gone there's no request left to trip over a 404. So the last
  // thing this room ever says is "nobody is in here", which every connected
  // client reads the same way it reads being removed: leave for the
  // dashboard. Matters for a tab left open on a room its owner walked out of
  // in another tab, and for the empty-room sweep in getRoom.
  await broadcastRoomClosed(roomId);
  await db.delete(rooms).where(eq(rooms.id, roomId));
  await roomState.clearRoomState(roomId);
}

async function broadcastRoomClosed(roomId: string): Promise<void> {
  const meta = await getRoomMeta(roomId);
  if (!meta) return;

  await roomState.publishRoomEvent(roomId, {
    ownerId: meta.ownerId,
    ownerPlan: meta.ownerPlan,
    participants: [],
    problem: meta.problem,
    turnDurationSeconds: meta.turnDurationSeconds,
    turnOrder: [],
    currentTurnUserId: null,
    turnNumber: 0,
    turnEndsAt: null,
    turnPausedRemainingMs: null,
    onlineUserIds: [],
    micOn: [],
    cameraOn: [],
  });
}

// A user belongs to exactly one room at a time. Their editor, presence, turn
// slot and WebRTC mesh all assume a single room per person, so entering one
// walks them out of any other rather than leaving a membership behind that
// still counts against that room's capacity and holds a place in its turn
// rotation. Called after the new membership is established, never before —
// a join that turns out to be full shouldn't cost someone the room they were
// already in. In practice this finds zero or one row.
async function leaveOtherRooms(userId: string, keepRoomId: string): Promise<void> {
  const others = await db
    .select({ roomId: roomParticipants.roomId })
    .from(roomParticipants)
    .where(
      and(
        eq(roomParticipants.userId, userId),
        isNull(roomParticipants.leftAt),
        ne(roomParticipants.roomId, keepRoomId)
      )
    );

  for (const { roomId } of others) {
    await leaveRoom(roomId, userId);
  }
}

function mapProblem(row: typeof problems.$inferSelect): RoomProblem {
  return {
    titleSlug: row.titleSlug,
    title: row.title,
    difficulty: row.difficulty,
    frontendQuestionId: row.frontendQuestionId,
  };
}

async function ensureUser(userId: string, name: string, imageUrl: string): Promise<void> {
  await db
    .insert(users)
    .values({ id: userId, name, imageUrl })
    .onConflictDoUpdate({ target: users.id, set: { name, imageUrl } });
}

export async function createRoom(
  name: string,
  ownerId: string,
  ownerName: string,
  ownerImageUrl: string
): Promise<Room> {
  await ensureUser(ownerId, ownerName, ownerImageUrl);

  const id = nanoid(10);
  const inviteCode = nanoid(12);

  await db.insert(rooms).values({ id, name, ownerId, inviteCode });
  await db.insert(roomParticipants).values({ roomId: id, userId: ownerId });
  await roomState.touchPresence(id, ownerId);
  await leaveOtherRooms(ownerId, id);
  // Nothing cached yet for a brand-new id, so the getRoom below builds it.

  const room = await getRoom(id);
  return room!;
}

// Reads the room's durable record straight from Postgres. Only runs on a
// cache miss — see getRoomMeta.
async function loadRoomMetaFromDb(
  id: string
): Promise<roomState.CachedRoomMeta | undefined> {
  const [roomRow, participantRows] = await Promise.all([
    db.query.rooms.findFirst({
      where: eq(rooms.id, id),
      with: { owner: true, problem: true },
    }),
    db
      .select({
        userId: roomParticipants.userId,
        joinedAt: roomParticipants.joinedAt,
        name: users.name,
        imageUrl: users.imageUrl,
      })
      .from(roomParticipants)
      .innerJoin(users, eq(roomParticipants.userId, users.id))
      .where(and(eq(roomParticipants.roomId, id), isNull(roomParticipants.leftAt)))
      // Join order is the turn order, so it has to be deterministic here —
      // setRoomProblem seeds the rotation straight from this list.
      .orderBy(roomParticipants.joinedAt),
  ]);

  if (!roomRow) return undefined;

  return {
    id: roomRow.id,
    name: roomRow.name,
    ownerId: roomRow.ownerId,
    ownerName: roomRow.owner?.name ?? "Unknown",
    ownerPlan: roomRow.owner?.plan ?? "free",
    inviteCode: roomRow.inviteCode,
    participants: participantRows.map((p) => ({
      userId: p.userId,
      name: p.name,
      imageUrl: p.imageUrl ?? "",
      joinedAt: p.joinedAt.getTime(),
    })),
    problem: roomRow.problem ? mapProblem(roomRow.problem) : null,
    turnDurationSeconds: roomRow.turnDurationSeconds,
    createdAt: roomRow.createdAt.getTime(),
    updatedAt: roomRow.updatedAt.getTime(),
  };
}

// The room's durable record, from Redis when we have it. A Neon round trip is
// ~250ms at its very fastest and ~550ms for this particular query, which is
// most of what every poll and every button press used to spend; served from
// the cache the same data costs ~30ms.
export async function getRoomMeta(
  id: string,
  cached?: roomState.CachedRoomMeta | null
): Promise<roomState.CachedRoomMeta | undefined> {
  const hit = cached ?? (await roomState.getCachedRoomMeta(id));
  if (hit) return hit;

  const meta = await loadRoomMetaFromDb(id);
  if (meta) await roomState.setCachedRoomMeta(id, meta);
  return meta;
}

// Fetches everything needed to render a room. The four reads are issued
// together rather than awaited in turn, so the whole thing is one round trip
// in the common case. Also settles an expired turn inline, so pollers don't
// need a separate timeout-check request before this one — and, the same way,
// disbands the room inline once everyone's been offline long enough (see
// deleteRoom below).
export async function getRoom(id: string): Promise<Room | undefined> {
  const [cachedMeta, live, turnOrder, onlineUserIds] = await Promise.all([
    roomState.getCachedRoomMeta(id),
    roomState.getLiveState(id),
    roomState.getTurnOrder(id),
    roomState.getOnlineUserIds(id),
  ]);

  const meta = await getRoomMeta(id, cachedMeta);
  if (!meta) return undefined;

  // Nobody's here right now. There's no background sweep for this — the
  // next read of this room (a poll from a tab still open elsewhere, an
  // invite-link visit, the owner's dashboard) is what notices and disbands
  // it, once it's been empty for the full grace window rather than just
  // this one instant (a refresh or a brief network drop shouldn't cost
  // anyone their room).
  if (onlineUserIds.length === 0) {
    const emptySince = await roomState.markRoomEmptySince(id);
    if (Date.now() - emptySince >= EMPTY_ROOM_GRACE_MS) {
      await deleteRoom(id);
      return undefined;
    }
  } else {
    await roomState.clearRoomEmptySince(id);
  }

  let liveState = live;
  let timedOut = false;
  if (
    liveState.currentTurnUserId &&
    liveState.turnEndsAt !== null &&
    Date.now() >= liveState.turnEndsAt &&
    (await roomState.tryClaimTurnTimeout(id, liveState.turnNumber))
  ) {
    await endCurrentTurn(id, "timed_out", meta);
    liveState = await roomState.getLiveState(id);
    timedOut = true;
  }

  const room: Room = {
    id: meta.id,
    name: meta.name,
    ownerId: meta.ownerId,
    ownerName: meta.ownerName,
    ownerPlan: meta.ownerPlan,
    inviteCode: meta.inviteCode,
    participants: meta.participants,
    problem: meta.problem,
    turnDurationSeconds: meta.turnDurationSeconds,
    turnOrder,
    currentTurnUserId: liveState.currentTurnUserId,
    turnNumber: liveState.turnNumber,
    turnEndsAt: liveState.turnEndsAt,
    turnPausedRemainingMs: liveState.turnPausedRemainingMs,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };

  // The clock ran out, not a person — but everyone connected still needs to
  // see the rotation move on, so whichever caller's read happened to notice
  // it is the one that announces it.
  if (timedOut) await broadcastRoomUpdate(id, room);

  return room;
}

// The room-level snapshot pushed over the realtime stream — everything a
// connected client needs except the editor document itself, which travels on
// its own channel. Reuses whatever `Room` the caller already fetched when it
// has one, so this never costs a second `getRoom()`.
export async function getRoomSnapshot(
  roomId: string,
  knownRoom?: Room
): Promise<roomState.RoomSnapshot | null> {
  const [room, onlineUserIds, media] = await Promise.all([
    knownRoom ?? getRoom(roomId),
    roomState.getOnlineUserIds(roomId),
    roomState.getMediaState(roomId),
  ]);
  if (!room) return null;

  return {
    ownerId: room.ownerId,
    ownerPlan: room.ownerPlan,
    participants: room.participants,
    problem: room.problem,
    turnDurationSeconds: room.turnDurationSeconds,
    turnOrder: room.turnOrder,
    currentTurnUserId: room.currentTurnUserId,
    turnNumber: room.turnNumber,
    turnEndsAt: room.turnEndsAt,
    turnPausedRemainingMs: room.turnPausedRemainingMs,
    onlineUserIds,
    micOn: media.micOn,
    cameraOn: media.cameraOn,
  };
}

// Tells everyone connected to the room that something changed — this is what
// replaced the old poll. Called after every mutation (join, leave, turn
// actions, media toggles) and by getRoom() itself when it settles a timed-out
// turn, since that's a real state change nobody explicitly asked for but
// everyone still needs to see.
export async function broadcastRoomUpdate(roomId: string, knownRoom?: Room): Promise<void> {
  const snapshot = await getRoomSnapshot(roomId, knownRoom);
  if (snapshot) await roomState.publishRoomEvent(roomId, snapshot);
}

// Single indexed lookup, straight to Postgres — no staleness possible. For
// paths that check membership once per connection/action rather than on a
// tight poll, where that guarantee is worth the round trip.
export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const row = await db.query.roomParticipants.findFirst({
    where: and(
      eq(roomParticipants.roomId, roomId),
      eq(roomParticipants.userId, userId),
      isNull(roomParticipants.leftAt)
    ),
    columns: { userId: true },
  });
  return !!row;
}

// Same check, served from the cached room meta instead of a fresh Postgres
// read — for genuinely hot paths (WebRTC signaling polls every 700ms-2.5s per
// tab, indefinitely). getRoomMeta falls back to Postgres on a cache miss, and
// joinRoom/leaveRoom invalidate the cache synchronously as part of the same
// request that changes membership, so this carries no meaningful staleness
// window in practice — the same trust the rest of the app already places in
// this cache for turn state and presence.
export async function isRoomMemberCached(roomId: string, userId: string): Promise<boolean> {
  const meta = await getRoomMeta(roomId);
  return !!meta && meta.participants.some((p) => p.userId === userId);
}

export async function getRoomByInviteCode(code: string): Promise<Room | undefined> {
  const roomRow = await db.query.rooms.findFirst({ where: eq(rooms.inviteCode, code) });
  if (!roomRow) return undefined;
  return getRoom(roomRow.id);
}

export async function getRoomsForUser(userId: string): Promise<Room[]> {
  const memberRows = await db
    .select({ roomId: roomParticipants.roomId })
    .from(roomParticipants)
    .where(and(eq(roomParticipants.userId, userId), isNull(roomParticipants.leftAt)));

  const foundRooms = await Promise.all(memberRows.map((r) => getRoom(r.roomId)));
  return foundRooms.filter((r): r is Room => r !== undefined);
}

export async function joinRoom(
  roomId: string,
  userId: string,
  name: string,
  imageUrl: string
): Promise<Room | null> {
  const roomRow = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId),
    with: { owner: true },
  });
  if (!roomRow) return null;

  const maxParticipants = getMaxParticipants(roomRow.owner?.plan ?? "free");

  await ensureUser(userId, name, imageUrl);

  // One statement so the capacity check and the insert can't race against a
  // concurrent join: the WHERE only lets the insert (and thus the conflict
  // update, for someone rejoining) happen if the room isn't already full,
  // counted and blocked at the database level rather than in application
  // code. The joining user's own row (if they're already active, e.g. a
  // duplicate join call) is excluded from the count so re-joining an active
  // membership is never itself blocked by the cap. The cap itself depends on
  // the room owner's plan (see getMaxParticipants), so it's resolved above
  // rather than baked into the query as a constant.
  const result = await db.execute(sql`
    INSERT INTO room_participants (room_id, user_id)
    SELECT ${roomId}, ${userId}
    WHERE (
      SELECT COUNT(*) FROM room_participants
      WHERE room_id = ${roomId} AND left_at IS NULL AND user_id <> ${userId}
    ) < ${maxParticipants}
    ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL
    RETURNING user_id
  `);
  if (result.length === 0) {
    throw new Error(`Room is full (max ${maxParticipants} participants)`);
  }

  await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, roomId));
  await roomState.touchPresence(roomId, userId);
  await roomState.addToTurnOrder(roomId, userId);
  await leaveOtherRooms(userId, roomId);
  // The participant list changed — rebuild it rather than trying to patch it.
  await roomState.invalidateRoomMeta(roomId);

  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Only the host picks problems. Starter code/language are written in the same
// pass as the problem so the baseline exists before turn-gating kicks in.
export async function setRoomProblem(
  roomId: string,
  userId: string,
  problem: RoomProblem,
  starterCode = "",
  starterLanguage = "javascript"
): Promise<Room | null> {
  // Ownership, turn length and the participant list all come off the cached
  // record — three Postgres round trips this used to make before doing any
  // actual work.
  const meta = await getRoomMeta(roomId);
  if (!meta) return null;
  if (meta.ownerId !== userId) return null;

  // The session id is generated here rather than read back from an INSERT,
  // which is what lets the session rows below be written after the response.
  const sessionId = randomUUID();

  // Registering the problem and pointing the room at it are one statement
  // instead of two. They can't overlap as separate queries — rooms.problem_slug
  // has a foreign key to problems.title_slug, so the problem must exist first —
  // but inside a single statement the constraint isn't checked until the whole
  // thing completes, so both land in one round trip. At ~510ms per write
  // against Neon, that's half the cost of this request.
  await db.execute(sql`
    WITH upserted AS (
      INSERT INTO problems (title_slug, title, difficulty, frontend_question_id)
      VALUES (${problem.titleSlug}, ${problem.title}, ${problem.difficulty}, ${problem.frontendQuestionId})
      ON CONFLICT (title_slug) DO UPDATE
        SET title = EXCLUDED.title,
            difficulty = EXCLUDED.difficulty,
            frontend_question_id = EXCLUDED.frontend_question_id
      RETURNING title_slug
    )
    UPDATE rooms
    SET problem_slug = ${problem.titleSlug}, status = 'active', updated_at = now()
    WHERE id = ${roomId}
  `);

  const order = meta.participants.map((p) => p.userId);

  // Redis writes, batched by what depends on what. setTurnOrder and the live
  // state reset touch different keys; startTurn has to follow the reset,
  // because the reset clears the very turn fields it sets.
  const [, docVersion, onlineUserIds] = await Promise.all([
    roomState.setTurnOrder(roomId, order),
    roomState.resetLiveStateForSession(roomId, sessionId, starterCode, starterLanguage),
    roomState.getOnlineUserIds(roomId),
  ]);

  // Starts with the first participant who's actually online, same rule the
  // rotation itself follows — no point opening on someone who isn't there.
  const starterUserId =
    order.length > 0 ? roomState.pickNextTurnHolder(order, onlineUserIds, null) : null;

  await Promise.all([
    // A new problem replaces the document outright — tell every connected
    // editor to reset onto it rather than waiting for their next poll.
    roomState.publishEditorEvent(roomId, {
      type: "doc",
      version: docVersion,
      code: starterCode,
      language: starterLanguage,
    }),
    // Written straight over the record we already hold, rather than
    // invalidating it — that keeps the getRoom below on the fast path instead
    // of sending it back to Postgres.
    roomState.setCachedRoomMeta(roomId, { ...meta, problem, updatedAt: Date.now() }),
    starterUserId
      ? roomState.startTurn(roomId, starterUserId, 1, meta.turnDurationSeconds * 1000)
      : Promise.resolve(),
  ]);

  // Session bookkeeping is history — nothing on screen reads it, so it runs
  // after the response instead of adding two more ~510ms writes to it.
  persistSessionChange(roomId, problem.titleSlug, sessionId);

  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Closes out whatever session was in progress and opens the new one. Deferred
// past the response; the abandon must precede the insert or it would abandon
// the session it is about to create.
function persistSessionChange(
  roomId: string,
  problemSlug: string,
  sessionId: string
): void {
  runAfterResponse(async () => {
    await db
      .update(sessions)
      .set({ status: "abandoned", endedAt: new Date() })
      .where(and(eq(sessions.roomId, roomId), eq(sessions.status, "in_progress")));
    await db.insert(sessions).values({ id: sessionId, roomId, problemSlug });
  });
}

async function endCurrentTurn(
  roomId: string,
  result: "passed_turn" | "timed_out",
  knownMeta?: roomState.CachedRoomMeta
): Promise<void> {
  const [meta, live] = await Promise.all([
    knownMeta ? Promise.resolve(knownMeta) : getRoomMeta(roomId),
    roomState.getLiveState(roomId),
  ]);
  if (!meta || !live.currentTurnUserId || !live.sessionId) return;

  // Rotate first, then record. The turn record is history — nobody is waiting
  // on it — whereas the rotation is the entire point of the request, so it
  // shouldn't queue behind a ~250ms Postgres insert.
  await roomState.advanceTurn(roomId, meta.turnDurationSeconds * 1000);

  recordFinishedTurn({
    sessionId: live.sessionId,
    playerId: live.currentTurnUserId,
    turnNumber: live.turnNumber,
    codeSnapshot: live.code,
    result,
    startedAt: live.turnStartedAt ? new Date(live.turnStartedAt) : new Date(),
    endedAt: new Date(),
  });
}

// Runs work once the response has already gone out. Reserved for writes
// nothing on screen reads back — history and durability — because a Neon
// write costs ~510ms and there's no reason for a button press to wait on one.
// `after` keeps the work alive past the response on platforms that would
// otherwise freeze the function the moment it returns.
function runAfterResponse(work: () => Promise<unknown>): void {
  const run = () =>
    work().catch(() => {
      // Best-effort by design. Live state lives in Redis, so a lost write
      // here costs history, not correctness of the running room.
    });
  try {
    after(run);
  } catch {
    // Outside a request context (a script, a test) `after` throws — just run it.
    void run();
  }
}

// Writes a completed turn to the history table without holding up the response.
function recordFinishedTurn(row: typeof turns.$inferInsert): void {
  runAfterResponse(() => db.insert(turns).values(row));
}

// Called by the current turn holder to voluntarily hand off.
export async function passTurn(roomId: string, userId: string): Promise<Room | null> {
  const turn = await roomState.getCurrentTurn(roomId);
  if (!turn || turn.userId !== userId) return null;

  await endCurrentTurn(roomId, "passed_turn");
  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Owner-only: changes take effect starting with the next turn, not
// retroactively. The ownership check is folded into the UPDATE's WHERE clause
// so there's no separate lookup first, and the cached record is patched
// rather than dropped so the getRoom below stays on the fast path.
export async function setTurnDuration(
  roomId: string,
  userId: string,
  seconds: number
): Promise<Room | null> {
  if (!Number.isFinite(seconds) || seconds < MIN_TURN_SECONDS || seconds > MAX_TURN_SECONDS) {
    throw new Error(`turnDurationSeconds must be between ${MIN_TURN_SECONDS} and ${MAX_TURN_SECONDS}`);
  }

  const meta = await getRoomMeta(roomId);
  if (!meta || meta.ownerId !== userId) return null;

  const turnDurationSeconds = Math.round(seconds);
  // The durable write and the cache update go out together. This one write is
  // deliberately still on the response path: the cached record is rebuilt from
  // Postgres whenever someone joins or leaves, so a turn length that only
  // existed in Redis could quietly revert.
  await Promise.all([
    db
      .update(rooms)
      .set({ turnDurationSeconds, updatedAt: new Date() })
      .where(eq(rooms.id, roomId)),
    roomState.setCachedRoomMeta(roomId, {
      ...meta,
      turnDurationSeconds,
      updatedAt: Date.now(),
    }),
  ]);

  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Owner-only: freezes the current turn's countdown where it stands. The
// ownership check reads the cached record instead of Postgres — this is a
// button press, and it used to spend a full round trip just to learn who owns
// the room before doing anything.
export async function pauseTurn(roomId: string, userId: string): Promise<Room | null> {
  const meta = await getRoomMeta(roomId);
  if (!meta || meta.ownerId !== userId) return null;

  const result = await roomState.pauseTurn(roomId);
  if (!result) return null;

  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Owner-only: resumes a paused turn with whatever time was left on the clock.
export async function resumeTurn(roomId: string, userId: string): Promise<Room | null> {
  const meta = await getRoomMeta(roomId);
  if (!meta || meta.ownerId !== userId) return null;

  const result = await roomState.resumeTurn(roomId);
  if (!result) return null;

  const room = await getRoom(roomId);
  if (room) await broadcastRoomUpdate(roomId, room);
  return room ?? null;
}

// Whoever sits after `userId` in the rotation and is still in the room,
// wrapping around the end of the queue the way the turn order itself does.
// Undefined if the queue holds nobody else who's still here.
function nextInQueue(
  order: string[],
  userId: string,
  stillHere: Set<string>
): string | undefined {
  const start = order.indexOf(userId);
  if (start === -1) return order.find((id) => id !== userId && stillHere.has(id));

  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length];
    if (candidate !== userId && stillHere.has(candidate)) return candidate;
  }
  return undefined;
}

export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  await db
    .update(roomParticipants)
    .set({ leftAt: new Date() })
    .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.userId, userId)));

  await roomState.removePresence(roomId, userId);

  // Only turnDurationSeconds and "does this room exist" are needed here, and
  // neither is affected by the row we just updated — so the cached record is
  // fine, and saves a round trip on the way out the door.
  const [meta, order, live] = await Promise.all([
    getRoomMeta(roomId),
    roomState.getTurnOrder(roomId),
    roomState.getLiveState(roomId),
  ]);

  if (meta && order.includes(userId)) {
    if (live.currentTurnUserId === userId) {
      const stillQueued = order.filter((id) => id !== userId);
      if (stillQueued.length === 0) {
        await roomState.clearCurrentTurn(roomId);
      } else {
        // Rotate off the (still-present) order first so the "next after
        // userId" math is correct, then drop them from the queue below.
        await roomState.advanceTurn(roomId, meta.turnDurationSeconds * 1000);
        if (live.sessionId) {
          recordFinishedTurn({
            sessionId: live.sessionId,
            playerId: userId,
            turnNumber: live.turnNumber,
            codeSnapshot: live.code,
            result: "passed_turn",
            startedAt: live.turnStartedAt ? new Date(live.turnStartedAt) : new Date(),
            endedAt: new Date(),
          });
        }
      }
    }
    await roomState.removeFromTurnOrder(roomId, userId);
  }

  const remaining = await db
    .select({ userId: roomParticipants.userId })
    .from(roomParticipants)
    .where(and(eq(roomParticipants.roomId, roomId), isNull(roomParticipants.leftAt)))
    // Join order, so the fallback host below is the longest-standing member.
    .orderBy(roomParticipants.joinedAt);

  if (remaining.length === 0) {
    await deleteRoom(roomId);
  } else {
    // The host walking out doesn't end the room — the next person in the turn
    // queue inherits it, so problem-picking, pause/resume and turn-length
    // stay available to whoever is still in there. The turn order is the
    // queue people actually see, so it decides the succession; a room whose
    // rotation hasn't been seeded yet falls back to join order. Note the
    // room's participant cap follows the new host's plan from here on (see
    // getMaxParticipants in joinRoom) — nobody already inside is removed by
    // that, but a free host can't grow a Pro-sized room any further.
    if (meta?.ownerId === userId) {
      const stillHere = new Set(remaining.map((r) => r.userId));
      const nextHost = nextInQueue(order, userId, stillHere) ?? remaining[0].userId;
      await db
        .update(rooms)
        .set({ ownerId: nextHost, updatedAt: new Date() })
        .where(eq(rooms.id, roomId));
    }

    // The participant list changed for everyone still here.
    await roomState.invalidateRoomMeta(roomId);
    const room = await getRoom(roomId);
    if (room) await broadcastRoomUpdate(roomId, room);
  }
}
