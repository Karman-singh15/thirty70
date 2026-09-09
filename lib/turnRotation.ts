// The turn rotation, as pure functions.
//
// These used to live in lib/roomState.ts, which opens an ioredis connection at
// module scope — importing it to check a rotation rule meant connecting to
// Redis. Splitting them out costs nothing at runtime (roomState re-exports
// them, so every existing caller is unchanged) and makes the single most
// consequential logic in the app testable without any I/O at all.
//
// Nothing in here may import redis, the database, or anything that does.

/** The subset of the live room state the turn clock actually depends on. */
export interface TurnClockState {
  currentTurnUserId: string | null;
  turnEndsAt: number | null;
  turnPausedRemainingMs: number | null;
}

// Walks `order` starting just after `afterUserId` and returns the first
// entry `eligible` accepts, wrapping around the end the way the rotation
// itself does. An `afterUserId` of null — or one that isn't in `order` at
// all, which is what a player already removed from the queue looks like —
// starts the walk from the front.
//
// Every "who goes next" question in the app is this walk with a different
// notion of eligible, so it lives in one place.
export function nextInRotation(
  order: string[],
  afterUserId: string | null,
  eligible: (userId: string) => boolean
): string | undefined {
  const startIndex = afterUserId ? order.indexOf(afterUserId) : -1;
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(startIndex + step) % order.length];
    if (eligible(candidate)) return candidate;
  }
  return undefined;
}

// The next player who's actually online, so a turn never lands on someone
// who isn't there to take it. Wrapping means a lone online player keeps
// getting the turn back rather than the rotation stalling on them, and when
// nobody in `order` is online at all it falls back to the plain next entry —
// better to hand the turn to someone than strand the room without a holder
// until they reconnect. Callers guarantee a non-empty `order`.
export function pickNextTurnHolder(
  order: string[],
  onlineUserIds: string[],
  afterUserId: string | null
): string {
  const online = new Set(onlineUserIds);
  return (
    nextInRotation(order, afterUserId, (id) => online.has(id)) ??
    nextInRotation(order, afterUserId, () => true)!
  );
}

// Whether the current turn's clock has run out. A paused turn never is: the
// pause clears turnEndsAt and parks the remainder in turnPausedRemainingMs
// (both checked here rather than relying on that invariant holding).
//
// Pure and synchronous on state a caller already has, so the hot write paths
// can gate on it without paying for another read.
export function isTurnExpired(state: TurnClockState): boolean {
  return (
    state.currentTurnUserId !== null &&
    state.turnPausedRemainingMs === null &&
    state.turnEndsAt !== null &&
    Date.now() >= state.turnEndsAt
  );
}
