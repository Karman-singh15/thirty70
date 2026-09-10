import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { friendships, users } from "@/lib/db/schema";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { filterOnlineUsers } from "@/lib/userState";
import type {
  Friend,
  FriendRequest,
  RelationshipStatus,
  SearchResult,
  UserSummary,
} from "@/lib/socialEvents";

// The durable half of the friends system: who someone is, and who they know.
// lib/userState.ts owns the half that's only true right now (who's online,
// which invites are outstanding).

export interface Profile {
  userId: string;
  username: string | null;
  name: string;
  imageUrl: string;
}

/** How many rows a search may return — enough to find someone, not a directory. */
const SEARCH_LIMIT = 10;

// Postgres reports a violated unique constraint as SQLSTATE 23505. Matching
// on the code rather than the message text because the message is
// human-facing and not part of any contract; the code is.
const UNIQUE_VIOLATION = "23505";

// Walks the cause chain rather than reading `err.code` off the top: Drizzle
// wraps a failed query in a DrizzleQueryError carrying the driver's error as
// `cause`, so the code is one level down and the wrapper has none. Checking
// only the top level silently classified every taken username as a 500.
function isUniqueViolation(err: unknown): boolean {
  // Bounded rather than `while (true)`: a cause chain is two or three deep in
  // practice, and a cycle in it would otherwise hang the request.
  for (let current = err, depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

type UserRow = Pick<typeof users.$inferSelect, "id" | "username" | "name" | "imageUrl">;

function toSummary(row: UserRow): UserSummary {
  return {
    userId: row.id,
    username: row.username,
    name: row.name,
    imageUrl: row.imageUrl ?? "",
  };
}

const publicColumns = {
  id: users.id,
  username: users.username,
  name: users.name,
  imageUrl: users.imageUrl,
};

/**
 * The user's row, created if this is the first time we've seen them.
 *
 * Rooms already did this lazily on create/join (ensureUser in lib/rooms.ts),
 * which was enough when a row only had to exist before a foreign key pointed
 * at it. It isn't enough now: a username is something you're asked for on
 * arrival, and being findable by your friends can't wait until you happen to
 * open a room.
 *
 * The name/image are refreshed on the way through, so a Clerk profile edit
 * shows up here without a webhook.
 */
export async function ensureProfile(
  userId: string,
  name: string,
  imageUrl: string
): Promise<Profile> {
  const [row] = await db
    .insert(users)
    .values({ id: userId, name, imageUrl })
    .onConflictDoUpdate({ target: users.id, set: { name, imageUrl } })
    .returning(publicColumns);

  return { ...toSummary(row) };
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const [row] = await db
    .select(publicColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ? { ...toSummary(row) } : null;
}

export type SetUsernameResult =
  | { ok: true; username: string }
  | { ok: false; reason: "invalid" | "taken"; message: string };

/**
 * Claims a username, or explains why it couldn't be claimed.
 *
 * The taken case is decided by the unique index, not by a SELECT beforehand:
 * two people submitting the same handle at the same moment would both pass a
 * check-then-insert, and one of them would get a 500 instead of "that one's
 * gone". The index is the only thing that can actually answer this, so it is
 * what's asked.
 */
export async function setUsername(
  userId: string,
  raw: string
): Promise<SetUsernameResult> {
  const problem = validateUsername(raw);
  if (problem) return { ok: false, reason: "invalid", message: problem };

  const username = normalizeUsername(raw);

  try {
    await db.update(users).set({ username }).where(eq(users.id, userId));
    return { ok: true, username };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        reason: "taken",
        message: `"${username}" is already taken.`,
      };
    }
    throw err;
  }
}

// --- Reading the graph ---

interface FriendshipRow {
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted";
  createdAt: Date;
  respondedAt: Date | null;
}

/** Every row this user is on either side of, in one read. */
async function loadEdges(userId: string): Promise<FriendshipRow[]> {
  return db
    .select()
    .from(friendships)
    .where(
      or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
    );
}

/** The row between two people, whichever direction it was created in. */
async function loadEdge(
  a: string,
  b: string
): Promise<FriendshipRow | undefined> {
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
        and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))
      )
    )
    .limit(1);

  return row;
}

