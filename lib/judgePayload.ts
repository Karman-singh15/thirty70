// Validation for the judge broadcast payload.
//
// Extracted from app/api/rooms/[id]/judge/route.ts so it can be tested
// directly: this is the one payload in the app that one client authors and
// every *other* client renders, so a bad shape here doesn't fail on the
// sender — it throws inside someone else's render and takes their room page
// down mid-turn. That failure mode is exactly what tests are for.

import type { JudgeBroadcast } from "@/lib/editorDoc";
import type {
  JudgeResult,
  JudgeRunResult,
  JudgeStage,
  JudgeSubmitResult,
  JudgeTestCase,
} from "@/lib/leetcodeBridge";

// Everything below is validated field by field rather than cast. What arrives
// here is a client-authored object that this route then hands to *every other
// client in the room*, where JudgePanel renders it directly — so a `cases`
// that isn't an array, or a `message` that isn't a string, doesn't fail on
// the sender, it throws inside someone else's render and takes their whole
// room page down. The sizes are capped for the same reason: this is a
// broadcast path, and nothing about it should let one member push an
// arbitrarily large payload at everyone.

const VALID_STAGES = new Set<JudgeStage>(["opening", "running", "submitting"]);

const MAX_TEXT = 10_000; // any single status/error/testcase string
const MAX_CASES = 100;

function str(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_TEXT;
}
function nullableStr(v: unknown): v is string | null {
  return v === null || str(v);
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function nullableNum(v: unknown): v is number | null {
  return v === null || num(v);
}
function obj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseTestCase(input: unknown): JudgeTestCase | null {
  if (!obj(input)) return null;
  const { index, passed, actual, expected } = input;
  if (!num(index) || typeof passed !== "boolean" || !str(actual) || !str(expected)) {
    return null;
  }
  return { index, passed, actual, expected };
}

function parseRunResult(input: Record<string, unknown>): JudgeRunResult | null {
  const { status, totalCorrect, totalTestcases, cases, compileError, runtimeError } = input;
  if (
    !str(status) ||
    !num(totalCorrect) ||
    !num(totalTestcases) ||
    !Array.isArray(cases) ||
    cases.length > MAX_CASES ||
    !nullableStr(compileError) ||
    !nullableStr(runtimeError)
  ) {
    return null;
  }

  const parsedCases: JudgeTestCase[] = [];
  for (const raw of cases) {
    const parsed = parseTestCase(raw);
    if (!parsed) return null;
    parsedCases.push(parsed);
  }

  return {
    mode: "run",
    status,
    totalCorrect,
    totalTestcases,
    cases: parsedCases,
    compileError,
    runtimeError,
  };
}

function parseFailingCase(input: unknown): JudgeSubmitResult["failingCase"] | null | false {
  if (input === null || input === undefined) return null;
  if (!obj(input)) return false;
  const { input: caseInput, actual, expected } = input;
  if (!str(caseInput) || !str(actual) || !str(expected)) return false;
  return { input: caseInput, actual, expected };
}

function parseSubmitResult(input: Record<string, unknown>): JudgeSubmitResult | null {
  const {
    status,
    accepted,
    totalCorrect,
    totalTestcases,
    runtime,
    memory,
    runtimePercentile,
    memoryPercentile,
    compileError,
    runtimeError,
  } = input;

  if (
    !str(status) ||
    typeof accepted !== "boolean" ||
    !nullableNum(totalCorrect) ||
    !nullableNum(totalTestcases) ||
    !nullableStr(runtime) ||
    !nullableStr(memory) ||
    !nullableNum(runtimePercentile) ||
    !nullableNum(memoryPercentile) ||
    !nullableStr(compileError) ||
    !nullableStr(runtimeError)
  ) {
    return null;
  }

  const failingCase = parseFailingCase(input.failingCase);
  if (failingCase === false) return null;

  return {
    mode: "submit",
    status,
    accepted,
    totalCorrect,
    totalTestcases,
    runtime,
    memory,
    runtimePercentile,
    memoryPercentile,
    compileError,
    runtimeError,
    failingCase,
  };
}

function parseResult(input: unknown, mode: "run" | "submit"): JudgeResult | null {
  if (!obj(input)) return null;
  // The result's own mode has to agree with the broadcast's, since JudgePanel
  // picks which renderer to use from the inner one.
  if (input.mode !== mode) return null;
  return mode === "run" ? parseRunResult(input) : parseSubmitResult(input);
}

// Rebuilt from scratch rather than passed through, so only the fields checked
// above are ever published.
export function parseJudgeBroadcast(input: unknown, userId: string): JudgeBroadcast | null {
  if (!obj(input)) return null;
  const { status, mode, name } = input;

  if (mode !== "run" && mode !== "submit") return null;
  if (!str(name) || name.length === 0) return null;
  // The actor is taken from the session, never from the body — otherwise any
  // member could broadcast under someone else's id.
  const actor = { userId, name };

  if (status === "loading") {
    if (!VALID_STAGES.has(input.stage as JudgeStage)) return null;
    return { status: "loading", mode, stage: input.stage as JudgeStage, ...actor };
  }

  if (status === "error") {
    if (!str(input.message)) return null;
    return { status: "error", mode, message: input.message, ...actor };
  }

  if (status === "result") {
    const result = parseResult(input.result, mode);
    if (!result) return null;
    return { status: "result", mode, result, ...actor };
  }

  return null;
}
