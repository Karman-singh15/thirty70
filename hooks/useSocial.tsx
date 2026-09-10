"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@clerk/nextjs";
import type {
  Friend,
  FriendRequest,
  RoomInvite,
  SocialEvent,
} from "@/lib/socialEvents";

// Everything about the signed-in user that isn't a room: their handle, their
// friends, the requests either way, the invites waiting for them — and the
// one connection all of it arrives on.
//
// A context rather than a hook per component because there is exactly one
// stream per tab and several places want to read from it: the sidebar badge,
// the friends dialog, the dashboard's invite cards and the room's invite
// dropdown. Each of them holding its own EventSource would mean four Redis
// subscriptions per tab and four copies of the list that could disagree.
//
// Mounted in the root layout, not the app layout, because /room/[id] sits
// outside the (app) group and its invite dropdown needs the friends list.

interface Profile {
  userId: string;
  username: string | null;
  name: string;
  imageUrl: string;
}

type ActionResult = { ok: true } | { ok: false; error: string };

interface SocialContextValue {
  profile: Profile | null;
  /** False until the first /api/me has come back — distinguishes "no username" from "don't know yet". */
  profileLoaded: boolean;
  /** Signed in, profile read, and no handle chosen. What the dialog watches. */
  needsUsername: boolean;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  invites: RoomInvite[];
  /**
   * Room invites *this* user has sent that are still outstanding, as
   * `roomId:userId`. Lives here rather than in the invite dropdown's own
   * state because only the stream knows when one stops being outstanding —
   * the dropdown showed "Sent" forever, leaving no way to ask again after
   * someone declined.
   *
   * Page-load scoped, not durable: it exists to keep one button honest, and
   * an invite the sender can no longer see is one they'll simply re-send.
   */
  sentInvites: ReadonlySet<string>;
  markInviteSent: (roomId: string, userId: string) => void;
  /** The stream is up. Drives the fallback poll below, not any UI. */
  connected: boolean;
  chooseUsername: (username: string) => Promise<ActionResult>;
  sendRequest: (username: string) => Promise<ActionResult & { outcome?: string }>;
  respondToRequest: (userId: string, accept: boolean) => Promise<ActionResult>;
  cancelRequest: (userId: string) => Promise<ActionResult>;
  unfriend: (userId: string) => Promise<ActionResult>;
  dismissInvite: (inviteId: string) => Promise<void>;
  refresh: () => void;
}

const SocialContext = createContext<SocialContextValue | null>(null);

const NO_FRIENDS: Friend[] = [];
const NO_REQUESTS: FriendRequest[] = [];
const NO_INVITES: RoomInvite[] = [];

// What the context holds while nobody is signed in. The actions are present
// but refuse, rather than absent: a component that renders for a signed-out
// visitor shouldn't have to branch on whether the function it was handed
// exists, and none of these can be reached from a page that doesn't require
// auth anyway.
const SIGNED_OUT: SocialContextValue = Object.freeze({
  profile: null,
  profileLoaded: false,
  needsUsername: false,
  friends: NO_FRIENDS,
  incoming: NO_REQUESTS,
  outgoing: NO_REQUESTS,
  invites: NO_INVITES,
  sentInvites: new Set<string>(),
  markInviteSent: () => {},
  connected: false,
  chooseUsername: async () => ({ ok: false as const, error: "Not signed in" }),
  sendRequest: async () => ({ ok: false as const, error: "Not signed in" }),
  respondToRequest: async () => ({ ok: false as const, error: "Not signed in" }),
  cancelRequest: async () => ({ ok: false as const, error: "Not signed in" }),
  unfriend: async () => ({ ok: false as const, error: "Not signed in" }),
  dismissInvite: async () => {},
  refresh: () => {},
});

// Only used when the stream is down. The steady state is push, so this is the
// degraded path — the same shape as the shared editor's fallback poll.
const FALLBACK_POLL_MS = 30_000;

