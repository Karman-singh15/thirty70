import { describe, expect, it } from "vitest";
import { parseProblemUpdate } from "@/lib/roomProblemPayload";

const problem = {
  titleSlug: "two-sum",
  title: "Two Sum",
  difficulty: "Easy",
  frontendQuestionId: "1",
};

describe("parseProblemUpdate — accepts a real selection", () => {
  it("passes a well-formed body through", () => {
    const out = parseProblemUpdate({ problem, code: "function f(){}", language: "python" });
    expect(out).toEqual({
      problem,
      starterCode: "function f(){}",
      starterLanguage: "python",
    });
  });

  it("keeps the route's existing defaults", () => {
    const out = parseProblemUpdate({ problem });
    expect(out?.starterCode).toBe("");
    expect(out?.starterLanguage).toBe("javascript");
  });

  it("accepts multi-word slugs", () => {
    const out = parseProblemUpdate({
      problem: { ...problem, titleSlug: "longest-substring-without-repeating-characters" },
    });
    expect(out).not.toBeNull();
  });
});

describe("parseProblemUpdate — rejects malformed input", () => {
  it("rejects non-objects", () => {
    for (const body of [null, undefined, "x", 3, []]) {
      expect(parseProblemUpdate(body)).toBeNull();
    }
  });

  it("rejects a missing problem", () => {
    expect(parseProblemUpdate({ code: "x" })).toBeNull();
  });

  it("rejects an unknown difficulty", () => {
    expect(parseProblemUpdate({ problem: { ...problem, difficulty: "Impossible" } })).toBeNull();
  });

  it("rejects a missing field", () => {
    expect(parseProblemUpdate({ problem: { ...problem, title: "" } })).toBeNull();
    expect(parseProblemUpdate({ problem: { ...problem, frontendQuestionId: "" } })).toBeNull();
  });

  it("rejects a non-string field", () => {
    expect(parseProblemUpdate({ problem: { ...problem, title: 42 } })).toBeNull();
  });

  // titleSlug becomes a primary key and a path segment every client fetches.
  it("rejects slugs that aren't slug-shaped", () => {
    for (const slug of ["../etc/passwd", "Two Sum", "two_sum", "two-sum/", "-two-sum", "two--sum"]) {
      expect(parseProblemUpdate({ problem: { ...problem, titleSlug: slug } })).toBeNull();
    }
  });

  it("rejects unbounded strings", () => {
    expect(
      parseProblemUpdate({ problem: { ...problem, title: "x".repeat(301) } })
    ).toBeNull();
    expect(
      parseProblemUpdate({ problem: { ...problem, titleSlug: "a".repeat(201) } })
    ).toBeNull();
  });
});

describe("parseProblemUpdate — falls back rather than writing junk through", () => {
  it("ignores an unknown language", () => {
    // The language decides which LeetCode judge a Run/Submit goes to, so an
    // unrecognised one must not reach the room.
    expect(parseProblemUpdate({ problem, language: "brainfuck" })?.starterLanguage).toBe(
      "javascript"
    );
  });

  it("drops oversized starter code instead of rejecting the pick", () => {
    const out = parseProblemUpdate({ problem, code: "x".repeat(20_001) });
    expect(out).not.toBeNull();
    expect(out?.starterCode).toBe("");
  });
});
