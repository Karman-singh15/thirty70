import { randomUUID } from "node:crypto";
import { createRedisSubscriber, redis } from "@/lib/redis";
import { report } from "@/lib/log";
import type { RoomInvite, SocialEvent } from "@/lib/socialEvents";

// Per-user live state: who is online anywhere in the app, the channel their
// open tabs listen on, and the room invites waiting for them.
//
// The room equivalent of this is lib/roomState.ts, and the split is the same:
// Postgres (lib/social.ts) owns the durable record of who is friends with
// whom; this owns what is only true right now.

// Global presence, as opposed to the per-room presence in roomState.ts. Both
// are refreshed by the heartbeat of an SSE connection, and this window is
// sized the same way — a bit over 2x the 20s heartbeat, so one missed ping
// doesn't flap a friend's dot off and back on.
const PRESENCE_WINDOW_MS = 50_000;
const PRESENCE_TTL_SECONDS = 120;

// A room invite is an offer to come sit with someone *now*. Past this it is
// noise: the room has almost certainly moved on to another problem, or gone
// entirely. Short enough that the dashboard never shows a dead card, long
// enough to survive making a cup of tea.
const ROOM_INVITE_TTL_MS = 30 * 60 * 1000;
const ROOM_INVITE_TTL_SECONDS = ROOM_INVITE_TTL_MS / 1000;

// Cap on invites held for one user, so someone being spammed — or a client
// stuck in a retry loop — can't grow a single Redis key without bound. The
// oldest fall off first.
const MAX_PENDING_INVITES = 20;

const presenceKey = "presence:users";
const userChannel = (userId: string) => `user:${userId}:events`;
const invitesKey = (userId: string) => `user:${userId}:roomInvites`;
// The reverse of invitesKey. Invites are stored per recipient, which answers
// "what has Alice been invited to?" in one read but leaves "who holds an
// invite to this room?" unanswerable without scanning every user — and that
// is the question revoking has to ask when a room closes. One small set per
// room, expiring on the same clock as the invites it tracks.
const roomInviteHoldersKey = (roomId: string) => `room:${roomId}:inviteHolders`;

// --- Presence ---

/**
 * Marks a user as online, or extends the mark they already have. Called on
 * connect and on every heartbeat of /api/me/stream.
 *
 * A sorted set scored by timestamp rather than a key per user, so asking
 * about a whole friends list is one command (see filterOnlineUsers) instead
 * of one round trip per friend.
 *
 * The prune rides along here rather than on the read path. It used to run on
 * every read, which made looking at your friends list a *write* to a key
 * every other reader was also writing — contention that grew with app usage,
 * for pure housekeeping. Here it costs nothing extra: this was already a
 * pipelined write to this key, so the extra command shares the round trip.
 * Correctness doesn't depend on it either way — filterOnlineUsers compares
 * scores against the window itself, so a stale entry reads as offline
 * whether or not it has been swept.
 */
export async function touchUserPresence(userId: string): Promise<void> {
  await redis
    .pipeline()
    .zadd(presenceKey, Date.now(), userId)
    .zremrangebyscore(presenceKey, "-inf", Date.now() - PRESENCE_WINDOW_MS)
    .expire(presenceKey, PRESENCE_TTL_SECONDS)
    .exec();
}

/** Drops a user from presence outright — a clean sign-out or tab close. */
export async function dropUserPresence(userId: string): Promise<void> {
  await redis.zrem(presenceKey, userId);
}

export async function isUserOnline(userId: string): Promise<boolean> {
  const score = await redis.zscore(presenceKey, userId);
  return score !== null && Number(score) >= Date.now() - PRESENCE_WINDOW_MS;
}

/**
 * Of the given users, the set seen within the presence window.
 *
 * ZMSCORE asks about exactly these members, so the cost tracks the list you
 * asked about. The previous version read the whole set — `ZRANGEBYSCORE
 * cutoff +inf` — and filtered it down in JavaScript, which meant answering
 * "are these 8 friends online" transferred every online user in the
 * application. That scaled with total app usage rather than with the
 * question, on a path that runs on every friends-panel open, every friends
 * event, and every invite dropdown.
 *
 * The window is applied here rather than trusted from the data: a member
 * whose score has fallen behind the cutoff is offline whether or not the
 * prune in touchUserPresence has got to it yet.
 */
export async function filterOnlineUsers(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const scores = await redis.zmscore(presenceKey, ...userIds);
  const cutoff = Date.now() - PRESENCE_WINDOW_MS;

  const online = new Set<string>();
  userIds.forEach((userId, i) => {
    // null means "not in the set at all" — never seen, or already pruned.
    const score = scores?.[i];
    if (score !== null && score !== undefined && Number(score) >= cutoff) {
      online.add(userId);
    }
  });

  return online;
}

// --- Pub/sub ---

/**
 * Fans an event out to every tab the user has open, on this instance or any
 * other. Failure is reported and swallowed: a friend request that was written
 * to Postgres has happened, and the receiver's next load will show it — a 500
 * to the *sender* over a failed notification would be a lie about what the
 * request did.
 */
