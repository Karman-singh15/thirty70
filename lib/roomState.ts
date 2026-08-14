import { redis } from "@/lib/redis";

// Live, ephemeral per-room state. Postgres (lib/rooms.ts) owns the durable
// record; Redis owns whatever needs to be read/written on every poll or
// keystroke — current code, presence, and turn/timer state.

const STATE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days of inactivity before a room's live state expires
const PRESENCE_WINDOW_MS = 10_000; // must be seen within this window to count as "online"

const stateKey = (roomId: string) => `room:${roomId}:state`;
const presenceKey = (roomId: string) => `room:${roomId}:presence`;
const turnOrderKey = (roomId: string) => `room:${roomId}:turnOrder`;

export interface LiveRoomState {
  code: string;
  language: string;
  updatedAt: number;
  sessionId: string | null;
  currentTurnUserId: string | null;
  turnNumber: number;
  turnStartedAt: number | null;
  turnEndsAt: number | null;
}

const DEFAULT_STATE: LiveRoomState = {
  code: "",
  language: "javascript",
  updatedAt: 0,
  sessionId: null,
  currentTurnUserId: null,
  turnNumber: 0,
  turnStartedAt: null,
  turnEndsAt: null,
};

export async function getLiveState(roomId: string): Promise<LiveRoomState> {
  const hash = await redis.hgetall(stateKey(roomId));
  if (!hash || Object.keys(hash).length === 0) return { ...DEFAULT_STATE };

  return {
    code: hash.code ?? "",
    language: hash.language || "javascript",
    updatedAt: Number(hash.updatedAt) || 0,
    sessionId: hash.sessionId || null,
    currentTurnUserId: hash.currentTurnUserId || null,
    turnNumber: Number(hash.turnNumber) || 0,
    turnStartedAt: hash.turnStartedAt ? Number(hash.turnStartedAt) : null,
    turnEndsAt: hash.turnEndsAt ? Number(hash.turnEndsAt) : null,
  };
}

export async function setLiveCode(
  roomId: string,
  code: string,
  language: string
): Promise<void> {
  const key = stateKey(roomId);
  await redis
    .pipeline()
    .hset(key, { code, language, updatedAt: Date.now() })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
}

// Starts a fresh session: resets code + turn state, keeps nothing from the last problem.
export async function resetLiveStateForSession(
  roomId: string,
  sessionId: string,
  code: string,
  language: string
): Promise<void> {
  const key = stateKey(roomId);
  await redis
    .pipeline()
    .hset(key, {
      code,
      language,
      updatedAt: Date.now(),
      sessionId,
      currentTurnUserId: "",
      turnNumber: 0,
      turnStartedAt: "",
      turnEndsAt: "",
    })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
}

export async function clearRoomState(roomId: string): Promise<void> {
  await redis.del(stateKey(roomId), presenceKey(roomId), turnOrderKey(roomId));
}

// --- Presence ---

export async function touchPresence(roomId: string, userId: string): Promise<void> {
  const key = presenceKey(roomId);
  await redis.pipeline().zadd(key, Date.now(), userId).expire(key, STATE_TTL_SECONDS).exec();
}

export async function removePresence(roomId: string, userId: string): Promise<void> {
  await redis.zrem(presenceKey(roomId), userId);
}

export async function getOnlineUserIds(
  roomId: string,
  windowMs = PRESENCE_WINDOW_MS
): Promise<string[]> {
  const key = presenceKey(roomId);
  const cutoff = Date.now() - windowMs;
  await redis.zremrangebyscore(key, "-inf", cutoff);
  return redis.zrangebyscore(key, cutoff, "+inf");
}

// --- Turn order + timer ---

export async function setTurnOrder(roomId: string, userIds: string[]): Promise<void> {
  const key = turnOrderKey(roomId);
  const pipeline = redis.pipeline().del(key);
  if (userIds.length > 0) {
    pipeline.rpush(key, ...userIds).expire(key, STATE_TTL_SECONDS);
  }
  await pipeline.exec();
}

export async function getTurnOrder(roomId: string): Promise<string[]> {
  return redis.lrange(turnOrderKey(roomId), 0, -1);
}

export async function startTurn(
  roomId: string,
  userId: string,
  turnNumber: number,
  durationMs: number
): Promise<void> {
  const key = stateKey(roomId);
  const now = Date.now();
  await redis
    .pipeline()
    .hset(key, {
      currentTurnUserId: userId,
      turnNumber,
      turnStartedAt: now,
      turnEndsAt: now + durationMs,
    })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
}

// Rotates to the next player in turnOrder after theirs, and starts their timer.
export async function advanceTurn(
  roomId: string,
  durationMs: number
): Promise<{ userId: string; turnNumber: number; turnEndsAt: number } | null> {
  const [order, state] = await Promise.all([getTurnOrder(roomId), getLiveState(roomId)]);
  if (order.length === 0) return null;

  const currentIndex = state.currentTurnUserId ? order.indexOf(state.currentTurnUserId) : -1;
  const nextIndex = (currentIndex + 1) % order.length;
  const nextUserId = order[nextIndex];
  const nextTurnNumber = state.turnNumber + 1;

  await startTurn(roomId, nextUserId, nextTurnNumber, durationMs);
  return { userId: nextUserId, turnNumber: nextTurnNumber, turnEndsAt: Date.now() + durationMs };
}

export async function getCurrentTurn(roomId: string): Promise<{
  userId: string;
  turnNumber: number;
  turnStartedAt: number | null;
  turnEndsAt: number | null;
} | null> {
  const state = await getLiveState(roomId);
  if (!state.currentTurnUserId) return null;
  return {
    userId: state.currentTurnUserId,
    turnNumber: state.turnNumber,
    turnStartedAt: state.turnStartedAt,
    turnEndsAt: state.turnEndsAt,
  };
}

// Ensures only one concurrent poller processes a given turn's timeout —
// callers race this on every poll, so it must be a single atomic claim.
export async function tryClaimTurnTimeout(
  roomId: string,
  turnNumber: number
): Promise<boolean> {
  const key = `room:${roomId}:turnTimeoutClaim:${turnNumber}`;
  const result = await redis.set(key, "1", "EX", 30, "NX");
  return result === "OK";
}
