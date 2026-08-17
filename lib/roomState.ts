import { createRedisSubscriber, redis } from "@/lib/redis";
import type {
  CursorPosition,
  DocChange,
  EditorDoc,
  EditorEvent,
  RoomEvent,
  RoomParticipant,
  RoomProblemSummary,
  RoomSnapshot,
} from "@/lib/editorDoc";

// Live, ephemeral per-room state. Postgres (lib/rooms.ts) owns the durable
// record; Redis owns whatever needs to be read/written on every poll or
// keystroke — current code, presence, and turn/timer state.

const STATE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days of inactivity before a room's live state expires

// Presence is refreshed by the SSE stream's heartbeat (every 20s — see
// HEARTBEAT_MS in the /stream route) rather than by a poll, so this window
// has to comfortably outlive one heartbeat interval: a bit over 2x it, so one
// missed ping doesn't flap someone offline. A clean disconnect (tab closed,
// left the room) doesn't get marked offline immediately either — see the
// /stream route for why — so "online" here means "seen within the last 50s",
// not "connection currently open".
const PRESENCE_WINDOW_MS = 50_000;

const stateKey = (roomId: string) => `room:${roomId}:state`;
const presenceKey = (roomId: string) => `room:${roomId}:presence`;
const turnOrderKey = (roomId: string) => `room:${roomId}:turnOrder`;
const mediaKey = (roomId: string, kind: "mic" | "camera") => `room:${roomId}:${kind}On`;
const signalKey = (roomId: string, userId: string) => `room:${roomId}:signal:${userId}`;
const editorChannel = (roomId: string) => `room:${roomId}:editor`;
const roomChannel = (roomId: string) => `room:${roomId}:room`;
const metaKey = (roomId: string) => `room:${roomId}:meta`;

// How long a room's durable data may sit in the cache before being reread.
// Every change *we* make invalidates or patches the entry outright, so this
// only bounds staleness from changes we don't see — a Clerk display name or
// avatar being edited elsewhere. Short enough that nobody notices, long
// enough that a room polling every second reads Postgres about once every
// 300 polls instead of every single one.
const META_TTL_SECONDS = 300;

const SIGNAL_TTL_SECONDS = 120; // a WebRTC handshake message is worthless after this
const SIGNAL_QUEUE_MAX = 200; // cap so a peer that stopped polling can't grow it unbounded

