import { describe, expect, it } from "vitest";
import { parseJudgeBroadcast } from "@/lib/judgePayload";

const USER = "user_123";

function runResult(overrides: Record<string, unknown> = {}) {
  return {
    // The inner result carries its own mode, and parseResult requires it to
    // agree with the broadcast's — JudgePanel picks its renderer from it.
    mode: "run",
    status: "Accepted",
    totalCorrect: 3,
    totalTestcases: 3,
    cases: [{ index: 0, passed: true, actual: "1", expected: "1" }],
    compileError: null,
    runtimeError: null,
    ...overrides,
  };
}

describe("parseJudgeBroadcast — accepts well-formed payloads", () => {
  it("accepts a loading stage", () => {
    expect(
      parseJudgeBroadcast({ status: "loading", mode: "run", stage: "running", name: "Priya" }, USER)
    ).toEqual({ status: "loading", mode: "run", stage: "running", userId: USER, name: "Priya" });
  });

  it("accepts an error", () => {
    expect(
      parseJudgeBroadcast({ status: "error", mode: "submit", message: "no session", name: "Ada" }, USER)
    ).toEqual({ status: "error", mode: "submit", message: "no session", userId: USER, name: "Ada" });
  });

  it("accepts a run result and keeps its cases", () => {
    const parsed = parseJudgeBroadcast(
      { status: "result", mode: "run", name: "Ada", result: runResult() },
      USER
    );
    expect(parsed?.status).toBe("result");
    expect(parsed && "result" in parsed && parsed.result.mode).toBe("run");
  });
});

describe("parseJudgeBroadcast — the actor cannot be spoofed", () => {
  // The whole point of taking userId from the session: a member could
  // otherwise broadcast a result under someone else's identity.
  it("ignores a userId in the body and uses the session's", () => {
    const parsed = parseJudgeBroadcast(
      { status: "loading", mode: "run", stage: "opening", name: "Ada", userId: "someone_else" },
      USER
    );
    expect(parsed?.userId).toBe(USER);
  });
});

describe("parseJudgeBroadcast — rejects what would crash another client", () => {
  // The original bug: `cases` was cast, not checked, so a non-array reached
  // JudgePanel's .map() in every *other* browser in the room.
  it("rejects a non-array `cases`", () => {
    expect(
      parseJudgeBroadcast(
        { status: "result", mode: "run", name: "Ada", result: runResult({ cases: "boom" }) },
        USER
      )
    ).toBeNull();
  });

  it("rejects a malformed entry inside `cases`", () => {
    expect(
      parseJudgeBroadcast(
        {
          status: "result",
          mode: "run",
          name: "Ada",
          result: runResult({ cases: [{ index: 0, passed: "yes", actual: "1", expected: "1" }] }),
        },
        USER
      )
    ).toBeNull();
  });

  it("rejects more than MAX_CASES entries", () => {
    const cases = Array.from({ length: 101 }, (_, i) => ({
      index: i, passed: true, actual: "1", expected: "1",
    }));
    expect(
      parseJudgeBroadcast(
        { status: "result", mode: "run", name: "Ada", result: runResult({ cases }) },
        USER
      )
    ).toBeNull();
  });

  it("rejects an over-long string", () => {
    expect(
      parseJudgeBroadcast(
        { status: "error", mode: "run", message: "x".repeat(10_001), name: "Ada" },
        USER
      )
    ).toBeNull();
  });

  it("rejects an unknown stage", () => {
    expect(
      parseJudgeBroadcast({ status: "loading", mode: "run", stage: "hacking", name: "Ada" }, USER)
    ).toBeNull();
  });

  it("rejects an unknown mode", () => {
    expect(
      parseJudgeBroadcast({ status: "loading", mode: "delete", stage: "running", name: "Ada" }, USER)
    ).toBeNull();
  });

  it("rejects an unknown status", () => {
    expect(parseJudgeBroadcast({ status: "pending", mode: "run", name: "Ada" }, USER)).toBeNull();
  });

  it("rejects a missing or empty name", () => {
    expect(parseJudgeBroadcast({ status: "loading", mode: "run", stage: "running" }, USER)).toBeNull();
    expect(
      parseJudgeBroadcast({ status: "loading", mode: "run", stage: "running", name: "" }, USER)
    ).toBeNull();
  });

  it("rejects non-objects outright", () => {
    for (const input of [null, undefined, "string", 42, [], true]) {
      expect(parseJudgeBroadcast(input, USER)).toBeNull();
    }
  });

  it("rejects a result whose inner mode disagrees with the broadcast's", () => {
    expect(
      parseJudgeBroadcast(
        { status: "result", mode: "submit", name: "Ada", result: runResult() },
        USER
      )
    ).toBeNull();
  });

  it("rejects a numeric field arriving as a string", () => {
    expect(
      parseJudgeBroadcast(
        { status: "result", mode: "run", name: "Ada", result: runResult({ totalCorrect: "3" }) },
        USER
      )
    ).toBeNull();
  });
});
