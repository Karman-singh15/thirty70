import { describe, expect, it, afterEach, vi } from "vitest";
import {
  isTurnExpired,
  nextInRotation,
  pickNextTurnHolder,
  type TurnClockState,
} from "@/lib/turnRotation";

const anyone = () => true;

describe("nextInRotation", () => {
  it("returns the entry after the given one", () => {
    expect(nextInRotation(["a", "b", "c"], "a", anyone)).toBe("b");
  });

  it("wraps around the end of the order", () => {
    expect(nextInRotation(["a", "b", "c"], "c", anyone)).toBe("a");
  });

  it("starts from the front when nobody holds the turn", () => {
    expect(nextInRotation(["a", "b", "c"], null, anyone)).toBe("a");
  });

  // This is the case that matters most: a player who just left has already
  // been spliced out of `order`, so `afterUserId` names someone who isn't in
  // it. indexOf returns -1 and the walk has to begin at the front rather than
  // skipping an entry or returning undefined.
  it("starts from the front when the holder is no longer in the order", () => {
    expect(nextInRotation(["a", "b", "c"], "gone", anyone)).toBe("a");
  });

  it("skips entries the predicate rejects", () => {
    const online = new Set(["c"]);
    expect(nextInRotation(["a", "b", "c"], "a", (id) => online.has(id))).toBe("c");
  });

  it("returns the holder itself when they are the only eligible entry", () => {
    const online = new Set(["b"]);
    expect(nextInRotation(["a", "b", "c"], "b", (id) => online.has(id))).toBe("b");
  });

  it("returns undefined when nothing is eligible", () => {
    expect(nextInRotation(["a", "b"], "a", () => false)).toBeUndefined();
  });

  it("returns undefined for an empty order rather than looping", () => {
    expect(nextInRotation([], null, anyone)).toBeUndefined();
  });

  it("visits every entry exactly once before giving up", () => {
    const seen: string[] = [];
    nextInRotation(["a", "b", "c"], "a", (id) => {
      seen.push(id);
      return false;
    });
    expect(seen).toEqual(["b", "c", "a"]);
  });
});

describe("pickNextTurnHolder", () => {
  it("skips offline players", () => {
    expect(pickNextTurnHolder(["a", "b", "c"], ["a", "c"], "a")).toBe("c");
  });

  it("gives the turn back to a lone online player instead of stalling", () => {
    expect(pickNextTurnHolder(["a", "b", "c"], ["b"], "b")).toBe("b");
  });

  // Better to hand the turn to someone absent than to leave the room with no
  // holder at all, which is unrecoverable without picking a new problem.
  it("falls back to the next entry when nobody is online", () => {
    expect(pickNextTurnHolder(["a", "b", "c"], [], "a")).toBe("b");
  });

  it("starts from the front when there is no current holder", () => {
    expect(pickNextTurnHolder(["a", "b", "c"], ["b", "c"], null)).toBe("b");
  });
});

describe("isTurnExpired", () => {
  const base: TurnClockState = {
    currentTurnUserId: "a",
    turnEndsAt: 1_000,
    turnPausedRemainingMs: null,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  function at(now: number) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  }

  it("is true once the deadline has passed", () => {
    at(1_001);
    expect(isTurnExpired(base)).toBe(true);
  });

  it("is true exactly on the deadline", () => {
    at(1_000);
    expect(isTurnExpired(base)).toBe(true);
  });

  it("is false before the deadline", () => {
    at(999);
    expect(isTurnExpired(base)).toBe(false);
  });

  // A paused turn parks its remainder and clears turnEndsAt. Both are checked
  // so that a state where only one of them was updated still reads as paused
  // rather than silently expiring someone's turn.
  it("is false while paused, even with a deadline in the past", () => {
    at(9_999);
    expect(
      isTurnExpired({ ...base, turnPausedRemainingMs: 30_000 })
    ).toBe(false);
  });

  it("is false when nobody holds the turn", () => {
    at(9_999);
    expect(isTurnExpired({ ...base, currentTurnUserId: null })).toBe(false);
  });

  it("is false when no deadline is set", () => {
    at(9_999);
    expect(isTurnExpired({ ...base, turnEndsAt: null })).toBe(false);
  });
});
