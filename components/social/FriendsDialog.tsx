"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Inbox, Search, Send, UserPlus, UserX, X } from "lucide-react";
import { useSocial } from "@/hooks/useSocial";
import { UserAvatar } from "@/components/social/UserAvatar";
import { Spinner } from "@/components/Spinner";
import type { SearchResult } from "@/lib/socialEvents";

// Search at the top, then the two request queues as tabs. The search is
// outside the tabs on purpose: adding someone is what people open this for,
// and burying it as a third tab would make the common case a click deeper
// than the two things you do occasionally.

type Tab = "incoming" | "outgoing" | "friends";

// Long enough that typing a username doesn't fire a request per keystroke,
// short enough that the results feel like they're following you.
const SEARCH_DEBOUNCE_MS = 250;

interface FriendsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Unmounts entirely when closed, rather than hiding a mounted tree.
 *
 * That's what resets the search, the error and the in-flight rows between
 * openings — the alternative is an effect that clears half a dozen pieces of
 * state on the way out, which has to be kept in step with every new piece.
 */
export function FriendsDialog({ open, onClose }: FriendsDialogProps) {
  if (!open) return null;
  return <FriendsDialogBody onClose={onClose} />;
}

function FriendsDialogBody({ onClose }: { onClose: () => void }) {
  const {
    friends,
    incoming,
    outgoing,
    sendRequest,
    respondToRequest,
    cancelRequest,
    unfriend,
  } = useSocial();

  // Opens on whichever tab has something waiting: someone opening this with a
  // request pending is nearly always opening it *because* of the request.
  // An initial value rather than an effect, so the tab can't be yanked out
  // from under a click when a request arrives while the dialog is open.
  const [tab, setTab] = useState<Tab>(() =>
    incoming.length > 0 ? "incoming" : "friends"
  );
  const [query, setQuery] = useState("");
  // Results carry the query they answer, which is what makes "still
  // searching" derivable — and lets the previous results stay on screen while
  // the next ones load, instead of the list emptying on every keystroke.
  const [search, setSearch] = useState<{ query: string; results: SearchResult[] }>({
    query: "",
    results: [],
  });
  const [error, setError] = useState<string | null>(null);
  // Keyed by the user id being acted on, so two rows can be in flight at once
  // and neither spins on the other's button.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const withBusy = useCallback(
    async (userId: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy((prev) => ({ ...prev, [userId]: true }));
      setError(null);
      const result = await action();
      setBusy((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      if (!result.ok && result.error) setError(result.error);
      return result;
    },
    []
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // --- Search ---

  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;
  // The results on screen answer `search.query`; anything else means a
  // request is in flight for what's currently typed.
  const searching = searchable && search.query !== trimmed;
  const results = search.results;

  useEffect(() => {
    const current = query.trim();
    if (current.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/search?q=${encodeURIComponent(current)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setSearch({ query: current, results: data.results ?? [] });
      } catch {
        // Leave the previous results up; the next keystroke retries.
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Re-runs the current search after a request is sent, so the row's button
  // becomes "Requested" instead of staying on "Add" until the next keystroke.
  const refreshSearch = useCallback(async () => {
    const current = query.trim();
    if (current.length < 2) return;
    try {
      const res = await fetch(`/api/friends/search?q=${encodeURIComponent(current)}`);
      if (res.ok) {
        setSearch({ query: current, results: (await res.json()).results ?? [] });
      }
    } catch {
      // Cosmetic — the graph underneath is already right.
    }
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: { id: Tab; label: string; icon: typeof Inbox; count: number }[] = [
    { id: "incoming", label: "Requests", icon: Inbox, count: incoming.length },
    { id: "outgoing", label: "Sent", icon: Send, count: outgoing.length },
    { id: "friends", label: "Friends", icon: UserPlus, count: friends.length },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/70 p-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Friends"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium text-ink">Friends</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 focus-within:border-line-strong">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username or name"
              aria-label="Search for people"
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-transparent py-2 text-sm text-ink outline-none placeholder:text-faint"
            />
            {searching && <Spinner className="h-3.5 w-3.5 shrink-0 text-faint" />}
            {query && !searching && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 text-faint transition hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {searchable && (
            <div className="mt-2.5 max-h-56 overflow-y-auto">
              {results.length === 0 && !searching ? (
                <p className="py-3 text-center text-xs text-muted">
                  Nobody matching &ldquo;{trimmed}&rdquo;.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {results.map((person) => (
                    <li
                      key={person.userId}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-elevated"
                    >
                      <UserAvatar
                        src={person.imageUrl}
                        name={person.name}
                        className="h-8 w-8"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{person.name}</p>
                        <p className="truncate text-xs text-muted">
                          @{person.username}
                        </p>
                      </div>
                      <SearchAction
                        person={person}
                        busy={busy[person.userId] === true}
                        onAdd={async () => {
                          const result = await withBusy(person.userId, () =>
                            sendRequest(person.username ?? "")
                          );
                          if (result.ok) await refreshSearch();
                        }}
                        onAccept={async () => {
                          const result = await withBusy(person.userId, () =>
                            respondToRequest(person.userId, true)
                          );
                          if (result.ok) await refreshSearch();
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-line px-3 py-2">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "true" : undefined}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                tab === id
                  ? "bg-elevated text-ink"
                  : "text-muted hover:bg-elevated hover:text-ink-soft"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    id === "incoming" && count > 0
                      ? "bg-accent text-on-accent"
                      : "bg-line text-ink-soft"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="border-b border-danger-line bg-danger-soft px-5 py-2 text-xs text-danger"
          >
            {error}
          </p>
        )}

        {/* Lists */}
        <div className="min-h-[9rem] flex-1 overflow-y-auto px-3 py-2">
          {tab === "incoming" && (
            <PeopleList
              people={incoming}
              empty="No friend requests waiting."
              render={(person) => (
                <>
                  <button
                    onClick={() =>
                      withBusy(person.userId, () => respondToRequest(person.userId, true))
                    }
                    disabled={busy[person.userId]}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {busy[person.userId] ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Accept
                  </button>
                  <button
                    onClick={() =>
                      withBusy(person.userId, () => respondToRequest(person.userId, false))
                    }
                    disabled={busy[person.userId]}
                    aria-label={`Decline ${person.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            />
          )}

          {tab === "outgoing" && (
            <PeopleList
              people={outgoing}
              empty="You haven't sent any requests."
              render={(person) => (
                <button
                  onClick={() => withBusy(person.userId, () => cancelRequest(person.userId))}
                  disabled={busy[person.userId]}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-danger-line hover:text-danger disabled:opacity-60"
                >
                  {busy[person.userId] ? <Spinner className="h-3 w-3" /> : null}
                  Withdraw
                </button>
              )}
            />
          )}

          {tab === "friends" && (
            <PeopleList
              people={friends}
              empty="No friends yet — search for someone above."
              showPresence
              render={(person) => (
                <button
                  onClick={() => withBusy(person.userId, () => unfriend(person.userId))}
                  disabled={busy[person.userId]}
                  aria-label={`Remove ${person.name}`}
                  title="Remove friend"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-60"
                >
                  {busy[person.userId] ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <UserX className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The button a search row gets, which is entirely decided by how the viewer
// already stands with that person. Rendering all four states here keeps the
// row markup above from growing a ladder of conditionals.
function SearchAction({
  person,
  busy,
  onAdd,
  onAccept,
}: {
  person: SearchResult;
  busy: boolean;
  onAdd: () => void;
  onAccept: () => void;
}) {
  if (person.relationship === "friends") {
    return <span className="shrink-0 text-xs text-muted">Friends</span>;
  }
  if (person.relationship === "outgoing_pending") {
    return <span className="shrink-0 text-xs text-muted">Requested</span>;
  }
  if (person.relationship === "incoming_pending") {
    return (
      <button
        onClick={onAccept}
        disabled={busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}
        Accept
      </button>
    );
  }

  return (
    <button
      onClick={onAdd}
      disabled={busy}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:bg-elevated disabled:opacity-60"
    >
      {busy ? <Spinner className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
      Add
    </button>
  );
}

// The three tabs are the same row with different buttons on the right, so the
// row is written once and the buttons are passed in.
interface Person {
  userId: string;
  username: string | null;
  name: string;
  imageUrl: string;
  online?: boolean;
}

function PeopleList({
  people,
  empty,
  render,
  showPresence = false,
}: {
  people: Person[];
  empty: string;
  render: (person: Person) => React.ReactNode;
  showPresence?: boolean;
}) {
  if (people.length === 0) {
    return (
      <p className="flex h-full min-h-[8rem] items-center justify-center px-6 text-center text-xs text-muted">
        {empty}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {people.map((person) => (
        <li
          key={person.userId}
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-elevated"
        >
          <UserAvatar
            src={person.imageUrl}
            name={person.name}
            className="h-8 w-8"
            online={showPresence ? person.online === true : undefined}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{person.name}</p>
            <p className="truncate text-xs text-muted">@{person.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">{render(person)}</div>
        </li>
      ))}
    </ul>
  );
}
