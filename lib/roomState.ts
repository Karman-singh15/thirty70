import { redis } from "@/lib/redis";

// Live, ephemeral per-room state. Postgres (lib/rooms.ts) owns the durable
// record; Redis owns whatever needs to be read/written on every poll or
// keystroke — current code, presence, and turn/timer state.

const STATE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days of inactivity before a room's live state expires
const PRESENCE_WINDOW_MS = 10_000; // must be seen within this window to count as "online"

const stateKey = (roomId: string) => `room:${roomId}:state`;
const presenceKey = (roomId: string) => `room:${roomId}:presence`;
const turnOrderKey = (roomId: string) => `room:${roomId}:turnOrder`;
const mediaKey = (roomId: string, kind: "mic" | "camera") => `room:${roomId}:${kind}On`;

export interface LiveRoomState {
  code: string;
  language: string;
  updatedAt: number;
  sessionId: string | null;
  currentTurnUserId: string | null;
  turnNumber: number;
  turnStartedAt: number | null;
  turnEndsAt: number | null;
  // Non-null while the host has the current turn's timer paused — the ms
  // that were left on the clock at the moment it was paused. turnEndsAt is
  // cleared while this is set, so the timeout auto-advance in getRoom()
  // naturally leaves a paused turn alone.
  turnPausedRemainingMs: number | null;
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
  turnPausedRemainingMs: null,
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
    turnPausedRemainingMs: hash.turnPausedRemainingMs
      ? Number(hash.turnPausedRemainingMs)
      : null,
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
      turnPausedRemainingMs: "",
    })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
}

export async function clearRoomState(roomId: string): Promise<void> {
  await redis.del(
    stateKey(roomId),
    presenceKey(roomId),
    turnOrderKey(roomId),
    mediaKey(roomId, "mic"),
    mediaKey(roomId, "camera")
  );
}

// --- Presence ---

export async function touchPresence(roomId: string, userId: string): Promise<void> {
  const key = presenceKey(roomId);
  await redis.pipeline().zadd(key, Date.now(), userId).expire(key, STATE_TTL_SECONDS).exec();
}

export async function removePresence(roomId: string, userId: string): Promise<void> {
  await redis
    .pipeline()
    .zrem(presenceKey(roomId), userId)
    .srem(mediaKey(roomId, "mic"), userId)
    .srem(mediaKey(roomId, "camera"), userId)
    .exec();
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
      turnPausedRemainingMs: "",
    })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
}

// Host-only: freezes the current turn's countdown. Idempotent — pausing an
// already-paused turn just returns the remaining time it already had.
export async function pauseTurn(roomId: string): Promise<{ remainingMs: number } | null> {
  const state = await getLiveState(roomId);
  if (!state.currentTurnUserId) return null;
  if (state.turnPausedRemainingMs !== null) return { remainingMs: state.turnPausedRemainingMs };
  if (state.turnEndsAt === null) return null;

  const remainingMs = Math.max(0, state.turnEndsAt - Date.now());
  const key = stateKey(roomId);
  await redis
    .pipeline()
    .hset(key, { turnPausedRemainingMs: remainingMs, turnEndsAt: "" })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
  return { remainingMs };
}

// Host-only: resumes a paused turn with whatever time was left on the clock.
export async function resumeTurn(roomId: string): Promise<{ turnEndsAt: number } | null> {
  const state = await getLiveState(roomId);
  if (!state.currentTurnUserId || state.turnPausedRemainingMs === null) return null;

  const turnEndsAt = Date.now() + state.turnPausedRemainingMs;
  const key = stateKey(roomId);
  await redis
    .pipeline()
    .hset(key, { turnEndsAt, turnPausedRemainingMs: "" })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
  return { turnEndsAt };
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

// --- Shared mic/camera on-off state (not the media stream itself — just
// whether each participant currently has it on, for other clients to show) ---

export async function setMediaState(
  roomId: string,
  userId: string,
  kind: "mic" | "camera",
  on: boolean
): Promise<void> {
  const key = mediaKey(roomId, kind);
  if (on) {
    await redis.pipeline().sadd(key, userId).expire(key, STATE_TTL_SECONDS).exec();
  } else {
    await redis.srem(key, userId);
  }
}

export async function getMediaState(
  roomId: string
): Promise<{ micOn: string[]; cameraOn: string[] }> {
  const [micOn, cameraOn] = await Promise.all([
    redis.smembers(mediaKey(roomId, "mic")),
    redis.smembers(mediaKey(roomId, "camera")),
  ]);
  return { micOn, cameraOn };
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
