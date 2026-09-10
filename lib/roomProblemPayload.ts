import { LEETCODE_LANG_SLUGS } from "@/lib/leetcode";
import type { RoomProblem } from "@/lib/rooms";

// Validation for `PATCH /api/rooms/[id]/sync` — picking the room's problem.
//
// This was the last input path in the app still taking a client object on
// trust: the route checked `if (!body.problem)` and passed the rest straight
// to a Postgres write. The judge and editor routes are validated field by
// field, and an inconsistency like that is the kind of thing that gets copied
// into the next route someone writes.
//
// The impact was never dramatic — the values are parameterised, so no
// injection, and they render as text — but a host could write unbounded
// strings into the shared `problems` table, and `titleSlug` becomes both a
// primary key and a path segment every client fetches, which is worth pinning
// down.

// Generous versus what LeetCode actually produces, tight versus unbounded.
const MAX_SLUG = 200;
const MAX_TITLE = 300;
const MAX_QUESTION_ID = 20;
// The starter code is a snippet for one function, not a file.
const MAX_STARTER_CODE = 20_000;

const DIFFICULTIES = new Set(["Easy", "Medium", "Hard"]);

// LeetCode slugs are lowercase words joined by hyphens. Pinning the shape
// matters because this value is interpolated into `/api/leetcode/problem/<slug>`
// by every client in the room.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function str(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export interface ParsedProblemUpdate {
  problem: RoomProblem;
  starterCode: string;
  starterLanguage: string;
}

/**
 * Returns null when the body isn't a well-formed problem selection, so the
 * route can answer 400 without having touched the database.
 */
export function parseProblemUpdate(body: unknown): ParsedProblemUpdate | null {
  if (!body || typeof body !== "object") return null;
  const { problem, code, language } = body as Record<string, unknown>;

  if (!problem || typeof problem !== "object") return null;
  const { titleSlug, title, difficulty, frontendQuestionId } = problem as Record<
    string,
    unknown
  >;

  if (!str(titleSlug, MAX_SLUG) || !SLUG_PATTERN.test(titleSlug)) return null;
  if (!str(title, MAX_TITLE)) return null;
  if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty)) return null;
  if (!str(frontendQuestionId, MAX_QUESTION_ID)) return null;

  // Both of these already had defaults in the route; they keep them, but an
  // unknown language now falls back rather than being written through, since
  // the language drives which judge a Run/Submit goes to.
  const starterCode =
    typeof code === "string" && code.length <= MAX_STARTER_CODE ? code : "";
  const starterLanguage =
    typeof language === "string" && language in LEETCODE_LANG_SLUGS
      ? language
      : "javascript";

  return {
    problem: { titleSlug, title, difficulty, frontendQuestionId },
    starterCode,
    starterLanguage,
  };
}