/** Users these ids belong to, keyed by id. One read for the whole batch. */
async function loadSummaries(ids: string[]): Promise<Map<string, UserSummary>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select(publicColumns)
    .from(users)
    .where(inArray(users.id, ids));

  return new Map(rows.map((row) => [row.id, toSummary(row)]));
}

export interface SocialGraph {
  friends: Friend[];
  /** Requests waiting on *this* user to answer. */
  incoming: FriendRequest[];
  /** Requests this user sent that haven't been answered. */
  outgoing: FriendRequest[];
}

/**
 * Everything the friends panel draws, in three round trips regardless of how
 * many people are involved: the edges, the users on the other end of them,
 * and which of those are online.
 */
export async function getSocialGraph(userId: string): Promise<SocialGraph> {
  const edges = await loadEdges(userId);
  if (edges.length === 0) return { friends: [], incoming: [], outgoing: [] };

  const otherId = (edge: FriendshipRow) =>
    edge.requesterId === userId ? edge.addresseeId : edge.requesterId;

  const summaries = await loadSummaries([...new Set(edges.map(otherId))]);

  const accepted = edges.filter((e) => e.status === "accepted");
  const online = await filterOnlineUsers(accepted.map(otherId));

  const friends: Friend[] = [];
  const incoming: FriendRequest[] = [];
  const outgoing: FriendRequest[] = [];

  for (const edge of edges) {
    const other = summaries.get(otherId(edge));
    // A row whose other side has no user is impossible through the foreign
    // key, but skipping beats rendering a blank card if it ever happens.
    if (!other) continue;

    if (edge.status === "accepted") {
      friends.push({
        ...other,
        online: online.has(other.userId),
        friendsSince: (edge.respondedAt ?? edge.createdAt).getTime(),
      });
    } else if (edge.addresseeId === userId) {
      incoming.push({ ...other, sentAt: edge.createdAt.getTime() });
    } else {
      outgoing.push({ ...other, sentAt: edge.createdAt.getTime() });
    }
  }

  // Online friends first, then alphabetically — the list exists to be picked
  // from, and whoever you can actually reach right now is the answer more
  // often than not.
  friends.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  incoming.sort((a, b) => b.sentAt - a.sentAt);
  outgoing.sort((a, b) => b.sentAt - a.sentAt);

  return { friends, incoming, outgoing };
}

/** Just the ids, for the callers that only need to notify or filter. */
export async function getFriendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
      )
    );

  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const edge = await loadEdge(a, b);
  return edge?.status === "accepted";
}

/**
 * Finds people to send a request to.
 *
 * Matches a username prefix or a display name substring: the username is the
 * identifier you're told to type, but people reliably know each other's real
 * name and not their handle, and a search that only accepted the handle sent
 * them back to ask for it.
 *
 * Accounts without a username are excluded — there'd be no way to be sure
 * you'd found the right person, and they haven't finished signing up.
 */
export async function searchUsers(
  viewerId: string,
  rawQuery: string
): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const prefix = normalizeUsername(query);
  // Escape the wildcards so a query of "%" doesn't match the whole table.
  const escaped = query.replace(/[%_\\]/g, "\\$&");

  const rows = await db
    .select(publicColumns)
    .from(users)
    .where(
      and(
        ne(users.id, viewerId),
        sql`${users.username} is not null`,
        or(
          ilike(users.username, `${prefix.replace(/[%_\\]/g, "\\$&")}%`),
          ilike(users.name, `%${escaped}%`)
        )
      )
    )
    // Exact handle first, then handles that start with the query, then the
    // name matches — so typing someone's full username puts them at the top
    // even when a dozen display names also contain it.
    .orderBy(
      sql`case when ${users.username} = ${prefix} then 0 when ${users.username} ilike ${`${prefix}%`} then 1 else 2 end`,
      asc(users.username)
    )
    .limit(SEARCH_LIMIT);

  if (rows.length === 0) return [];

  // One read for the viewer's whole graph rather than one per result: the
  // relationship for every row is then a map lookup.
  const edges = await loadEdges(viewerId);
  const byOther = new Map<string, FriendshipRow>();
  for (const edge of edges) {
    byOther.set(edge.requesterId === viewerId ? edge.addresseeId : edge.requesterId, edge);
  }

  return rows.map((row) => {
    const edge = byOther.get(row.id);
    let relationship: RelationshipStatus = "none";
    if (row.id === viewerId) relationship = "self";
    else if (edge?.status === "accepted") relationship = "friends";
    else if (edge?.status === "pending") {
      relationship = edge.requesterId === viewerId ? "outgoing_pending" : "incoming_pending";
    }

    return { ...toSummary(row), relationship };
  });
}

