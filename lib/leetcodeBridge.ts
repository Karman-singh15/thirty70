// Talks to the "LeetDuel LeetCode Bridge" browser extension (see /extension)
// over chrome.runtime.connect. The extension does the actual work in a
// hidden LeetCode tab using the user's own logged-in session — this module
// never sees a LeetCode cookie or credential, it only relays a code payload
// out and a graded result back.

export type JudgeMode = "run" | "submit";

export interface JudgeTestCase {
  index: number;
  passed: boolean;
  actual: string;
  expected: string;
}

export interface JudgeRunResult {
  mode: "run";
  status: string;
  totalCorrect: number;
  totalTestcases: number;
  cases: JudgeTestCase[];
  compileError: string | null;
  runtimeError: string | null;
}

export interface JudgeSubmitResult {
  mode: "submit";
  status: string;
  accepted: boolean;
  totalCorrect: number | null;
  totalTestcases: number | null;
  runtime: string | null;
  memory: string | null;
  runtimePercentile: number | null;
  memoryPercentile: number | null;
  compileError: string | null;
  runtimeError: string | null;
  // The first hidden case that failed, when the submission wasn't Accepted
  // and it got far enough to run (i.e. no compile/runtime error).
  failingCase: { input: string; actual: string; expected: string } | null;
}

export type JudgeResult = JudgeRunResult | JudgeSubmitResult;

export type JudgeStage = "opening" | "running" | "submitting";

export interface JudgePayload {
  slug: string;
  questionId: string;
  langSlug: string;
  code: string;
  // Only meaningful for "run" — LeetCode's exampleTestcases string.
  dataInput?: string;
}

export class LeetCodeExtensionError extends Error {}

interface BridgePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: BridgeMessage) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface BridgeChrome {
  runtime?: {
    connect(extensionId: string): BridgePort;
    lastError?: { message?: string };
  };
}

declare global {
  interface Window {
    chrome?: BridgeChrome;
  }
}

type BridgeMessage =
  | { stage: "opening" | "running" | "submitting" }
  | { stage: "done"; result: JudgeResult }
  | { stage: "error"; message: string };

function getExtensionId(): string | null {
  return process.env.NEXT_PUBLIC_LEETCODE_EXTENSION_ID ?? null;
}

export function runOnLeetCode(
  mode: JudgeMode,
  payload: JudgePayload,
  onStage: (stage: JudgeStage) => void
): Promise<JudgeResult> {
  const extensionId = getExtensionId();
  if (!extensionId) {
    return Promise.reject(
      new LeetCodeExtensionError(
        "The LeetCode extension isn't configured for this deployment yet."
      )
    );
  }

  const chromeRuntime = typeof window !== "undefined" ? window.chrome?.runtime : undefined;
  if (!chromeRuntime?.connect) {
    return Promise.reject(
      new LeetCodeExtensionError(
        "Install the LeetDuel LeetCode extension to use Run/Submit — see extension/README.md."
      )
    );
  }

  return new Promise((resolve, reject) => {
    let port: BridgePort;
    try {
      port = chromeRuntime.connect(extensionId);
    } catch {
      reject(new LeetCodeExtensionError("Couldn't reach the LeetDuel LeetCode extension."));
      return;
    }

    let settled = false;

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      reject(
        new LeetCodeExtensionError(
          chromeRuntime.lastError?.message ??
            "Lost the connection to the LeetDuel LeetCode extension."
        )
      );
    });

    port.onMessage.addListener((message) => {
      if (settled) return;
      if (message.stage === "error") {
        settled = true;
        reject(new LeetCodeExtensionError(message.message));
        port.disconnect();
        return;
      }
      if (message.stage === "done") {
        settled = true;
        resolve(message.result);
        port.disconnect();
        return;
      }
      onStage(message.stage);
    });

    port.postMessage({ type: mode, payload });
  });
}
