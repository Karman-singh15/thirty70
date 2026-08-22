# thirty70 LeetCode Bridge

A Chrome extension that lets Run/Submit on thirty70 execute against your own
logged-in LeetCode account, without you ever leaving thirty70's tab.

## How it works

1. thirty70's website sends a message to this extension (`chrome.runtime.connect`,
   allowed only because thirty70's origin is listed under `externally_connectable`
   in `manifest.json`).
2. The background service worker opens a **hidden** `leetcode.com/problems/...`
   tab (`active: false` — it never becomes visible or steals focus).
3. A content script running *inside that leetcode.com tab* calls LeetCode's own
   run/submit endpoints as same-origin requests. The browser attaches your
   existing `LEETCODE_SESSION` cookie automatically — this extension never
   reads, stores, or transmits it anywhere.
4. The result is relayed back to thirty70 and the hidden tab is closed.

Nothing here touches thirty70's servers or database. Your LeetCode
credentials stay entirely inside your own browser's cookie jar.

## Load it locally (unpacked)

`manifest.json` pins a `"key"` (its public half — the matching private key is
`extension_key.pem`, generated locally and gitignored, not something you need
to touch). That key is what fixes the extension's id at
`fogjpncajmojaednlndljobmielkjjdk` for *anyone* who loads this exact folder —
without it, Chrome derives the id from the install path instead, so every
person (and every machine) would get a different one, and a single shared
`NEXT_PUBLIC_LEETCODE_EXTENSION_ID` in thirty70's env wouldn't work for
everyone. Each teammate/participant still installs their own copy of the
extension (so Submit runs against *their* LeetCode account) — they just don't
need to look up or share an id to do it.

1. Go to `chrome://extensions`.
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and select this `extension/` folder.
4. Confirm the id on the card Chrome shows you is `fogjpncajmojaednlndljobmielkjjdk`
   — if thirty70's `NEXT_PUBLIC_LEETCODE_EXTENSION_ID` doesn't already match, update it.
5. After editing any file under `extension/`, hit the reload icon on this
   card — Chrome doesn't hot-reload content/background scripts.

You must be logged into leetcode.com in the same Chrome profile for Run/Submit
to work — the extension rides your existing session, it doesn't create one.

## Before shipping this anywhere but localhost

`manifest.json`'s `externally_connectable.matches` currently allows
`http://localhost:3000/*` and a placeholder `https://thirty70.example.com/*`.
Replace the placeholder with your real production domain before publishing
the extension, or externally_connectable will reject messages from prod.

## Note on LeetCode's Terms of Service

This automates the same requests LeetCode's own frontend makes when you click
Run/Submit there, using your own session — it's the same technique tools like
the `vscode-leetcode` extension use. It's still automated interaction with
LeetCode's endpoints outside their official UI, which their ToS may restrict.
Use it on your own account, at your own judgment.