export interface LiveRoomState {
  code: string;
  language: string;
  // Bumped on every accepted write to the shared document. Clients use it to
  // tell "the next edit in sequence" from "I missed something and need to
  // resync", and it's what makes the compare-and-set write below safe.
  docVersion: number;
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
  docVersion: 0,
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
    docVersion: Number(hash.docVersion) || 0,
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

// Unconditional write — for callers that already own the whole document and
// aren't racing anyone (the legacy /sync autosave path). Returns the new
// document version so the caller can announce it.
export async function setLiveCode(
  roomId: string,
  code: string,
  language: string
): Promise<number> {
  const key = stateKey(roomId);
  const results = await redis
    .pipeline()
    .hset(key, { code, language, updatedAt: Date.now() })
    .hincrby(key, "docVersion", 1)
    .expire(key, STATE_TTL_SECONDS)
    .exec();
  return Number(results?.[1]?.[1] ?? 0);
}

// Starts a fresh session: resets code + turn state, keeps nothing from the last problem.
//
// docVersion deliberately keeps counting up rather than restarting at 1.
// Clients ignore any document older than the one they hold, so a counter that
// restarted would make the reset look stale to everyone already in the room —
// they'd sit on the previous problem's code. Returns the new version so the
// caller can announce it.
export async function resetLiveStateForSession(
  roomId: string,
  sessionId: string,
  code: string,
  language: string
): Promise<number> {
  const key = stateKey(roomId);
  const results = await redis
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
    .hincrby(key, "docVersion", 1)
    .expire(key, STATE_TTL_SECONDS)
    .exec();
  return Number(results?.[1]?.[1] ?? 1);
}

export async function clearRoomState(roomId: string): Promise<void> {
  await redis.del(
    stateKey(roomId),
    presenceKey(roomId),
    turnOrderKey(roomId),
    metaKey(roomId),
    mediaKey(roomId, "mic"),
    mediaKey(roomId, "camera")
  );
}

// --- Cached room record ---
//
// Everything about a room that lives in Postgres but almost never changes:
// its name, who's in it, which problem is loaded. Reading that from Neon cost
// ~550ms, and the room polls for turn state constantly — so the durable
// record is cached here and every poll is served entirely from Redis (~30ms).
//
// Correctness comes from the write side: each function in lib/rooms.ts that
// changes any of this either patches the entry or drops it, so a stale read
// isn't possible for anything the app itself does.

export interface CachedRoomMeta {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  inviteCode: string;
  participants: RoomParticipant[];
  problem: RoomProblemSummary | null;
  turnDurationSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export async function getCachedRoomMeta(roomId: string): Promise<CachedRoomMeta | null> {
  const raw = await redis.get(metaKey(roomId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRoomMeta;
  } catch {
    return null;
  }
}

export async function setCachedRoomMeta(
  roomId: string,
  meta: CachedRoomMeta
): Promise<void> {
  await redis.set(metaKey(roomId), JSON.stringify(meta), "EX", META_TTL_SECONDS);
}

export async function invalidateRoomMeta(roomId: string): Promise<void> {
  await redis.del(metaKey(roomId));
}

// For changes small enough to apply in place — which keeps the mutation's own
// response on the fast path instead of forcing the next read back to Postgres.
// A miss is a no-op: there's nothing cached to go stale.
export async function patchCachedRoomMeta(
  roomId: string,
  patch: Partial<CachedRoomMeta>
): Promise<void> {
  const meta = await getCachedRoomMeta(roomId);
  if (!meta) return;
  await setCachedRoomMeta(roomId, { ...meta, ...patch });
}

// --- Shared document (the collaborative editor) ---
//
// Every client holds a copy of the same document. Redis holds the canonical
// one, tagged with a version. A client writes by sending the full resulting
// text along with the version it believed it was editing; the write only
// lands if that version is still current. The small edits that produced the
// text ride along and get fanned out to the other clients, so they can patch
// their editor in place (keeping scroll position and cursor) instead of
// having the whole buffer replaced under them on every keystroke.
//
// Sending the full text rather than having the server splice the edits in is
// deliberate: it makes the write a single atomic compare-and-set, with no
// read-modify-write window and no string-offset arithmetic in Lua (whose
// byte-based indexing would corrupt any non-ASCII character in the file).

export type { CursorPosition, DocChange, EditorDoc, EditorEvent, RoomEvent, RoomSnapshot };

export type CasResult =
  | { ok: true; version: number }
  | { ok: false; doc: EditorDoc };

// Applies only if `docVersion` still matches what the writer was editing.
// Returns the current document when it doesn't, so the caller can hand the
// writer the truth to reset onto.
const CAS_SET_CODE = `
local key = KEYS[1]
local expected = tonumber(ARGV[1])
local current = tonumber(redis.call('HGET', key, 'docVersion'))
if current == nil then current = 0 end
if expected ~= current then
  return {0, current, redis.call('HGET', key, 'code') or '', redis.call('HGET', key, 'language') or ''}
end
local next_version = current + 1
redis.call('HSET', key, 'code', ARGV[2], 'language', ARGV[3], 'docVersion', next_version, 'updatedAt', ARGV[4])
redis.call('EXPIRE', key, tonumber(ARGV[5]))
return {1, next_version}
`;

export async function casSetCode(
  roomId: string,
  expectedVersion: number,
  code: string,
  language: string
): Promise<CasResult> {
  const result = (await redis.eval(
    CAS_SET_CODE,
    1,
    stateKey(roomId),
    expectedVersion,
    code,
    language,
    Date.now(),
    STATE_TTL_SECONDS
  )) as [number, number] | [number, number, string, string];

  if (Number(result[0]) === 1) {
    return { ok: true, version: Number(result[1]) };
  }
  return {
    ok: false,
    doc: {
      version: Number(result[1]),
      code: (result[2] as string) ?? "",
      language: (result[3] as string) || "javascript",
    },
  };
}

// `touchUserId` rides along in the same pipeline: typing is proof of life, and
// keeping the writer online shouldn't cost a second round trip on a path that
// runs while someone is typing.
export async function publishEditorEvent(
  roomId: string,
  event: EditorEvent,
  touchUserId?: string
): Promise<void> {
  const pipeline = redis.pipeline().publish(editorChannel(roomId), JSON.stringify(event));
  if (touchUserId) {
    const key = presenceKey(roomId);
    pipeline.zadd(key, Date.now(), touchUserId).expire(key, STATE_TTL_SECONDS);
  }
  await pipeline.exec();
}

export async function publishRoomEvent(roomId: string, room: RoomSnapshot): Promise<void> {
  await redis.publish(roomChannel(roomId), JSON.stringify({ type: "room", room }));
}

// Server-side listener behind the SSE route. One Redis connection per client
// carries both channels — a connection in subscriber mode can't serve
// anything else, so multiplexing here is what keeps "one browser tab, one
// Redis connection" true even as more event types ride the same stream.
// Hands back a teardown to run when the client disconnects.
export function subscribeRoomChannels(
  roomId: string,
  handlers: { onEditorEvent: (raw: string) => void; onRoomEvent: (raw: string) => void }
): () => void {
  const sub = createRedisSubscriber();
  const editorCh = editorChannel(roomId);
  const roomCh = roomChannel(roomId);

  sub.subscribe(editorCh, roomCh).catch(() => {});
  sub.on("message", (received, raw) => {
    if (received === editorCh) handlers.onEditorEvent(raw);
    else if (received === roomCh) handlers.onRoomEvent(raw);
  });
  // A dropped connection reconnects and resubscribes on its own; the client
  // resyncs from the snapshot it gets on its own reconnect, so there's
  // nothing to recover here beyond not crashing.
  sub.on("error", () => {});

  return () => {
    sub.removeAllListeners();
    sub.quit().catch(() => sub.disconnect());
  };
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
  // Sweeping the expired entries and reading the live ones go in one pipeline
  // — awaiting the sweep first cost a second round trip on every poll.
  const results = await redis
    .pipeline()
    .zremrangebyscore(key, "-inf", cutoff)
    .zrangebyscore(key, cutoff, "+inf")
    .exec();
  return (results?.[1]?.[1] as string[] | undefined) ?? [];
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

// Adds a late joiner to the tail of the circular queue. Only meaningful once
// a session has actually started the queue (setTurnOrder ran) — if no one's
// picked a problem yet, this joiner will be included in that initial snapshot
// instead, so an empty queue here is left alone.
export async function addToTurnOrder(roomId: string, userId: string): Promise<void> {
  const key = turnOrderKey(roomId);
  const existing = await redis.lrange(key, 0, -1);
  if (existing.length === 0 || existing.includes(userId)) return;
  await redis.pipeline().rpush(key, userId).expire(key, STATE_TTL_SECONDS).exec();
}

export async function removeFromTurnOrder(roomId: string, userId: string): Promise<void> {
  await redis.lrem(turnOrderKey(roomId), 0, userId);
}

// Ends the current turn with no one left to hand it to (the last queued
// player just left). Leaves turnNumber as-is — it resumes, not restarts, if
// the queue gains players again.
export async function clearCurrentTurn(roomId: string): Promise<void> {
  const key = stateKey(roomId);
  await redis
    .pipeline()
    .hset(key, {
      currentTurnUserId: "",
      turnStartedAt: "",
      turnEndsAt: "",
      turnPausedRemainingMs: "",
    })
    .expire(key, STATE_TTL_SECONDS)
    .exec();
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

// --- WebRTC signaling mailboxes ---
//
// Each participant gets a per-room inbox list that peers push handshake
// messages (SDP offers/answers, ICE candidates) into. The media itself never
// touches the server — it flows browser-to-browser — so this only carries the
// small setup messages. Inboxes expire on their own (SIGNAL_TTL_SECONDS), so
// there's nothing to clean up when someone disappears mid-handshake.

export interface SignalMessage {
  from: string;
  // Identifies the sender's *page load*, not the user. A refresh produces
  // brand-new peer connections, and the remote side has no other way to tell
  // that the connection it still holds is now pointing at a dead browser.
  session: string;
  type: "hello" | "offer" | "answer" | "ice";
  data: unknown;
}

export async function pushSignals(
  roomId: string,
  messages: {
    to: string;
    from: string;
    session: string;
    type: SignalMessage["type"];
    data: unknown;
  }[]
): Promise<void> {
  if (messages.length === 0) return;

  const pipeline = redis.pipeline();
  for (const m of messages) {
    const key = signalKey(roomId, m.to);
    pipeline.rpush(
      key,
      JSON.stringify({ from: m.from, session: m.session, type: m.type, data: m.data })
    );
    pipeline.ltrim(key, -SIGNAL_QUEUE_MAX, -1);
    pipeline.expire(key, SIGNAL_TTL_SECONDS);
  }
  await pipeline.exec();
}

// Reads and clears the caller's inbox in one atomic step, so a message pushed
// mid-drain is never silently dropped.
export async function drainSignals(
  roomId: string,
  userId: string
): Promise<SignalMessage[]> {
  const key = signalKey(roomId, userId);
  const results = await redis.multi().lrange(key, 0, -1).del(key).exec();
  const raw = (results?.[0]?.[1] as string[] | undefined) ?? [];

  return raw.flatMap((entry) => {
    try {
      return [JSON.parse(entry) as SignalMessage];
    } catch {
      return [];
    }
  });
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