export async function publishUserEvent(userId: string, event: SocialEvent): Promise<void> {
  try {
    await redis.publish(userChannel(userId), JSON.stringify(event));
  } catch (err) {
    report("user_event.publish_failed", err, { userId, type: event.type });
  }
}

/** Publishes the same event to several users in one round trip. */
export async function publishUserEvents(
  userIds: string[],
  event: SocialEvent
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    const payload = JSON.stringify(event);
    for (const userId of userIds) pipeline.publish(userChannel(userId), payload);
    await pipeline.exec();
  } catch (err) {
    report("user_event.publish_many_failed", err, {
      count: userIds.length,
      type: event.type,
    });
  }
}

// One Redis connection for *all* user channels on this instance, rather than
// the one-connection-per-room shape roomState.ts uses. The difference is
// cardinality: rooms are few and hold several people each, while user
// channels are one per signed-in tab, so a connection each would put the
// concurrent-connection cap (which Upstash bills on, and which was already
// the first ceiling this app hit) directly in the path of signing up.
//
// SUBSCRIBE/UNSUBSCRIBE are per-channel on a single connection, so the same
// refcounting works — it just tracks channels on one socket instead of
// sockets.
type SocialListener = (raw: string) => void;

interface UserSubscriptions {
  sub: ReturnType<typeof createRedisSubscriber> | null;
  channels: Map<string, Set<SocialListener>>;
}

// Survives hot reloads in development, like the Redis client and the room
// subscriptions do — without this every edit leaks a subscriber.
const globalForUserSubs = globalThis as unknown as {
  userSubscriptions?: UserSubscriptions;
};
const state: UserSubscriptions =
  globalForUserSubs.userSubscriptions ?? { sub: null, channels: new Map() };
if (process.env.NODE_ENV !== "production") {
  globalForUserSubs.userSubscriptions = state;
}

function ensureSubscriber(): ReturnType<typeof createRedisSubscriber> {
  if (state.sub) return state.sub;

  const sub = createRedisSubscriber();
  state.sub = sub;

  sub.on("message", (channel, raw) => {
    const listeners = state.channels.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      // One tab's writer throwing must not stop delivery to the others —
      // this connection is shared by every signed-in user on the instance,
      // so the blast radius of an unguarded throw is everyone.
      try {
        listener(raw);
      } catch (err) {
        report("user_subscription.listener_failed", err, { channel });
      }
    }
  });

  // ioredis resubscribes to its channels on reconnect by itself, and each
  // client resyncs from the snapshot it gets when its own stream reconnects,
  // so there's nothing to recover here beyond not crashing.
  sub.on("error", (err) => {
    report("user_subscription.connection_error", err);
  });

  return sub;
}

/**
 * Listens for one user's events. Returns the teardown to run on disconnect —
 * safe to call more than once, because the SSE route reaches cleanup from
 * several paths (client abort, stream close, error).
 */
export function subscribeUserChannel(
  userId: string,
  listener: SocialListener
): () => void {
  const channel = userChannel(userId);
  const sub = ensureSubscriber();

  let listeners = state.channels.get(channel);
  if (!listeners) {
    listeners = new Set();
    state.channels.set(channel, listeners);
    sub.subscribe(channel).catch((err) => {
      report("user_subscription.subscribe_failed", err, { channel });
    });
  }
  listeners.add(listener);

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const current = state.channels.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size > 0) return;

    // Drop it from the map before unsubscribing, so a tab arriving mid-teardown
    // re-subscribes rather than attaching to a channel we're about to leave.
    state.channels.delete(channel);
    state.sub?.unsubscribe(channel).catch((err) => {
      report("user_subscription.unsubscribe_failed", err, { channel });
    });
  };
}

/** Open user channels on this instance. Exposed for diagnostics. */
export function userSubscriptionStats(): { channels: number; listeners: number } {
  let listeners = 0;
  for (const set of state.channels.values()) listeners += set.size;
  return { channels: state.channels.size, listeners };
}

// --- Room invites ---
//
// Held in Redis rather than Postgres because an invite is worth less than the
// room it points at, and rooms are themselves ephemeral (see the empty-room
// sweep in lib/rooms.ts). A durable table would need its own sweep to avoid
// accumulating rows pointing at rooms that no longer exist; a hash with a TTL
// and an age check on read cleans up after itself.

/**
 * Records an invite for the receiver and hands back the stored row, id and
 * all. Returns the existing invite untouched when this sender has already
 * invited this person to this room, so a double-click doesn't produce two
 * cards on their dashboard.
 */
