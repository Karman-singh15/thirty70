import { nanoid } from "nanoid";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { problems, roomParticipants, rooms, sessions, turns, users } from "@/lib/db/schema";
import * as roomState from "@/lib/roomState";

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
  inviteCode: string;
  participants: Participant[];
  problem: RoomProblem | null;
  code: string;
  language: string;
  turnDurationSeconds: number;
  turnOrder: string[];
  currentTurnUserId: string | null;
  turnNumber: number;
  turnEndsAt: number | null;
  turnPausedRemainingMs: number | null;
  createdAt: number;
  updatedAt: number;
}

export type UpdateCodeResult = "ok" | "not_member" | "not_your_turn";

const MIN_TURN_SECONDS = 10;
const MAX_TURN_SECONDS = 3600;

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

async function upsertProblem(problem: RoomProblem): Promise<void> {
  await db
    .insert(problems)
    .values(problem)
    .onConflictDoUpdate({
      target: problems.titleSlug,
      set: {
        title: problem.title,
        difficulty: problem.difficulty,
        frontendQuestionId: problem.frontendQuestionId,
      },
    });
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

  const room = await getRoom(id);
  return room!;
}

// Fetches everything needed to render a room in one parallel batch (one
// Postgres round trip via a relational query, one Redis round trip for
// live state + turn order) instead of staging queries sequentially. Also
// settles an expired turn inline, so pollers don't need a separate
// timeout-check request before this one.
export async function getRoom(id: string): Promise<Room | undefined> {
  const [roomRow, participantRows, live, turnOrder] = await Promise.all([
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
      .where(and(eq(roomParticipants.roomId, id), isNull(roomParticipants.leftAt))),
    roomState.getLiveState(id),
    roomState.getTurnOrder(id),
  ]);

  if (!roomRow) return undefined;

  let liveState = live;
  if (
    liveState.currentTurnUserId &&
    liveState.turnEndsAt !== null &&
    Date.now() >= liveState.turnEndsAt &&
    (await roomState.tryClaimTurnTimeout(id, liveState.turnNumber))
  ) {
    await endCurrentTurn(id, "timed_out");
    liveState = await roomState.getLiveState(id);
  }

  return {
    id: roomRow.id,
    name: roomRow.name,
    ownerId: roomRow.ownerId,
    ownerName: roomRow.owner?.name ?? "Unknown",
    inviteCode: roomRow.inviteCode,
    participants: participantRows.map((p) => ({
      userId: p.userId,
      name: p.name,
      imageUrl: p.imageUrl ?? "",
      joinedAt: p.joinedAt.getTime(),
    })),
    problem: roomRow.problem ? mapProblem(roomRow.problem) : null,
    code: liveState.code,
    language: liveState.language,
    turnDurationSeconds: roomRow.turnDurationSeconds,
    turnOrder,
    currentTurnUserId: liveState.currentTurnUserId,
    turnNumber: liveState.turnNumber,
    turnEndsAt: liveState.turnEndsAt,
    turnPausedRemainingMs: liveState.turnPausedRemainingMs,
    createdAt: roomRow.createdAt.getTime(),
    updatedAt: roomRow.updatedAt.getTime(),
  };
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
  const roomRow = await db.query.rooms.findFirst({ where: eq(rooms.id, roomId) });
  if (!roomRow) return null;

  await ensureUser(userId, name, imageUrl);

  await db
    .insert(roomParticipants)
    .values({ roomId, userId })
    .onConflictDoUpdate({
      target: [roomParticipants.roomId, roomParticipants.userId],
      set: { leftAt: null },
    });

  await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.id, roomId));
  await roomState.touchPresence(roomId, userId);

  return (await getRoom(roomId)) ?? null;
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
  const roomRow = await db.query.rooms.findFirst({ where: eq(rooms.id, roomId) });
  if (!roomRow) return null;
  if (roomRow.ownerId !== userId) return null;

  await upsertProblem(problem);

  // Whatever was in progress on the previous problem is done now.
  await db
    .update(sessions)
    .set({ status: "abandoned", endedAt: new Date() })
    .where(and(eq(sessions.roomId, roomId), eq(sessions.status, "in_progress")));

  const [session] = await db
    .insert(sessions)
    .values({ roomId, problemSlug: problem.titleSlug })
    .returning({ id: sessions.id });

  await db
    .update(rooms)
    .set({ problemSlug: problem.titleSlug, status: "active", updatedAt: new Date() })
    .where(eq(rooms.id, roomId));

  const activeParticipants = await db
    .select({ userId: roomParticipants.userId })
    .from(roomParticipants)
    .where(and(eq(roomParticipants.roomId, roomId), isNull(roomParticipants.leftAt)))
    .orderBy(roomParticipants.joinedAt);

  const order = activeParticipants.map((p) => p.userId);
  await roomState.setTurnOrder(roomId, order);
  await roomState.resetLiveStateForSession(roomId, session.id, starterCode, starterLanguage);

  if (order.length > 0) {
    await roomState.startTurn(roomId, order[0], 1, roomRow.turnDurationSeconds * 1000);
  }

  return (await getRoom(roomId)) ?? null;
}

