// Bridges LeetDuel (an externally_connectable web page) to a hidden LeetCode
// tab. LeetDuel never sees a LeetCode cookie or session token — the content
// script in content-scripts/leetcode.js makes same-origin requests from
// inside leetcode.com itself, so the browser attaches the user's own
// LeetCode session automatically.

const TAB_LOAD_TIMEOUT_MS = 20_000;
const CONTENT_SCRIPT_RETRY_ATTEMPTS = 8;
const CONTENT_SCRIPT_RETRY_DELAY_MS = 400;

chrome.runtime.onConnectExternal.addListener((port) => {
  port.onMessage.addListener((message) => {
    if (message?.type !== "run" && message?.type !== "submit") return;
    runJob(message, port).catch((err) => {
      safePost(port, { stage: "error", message: errorMessage(err) });
    });
  });
});

async function runJob(message, port) {
  const { type: mode, payload } = message;
  if (!payload?.slug || !payload?.questionId || !payload?.langSlug || typeof payload.code !== "string") {
    safePost(port, { stage: "error", message: "Missing problem or code details — try reloading the room." });
    return;
  }

  safePost(port, { stage: "opening" });

  const tab = await chrome.tabs.create({
    url: `https://leetcode.com/problems/${payload.slug}/`,
    active: false,
  });

  try {
    await waitForTabComplete(tab.id);
    safePost(port, { stage: mode === "run" ? "running" : "submitting" });

    const response = await sendWithRetry(tab.id, {
      type: "execute",
      mode,
      payload,
    });

    if (!response) {
      throw new Error("The LeetCode tab didn't respond — try again.");
    }
    if (!response.ok) {
      throw new Error(response.error || "LeetCode rejected the request.");
    }

    safePost(port, { stage: "done", result: response.result });
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The LeetCode page took too long to load."));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        cleanup();
        resolve();
      }
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// The tab reporting "complete" and its content script finishing registration
// aren't quite the same moment — a couple of quick retries covers the gap
// without needing a separate ready-ping handshake.
async function sendWithRetry(tabId, message) {
  let lastErr;
  for (let attempt = 0; attempt < CONTENT_SCRIPT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, CONTENT_SCRIPT_RETRY_DELAY_MS));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not reach the LeetCode page.");
}

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The website tab closed the port (navigated away, closed the tab) —
    // nothing left to report to.
  }
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