export async function putRoomInvite(
  toUserId: string,
  invite: Omit<RoomInvite, "id" | "createdAt">
): Promise<RoomInvite> {
  const key = invitesKey(toUserId);
  const existing = await listRoomInvites(toUserId);

  const duplicate = existing.find(
    (i) => i.roomId === invite.roomId && i.from.userId === invite.from.userId
  );
  if (duplicate) return duplicate;

  const stored: RoomInvite = { ...invite, id: randomUUID(), createdAt: Date.now() };

  const pipeline = redis.pipeline();
  pipeline.hset(key, stored.id, JSON.stringify(stored));
  // Reverse index, written in the same round trip as the invite itself so the
  // two can't disagree about who was invited.
  pipeline.sadd(roomInviteHoldersKey(invite.roomId), toUserId);
  pipeline.expire(roomInviteHoldersKey(invite.roomId), ROOM_INVITE_TTL_SECONDS);
  // Oldest-first eviction, computed from the list we already read rather than
  // with a second round trip.
  const overflow = existing.length + 1 - MAX_PENDING_INVITES;
  if (overflow > 0) {
    const doomed = [...existing]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, overflow)
      .map((i) => i.id);
    pipeline.hdel(key, ...doomed);
  }
  pipeline.expire(key, ROOM_INVITE_TTL_SECONDS);
  await pipeline.exec();

  return stored;
}

/**
 * The invites still worth showing, newest first. Prunes anything past the TTL
 * as it reads: the key's own expiry only covers a user who stops receiving
 * invites entirely, and a steady trickle would keep pushing it out while old
 * entries sat inside.
 */
export async function listRoomInvites(userId: string): Promise<RoomInvite[]> {
  const hash = await redis.hgetall(invitesKey(userId));
  if (!hash || Object.keys(hash).length === 0) return [];

  const cutoff = Date.now() - ROOM_INVITE_TTL_MS;
  const live: RoomInvite[] = [];
  const stale: string[] = [];

  for (const [id, raw] of Object.entries(hash)) {
    try {
      const invite = JSON.parse(raw) as RoomInvite;
      if (invite.createdAt >= cutoff) live.push(invite);
      else stale.push(id);
    } catch {
      // Unparseable entry — from an older shape of this payload, or a partial
      // write. Nothing can be done with it, so treat it as expired.
      stale.push(id);
    }
  }

  if (stale.length > 0) {
    await redis.hdel(invitesKey(userId), ...stale).catch(() => {
      // Pruning is opportunistic; the TTL is the backstop.
    });
  }

  return live.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Removes one invite and hands back what was removed, so the caller can tell
 * the sender their invite has been answered — `null` when there was nothing
 * there, which is the case for a double-click or a stale card.
 *
 * Reads before deleting because the stored row is the only place the sender's
 * id lives; the invite id alone says nothing about who sent it.
 */
export async function removeRoomInvite(
  userId: string,
  inviteId: string
): Promise<RoomInvite | null> {
  const raw = await redis.hget(invitesKey(userId), inviteId);
  if (!raw) return null;

  let invite: RoomInvite;
  try {
    invite = JSON.parse(raw) as RoomInvite;
  } catch {
    // Unparseable entry from an older payload shape — still remove it, but
    // there's no sender to notify.
    await redis.hdel(invitesKey(userId), inviteId);
    return null;
  }

  await redis
    .pipeline()
    .hdel(invitesKey(userId), inviteId)
    // Drop out of the reverse index too, so revokeRoomInvites doesn't walk
    // holders who no longer hold anything.
    .srem(roomInviteHoldersKey(invite.roomId), userId)
    .exec();

  return invite;
}

/**
 * Clears every invite pointing at a room and tells the people holding them,
 * so the card disappears from their dashboard the moment the room closes
 * instead of sitting there until they click it and get an error.
 *
 * Called from deleteRoom in lib/rooms.ts — both the "last person left" and
 * "everyone's been gone long enough" paths run through it.
 *
 * Reads its own holder list from the reverse index rather than taking one as
 * an argument. That parameter was the reason an earlier version of this could
 * never actually be called: the only caller is room deletion, which knows the
 * room's *participants*, and an invite holder is by definition someone who
 * hasn't joined — the two sets are disjoint.
 *
 * Failures are reported and swallowed. This is cleanup hanging off the end of
 * deleting a room; a Redis hiccup here must not leave the room half-deleted,
 * and every invite it misses still expires on its own TTL and still fails
 * gracefully if clicked.
 */
export async function revokeRoomInvites(roomId: string): Promise<void> {
  try {
    const holderIds = await redis.smembers(roomInviteHoldersKey(roomId));
    if (holderIds.length === 0) return;

    for (const userId of holderIds) {
      const doomed = (await listRoomInvites(userId)).filter((i) => i.roomId === roomId);
      if (doomed.length === 0) continue;

      await redis.hdel(invitesKey(userId), ...doomed.map((i) => i.id));
      for (const invite of doomed) {
        await publishUserEvent(userId, { type: "invite_revoked", inviteId: invite.id });
      }
    }

    await redis.del(roomInviteHoldersKey(roomId));
  } catch (err) {
    report("room_invites.revoke_failed", err, { roomId });
  }
}