// An outstanding invite is identified by the pair, not by either half: the
// same friend can be invited to a different room later, and the same room can
// have invites out to several people.
const inviteKey = (roomId: string, userId: string) => `${roomId}:${userId}`;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Mounts the live provider only while signed in.
 *
 * The switch is a mount rather than a flag threaded through every effect:
 * signing out then has to unwind exactly one thing — the subtree — and every
 * piece of state, the EventSource included, goes with it. The alternative
 * (clearing each list when a flag flips) leaves a window where the previous
 * account's friends are still in state while the new account's fetch is in
 * flight, and needsUsername is computed from whichever won.
 */
export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded || !isSignedIn) {
    return <SocialContext.Provider value={SIGNED_OUT}>{children}</SocialContext.Provider>;
  }

  return <SignedInSocialProvider>{children}</SignedInSocialProvider>;
}

function SignedInSocialProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<ReadonlySet<string>>(new Set());
  const [connected, setConnected] = useState(false);

  // Bumped to force a re-read of the graph. An effect keyed on this rather
  // than a bare async function, so a burst of events (accepting a request
  // notifies both sides, and both land here) collapses into one fetch instead
  // of racing several whose responses can arrive out of order.
  const [graphNonce, setGraphNonce] = useState(0);
  const refresh = useCallback(() => setGraphNonce((n) => n + 1), []);

  // --- Profile ---

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProfile(data.profile ?? null);
      } catch {
        // Offline or a transient failure. The username dialog stays hidden
        // rather than appearing over a page we couldn't read — showing it
        // would ask someone to re-pick a handle they already have.
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Friends, requests, invites ---

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [graphRes, invitesRes] = await Promise.all([
          fetch("/api/friends"),
          fetch("/api/invites"),
        ]);
        if (cancelled) return;

        if (graphRes.ok) {
          const graph = await graphRes.json();
          if (!cancelled) {
            setFriends(graph.friends ?? []);
            setIncoming(graph.incoming ?? []);
            setOutgoing(graph.outgoing ?? []);
          }
        }
        if (invitesRes.ok) {
          const data = await invitesRes.json();
          if (!cancelled) setInvites(data.invites ?? []);
        }
      } catch {
        // Keep whatever is on screen; the next event or poll re-reads.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphNonce]);

  // --- The stream ---

  // Held in a ref so the EventSource effect can stay keyed on nothing but the
  // signed-in flag. Keying it on the handler would tear down and rebuild the
  // connection — and its Redis subscription — on every state change.
  const handleEvent = useCallback((event: SocialEvent) => {
    switch (event.type) {
      case "friends":
        refresh();
        break;
      case "presence":
        // Patched in place rather than refetched: a friend opening a laptop
        // shouldn't cost a database read for everyone who knows them, and a
        // dot is the only thing that changes.
        setFriends((prev) =>
          prev.map((f) =>
            f.userId === event.userId ? { ...f, online: event.online } : f
          )
        );
        break;
      case "invite":
        setInvites((prev) =>
          // The server already collapses a repeat invite to the same room
          // onto one row; this guards the case where its push and the initial
          // fetch both land.
          prev.some((i) => i.id === event.invite.id)
            ? prev
            : [event.invite, ...prev]
        );
        break;
      case "invite_revoked":
        setInvites((prev) => prev.filter((i) => i.id !== event.inviteId));
        break;
      case "invite_resolved":
        // They answered — re-arm the sender's button for that person.
        setSentInvites((prev) => {
          const key = inviteKey(event.roomId, event.userId);
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        break;
      case "ping":
        break;
    }
  }, [refresh]);

  const handlerRef = useRef(handleEvent);
  useEffect(() => {
    handlerRef.current = handleEvent;
  }, [handleEvent]);

  useEffect(() => {
    // EventSource reconnects on its own after a drop, and the server writes
    // presence on every connect — so a reconnect is also a re-announcement,
    // and there's nothing extra to do here.
    const source = new EventSource("/api/me/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      try {
        handlerRef.current(JSON.parse(e.data) as SocialEvent);
      } catch {
        // Malformed frame — skip it; the next event or poll puts us right.
      }
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, []);

  // Tells the server this user is gone the moment the tab does, rather than
  // letting presence time out — a friend list that shows someone as available
  // for another 50 seconds is what gets an invite sent into an empty room.
  // sendBeacon is what makes this survive unload, where a fetch can be
  // cancelled before it reaches the network. `persisted` distinguishes a real
  // close from the page being frozen into the back/forward cache.
  //
  // Same shape as the room's departure beacon in hooks/useRoom.ts.
  useEffect(() => {
    const handler = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      // A body is required for the DELETE to be routed as a beacon; the route
      // reads the user from the session, not from this.
      navigator.sendBeacon?.("/api/me/stream", new Blob([], { type: "text/plain" }));
    };

    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, []);

  // Degraded mode: if the stream can't be established at all, fall back to
  // pulling. Slower, but a friend request still arrives without a reload.
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(refresh, FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [connected, refresh]);

  // --- Actions ---
  //
  // None of these patch local state on success: each one causes the server to
  // publish a "friends" event back to this very tab, which refreshes the
  // graph. One source of truth, and no window where an optimistic update and
  // the authoritative list disagree.

  const chooseUsername = useCallback(async (username: string): Promise<ActionResult> => {
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't save that username.") };
    }

    const data = await res.json();
    setProfile(data.profile ?? null);
    return { ok: true };
  }, []);

  const sendRequest = useCallback(async (username: string) => {
    const res = await fetch("/api/friends/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    if (!res.ok) {
      return { ok: false as const, error: await readError(res, "Couldn't send that request.") };
    }

    const data = await res.json();
    refresh();
    return { ok: true as const, outcome: data.outcome as string };
  }, [refresh]);

  const respondToRequest = useCallback(
    async (userId: string, accept: boolean): Promise<ActionResult> => {
      const res = await fetch("/api/friends/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: accept ? "accept" : "decline" }),
      });

      refresh();
      if (!res.ok) {
        return { ok: false, error: await readError(res, "Couldn't answer that request.") };
      }
      return { ok: true };
    },
    [refresh]
  );

  const cancelRequest = useCallback(async (userId: string): Promise<ActionResult> => {
    const res = await fetch("/api/friends/requests", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    refresh();
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't withdraw that request.") };
    }
    return { ok: true };
  }, [refresh]);

  const unfriend = useCallback(async (userId: string): Promise<ActionResult> => {
    const res = await fetch(`/api/friends/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });

    refresh();
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't remove that friend.") };
    }
    return { ok: true };
  }, [refresh]);

  const markInviteSent = useCallback((roomId: string, userId: string) => {
    setSentInvites((prev) => {
      const key = inviteKey(roomId, userId);
      if (prev.has(key)) return prev;
      return new Set(prev).add(key);
    });
  }, []);

  const dismissInvite = useCallback(async (inviteId: string) => {
    // Removed here first: this one is a dismissal, and a card that lingers
    // for a round trip after you've waved it away reads as a broken button.
    setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    await fetch("/api/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    }).catch(() => {
      // It'll expire on its own within the invite TTL.
    });
  }, []);

  const value = useMemo<SocialContextValue>(
    () => ({
      profile,
      profileLoaded,
      needsUsername: profileLoaded && profile !== null && !profile.username,
      friends,
      incoming,
      outgoing,
      invites,
      sentInvites,
      markInviteSent,
      connected,
      chooseUsername,
      sendRequest,
      respondToRequest,
      cancelRequest,
      unfriend,
      dismissInvite,
      refresh,
    }),
    [
      profile,
      profileLoaded,
      friends,
      incoming,
      outgoing,
      invites,
      sentInvites,
      markInviteSent,
      connected,
      chooseUsername,
      sendRequest,
      respondToRequest,
      cancelRequest,
      unfriend,
      dismissInvite,
      refresh,
    ]
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

/**
 * Throws outside the provider rather than returning null: every caller would
 * otherwise need a branch for a state that only happens if someone forgets to
 * mount it in the layout, and "friends silently never load" is a much worse
 * way to find that out than a stack trace.
 */
export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) {
    throw new Error("useSocial must be used inside <SocialProvider>");
  }
  return ctx;
}
