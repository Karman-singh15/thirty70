// Wire types for everything that reaches a signed-in user outside of a room:
// friends, friend requests, and room invites. Kept free of any runtime
// dependency — same reason as lib/editorDoc.ts — so components can import it
// without dragging Postgres or the Redis client into the browser bundle.

/** The public face of an account: what one user is allowed to see of another. */
export interface UserSummary {
  userId: string;
  /** Null only for an account that hasn't picked one yet, which can't be searched for. */
  username: string | null;
  name: string;
  imageUrl: string;
}

/** A friend, plus whether they're reachable right now. */
export type Friend = UserSummary & {
  online: boolean;
  friendsSince: number;
};

/** A request in either direction. `user` is always the *other* person. */
export type FriendRequest = UserSummary & {
  sentAt: number;
};

/**
 * How the viewer stands with a person in search results — what decides
 * whether the row offers "Add", "Requested", "Accept", or nothing at all.
 */
export type RelationshipStatus =
  | "none"
  | "friends"
  | "outgoing_pending"
  | "incoming_pending"
  | "self";

export type SearchResult = UserSummary & {
  relationship: RelationshipStatus;
};

/**
 * An invitation to a room someone is already sitting in. Carries everything
 * needed to draw the card and act on it, because the receiver has no other
 * way to read a room they aren't a member of yet — `inviteCode` is what the
 * Join button posts to the existing /api/rooms/join.
 */
export interface RoomInvite {
  id: string;
  roomId: string;
  roomName: string;
  inviteCode: string;
  from: UserSummary;
  problemTitle: string | null;
  createdAt: number;
}

/**
 * Pushed down the per-user stream. Every one of these is a *nudge* rather
 * than a patch: the client refetches the list it names instead of trying to
 * splice a payload into local state. Deliberate — a friend list is small and
 * read rarely, and a missed or out-of-order event then costs nothing, where
 * incremental patching would leave the two sides quietly disagreeing.
 *
 * `invite` is the exception: it carries its payload, because an invite that
 * arrives while you're looking at the dashboard should appear in that moment,
 * and it's the one event where a round trip would be visible.
 */
export type SocialEvent =
  // Friends, incoming requests or outgoing requests changed — refetch.
  | { type: "friends" }
  // A friend came online or went offline. Same refetch, kept distinct so the
  // client can tell "the list changed" from "a dot changed".
  | { type: "presence"; userId: string; online: boolean }
  | { type: "invite"; invite: RoomInvite }
  // An invite is no longer actionable — its room filled up, closed, or the
  // receiver accepted it in another tab.
  | { type: "invite_revoked"; inviteId: string }
  // Sent to the *sender* when their invite stops being outstanding, because
  // the person answered it one way or the other. Deliberately doesn't say
  // which way: the sender's button only needs to know it can be pressed
  // again, and "Priya declined you" is not something to put on a screen.
  //
  // Accepting is already visible without this — joining puts them in the
  // participant list, which removes them from the invitable list entirely.
  // This is what covers declining, and re-arms the button for someone who
  // accepted and has since left again.
  | { type: "invite_resolved"; roomId: string; userId: string }
  // Keep-alive. Carries nothing; exists so a quiet connection still writes
  // bytes and neither the browser nor an intermediary proxy calls it dead.
  | { type: "ping" };