// --- Changing the graph ---

export type SendRequestResult =
  | { ok: true; outcome: "sent" | "accepted"; target: UserSummary }
  | {
      ok: false;
      reason: "not_found" | "self" | "already_friends" | "already_sent";
      message: string;
    };

/**
 * Sends a friend request to a username.
 *
 * Two requests crossing in the post become a friendship rather than a second
 * pending row: if they've already asked you and you ask them, you have both
 * said yes, and making one of you click Accept on a request you just
 * duplicated would be theatre.
 */
export async function sendFriendRequest(
  requesterId: string,
  rawUsername: string
): Promise<SendRequestResult> {
  const username = normalizeUsername(rawUsername);

  const [target] = await db
    .select(publicColumns)
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!target) {
    return {
      ok: false,
      reason: "not_found",
      message: `No user called "${username}".`,
    };
  }
  if (target.id === requesterId) {
    return { ok: false, reason: "self", message: "You can't add yourself." };
  }

  const summary = toSummary(target);
  const existing = await loadEdge(requesterId, target.id);

  if (existing?.status === "accepted") {
    return {
      ok: false,
      reason: "already_friends",
      message: `You're already friends with ${summary.username}.`,
    };
  }

  if (existing?.status === "pending") {
    if (existing.requesterId === requesterId) {
      return {
        ok: false,
        reason: "already_sent",
        message: `You've already asked ${summary.username}.`,
      };
    }
    // They asked first — this is the crossing-requests case.
    await db
      .update(friendships)
      .set({ status: "accepted", respondedAt: new Date() })
      .where(
        and(
          eq(friendships.requesterId, target.id),
          eq(friendships.addresseeId, requesterId)
        )
      );
    return { ok: true, outcome: "accepted", target: summary };
  }

  await db
    .insert(friendships)
    .values({ requesterId, addresseeId: target.id, status: "pending" })
    // Two clicks landing at once would otherwise be a 23505 surfaced as a
    // 500. The row that exists is the row that was wanted, so this is a
    // success either way.
    .onConflictDoNothing();

  return { ok: true, outcome: "sent", target: summary };
}

/**
 * Answers a request that was sent *to* this user.
 *
 * Declining deletes the row rather than recording the refusal: a kept "no"
 * would silently block the sender from ever asking again, which is not what
 * declining a friend request is understood to mean.
 */
export async function respondToFriendRequest(
  userId: string,
  requesterId: string,
  accept: boolean
): Promise<boolean> {
  const where = and(
    eq(friendships.requesterId, requesterId),
    eq(friendships.addresseeId, userId),
    eq(friendships.status, "pending")
  );

  if (!accept) {
    const deleted = await db.delete(friendships).where(where).returning({
      requesterId: friendships.requesterId,
    });
    return deleted.length > 0;
  }

  const updated = await db
    .update(friendships)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(where)
    .returning({ requesterId: friendships.requesterId });

  return updated.length > 0;
}

/** Withdraws a request this user sent. Only ever touches a pending row. */
export async function cancelFriendRequest(
  userId: string,
  addresseeId: string
): Promise<boolean> {
  const deleted = await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.requesterId, userId),
        eq(friendships.addresseeId, addresseeId),
        eq(friendships.status, "pending")
      )
    )
    .returning({ requesterId: friendships.requesterId });

  return deleted.length > 0;
}

/** Ends a friendship from either side. */
export async function removeFriend(userId: string, otherId: string): Promise<boolean> {
  const deleted = await db
    .delete(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, otherId)),
          and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, userId))
        )
      )
    )
    .returning({ requesterId: friendships.requesterId });

  return deleted.length > 0;
}
