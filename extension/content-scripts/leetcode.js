// Runs inside a hidden leetcode.com tab the background worker opened. Calls
// LeetCode's own (undocumented) run/submit endpoints as same-origin requests,
// so the browser attaches the user's existing LEETCODE_SESSION cookie —
// nothing sensitive is ever read out or sent to LeetDuel's servers.

const POLL_INTERVAL_MS = 1000;
const POLL_MAX_ATTEMPTS = 30;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "execute") return;

  handleExecute(message.mode, message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: errorMessage(err) }));

  return true; // keep the channel open for the async response above
});

async function handleExecute(mode, payload) {
  const { slug, questionId, langSlug, code, dataInput } = payload;

  const path =
    mode === "run" ? `/problems/${slug}/interpret_solution/` : `/problems/${slug}/submit/`;

  const body =
    mode === "run"
      ? { lang: langSlug, question_id: questionId, typed_code: code, data_input: dataInput ?? "" }
      : { lang: langSlug, question_id: questionId, typed_code: code };

  const submitRes = await leetcodePost(path, body);
  const jobId = submitRes.interpret_id ?? submitRes.submission_id;
  if (!jobId) {
    throw new Error("LeetCode didn't return a job id — you may need to log in again.");
  }

  const raw = await pollUntilDone(jobId);
  return normalizeResult(mode, raw);
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function leetcodePost(path, body) {
  const csrftoken = getCookie("csrftoken");
  if (!csrftoken) {
    throw new Error("You're not logged into LeetCode in this browser — log in and try again.");
  }

  const res = await fetch(`https://leetcode.com${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-csrftoken": csrftoken,
      Referer: location.href,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("LeetCode rejected the request — your session may have expired. Log in again.");
  }
  if (!res.ok) {
    throw new Error(`LeetCode returned an unexpected status (${res.status}).`);
  }

  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

async function pollUntilDone(jobId) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`https://leetcode.com/submissions/detail/${jobId}/check/`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`LeetCode returned ${res.status} while checking the result.`);

    const data = await res.json();
    if (data.state === "SUCCESS") return data;
    if (data.state === "FAILURE" || data.state === "TIMEOUT") {
      throw new Error("LeetCode's judge couldn't process this submission — try again.");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for LeetCode's judge.");
}

function normalizeResult(mode, raw) {
  const compileError = raw.compile_error || raw.full_compile_error || null;
  const runtimeError = raw.runtime_error || raw.full_runtime_error || null;

  if (mode === "run") {
    const actual = raw.code_answer ?? [];
    const expected = raw.expected_code_answer ?? [];
    const compare = typeof raw.compare_result === "string" ? raw.compare_result.split("") : [];
    const total = raw.total_testcases ?? actual.length;

    const cases = Array.from({ length: total }, (_, i) => ({
      index: i,
      passed: compare[i] === "1",
      actual: actual[i] ?? "",
      expected: expected[i] ?? "",
    }));

    return {
      mode,
      status: compileError ? "Compile Error" : runtimeError ? "Runtime Error" : raw.status_msg ?? (raw.run_success ? "Passed" : "Failed"),
      totalCorrect: raw.total_correct ?? cases.filter((c) => c.passed).length,
      totalTestcases: total,
      cases,
      compileError,
      runtimeError,
    };
  }

  const accepted = raw.status_msg === "Accepted";
  // On anything but Accepted, LeetCode's check response carries the first
  // failing hidden case — the input, what our code produced, and what was
  // expected. Absent on Accepted (nothing failed) and on compile/runtime
  // errors (no case ran far enough to compare).
  const failingCase =
    !accepted && !compileError && !runtimeError
      ? {
          input: raw.input_formatted ?? raw.input ?? raw.last_testcase ?? "",
          actual: raw.code_output ?? "",
          expected: raw.expected_output ?? "",
        }
      : null;

  return {
    mode,
    status: raw.status_msg ?? "Unknown",
    accepted,
    totalCorrect: raw.total_correct ?? null,
    totalTestcases: raw.total_testcases ?? null,
    runtime: raw.status_runtime ?? null,
    memory: raw.status_memory ?? null,
    runtimePercentile: raw.runtime_percentile ?? null,
    memoryPercentile: raw.memory_percentile ?? null,
    compileError,
    runtimeError,
    failingCase,
  };
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