// Fast path for the debounced editor autosave — writes only to Redis.
// Gated to whoever currently holds the turn (once a turn cycle has started).
export async function updateRoomCode(
  roomId: string,
  code: string,
  language: string,
  userId: string
): Promise<UpdateCodeResult> {
  const [membership, turn] = await Promise.all([
    db.query.roomParticipants.findFirst({
      where: and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.userId, userId),
        isNull(roomParticipants.leftAt)
      ),
    }),
    roomState.getCurrentTurn(roomId),
  ]);
  if (!membership) return "not_member";
  if (turn && turn.userId !== userId) return "not_your_turn";

  await roomState.setLiveCode(roomId, code, language);
  await roomState.touchPresence(roomId, userId);
  return "ok";
}

async function endCurrentTurn(
  roomId: string,
  result: "passed_turn" | "timed_out"
): Promise<void> {
  const [roomRow, live] = await Promise.all([
    db.query.rooms.findFirst({ where: eq(rooms.id, roomId) }),
    roomState.getLiveState(roomId),
  ]);
  if (!roomRow || !live.currentTurnUserId || !live.sessionId) return;

  await db.insert(turns).values({
    sessionId: live.sessionId,
    playerId: live.currentTurnUserId,
    turnNumber: live.turnNumber,
    codeSnapshot: live.code,
    result,
    startedAt: live.turnStartedAt ? new Date(live.turnStartedAt) : new Date(),
    endedAt: new Date(),
  });

  await roomState.advanceTurn(roomId, roomRow.turnDurationSeconds * 1000);
}

// Called by the current turn holder to voluntarily hand off.
export async function passTurn(roomId: string, userId: string): Promise<Room | null> {
  const turn = await roomState.getCurrentTurn(roomId);
  if (!turn || turn.userId !== userId) return null;

  await endCurrentTurn(roomId, "passed_turn");
  return (await getRoom(roomId)) ?? null;
}

// Owner-only: changes take effect starting with the next turn, not
// retroactively. The ownership check is folded into the UPDATE's WHERE
// clause (rather than a separate findFirst beforehand) so this is one DB
// round trip instead of two before the getRoom() refetch.
export async function setTurnDuration(
  roomId: string,
  userId: string,
  seconds: number
): Promise<Room | null> {
  if (!Number.isFinite(seconds) || seconds < MIN_TURN_SECONDS || seconds > MAX_TURN_SECONDS) {
    throw new Error(`turnDurationSeconds must be between ${MIN_TURN_SECONDS} and ${MAX_TURN_SECONDS}`);
  }

  const [updated] = await db
    .update(rooms)
    .set({ turnDurationSeconds: Math.round(seconds), updatedAt: new Date() })
    .where(and(eq(rooms.id, roomId), eq(rooms.ownerId, userId)))
    .returning({ id: rooms.id });
  if (!updated) return null;

  return (await getRoom(roomId)) ?? null;
}

// Owner-only: freezes the current turn's countdown where it stands.
export async function pauseTurn(roomId: string, userId: string): Promise<Room | null> {
  const roomRow = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId),
    columns: { ownerId: true },
  });
  if (!roomRow || roomRow.ownerId !== userId) return null;

  const result = await roomState.pauseTurn(roomId);
  if (!result) return null;

  return (await getRoom(roomId)) ?? null;
}

// Owner-only: resumes a paused turn with whatever time was left on the clock.
export async function resumeTurn(roomId: string, userId: string): Promise<Room | null> {
  const roomRow = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId),
    columns: { ownerId: true },
  });
  if (!roomRow || roomRow.ownerId !== userId) return null;

  const result = await roomState.resumeTurn(roomId);
  if (!result) return null;

  return (await getRoom(roomId)) ?? null;
}

export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  await db
    .update(roomParticipants)
    .set({ leftAt: new Date() })
    .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.userId, userId)));

  await roomState.removePresence(roomId, userId);

  const remaining = await db
    .select({ userId: roomParticipants.userId })
    .from(roomParticipants)
    .where(and(eq(roomParticipants.roomId, roomId), isNull(roomParticipants.leftAt)));

  if (remaining.length === 0) {
    await db.delete(rooms).where(eq(rooms.id, roomId)); // cascades participants/sessions/turns
    await roomState.clearRoomState(roomId);
  }
}
