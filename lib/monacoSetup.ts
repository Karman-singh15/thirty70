// Points @monaco-editor/react at our own copy of Monaco instead of the one it
// would otherwise fetch from jsdelivr at runtime.
//
// The default is a CDN load, which quietly breaks the language services:
// Monaco builds its workers from the same base URL it was loaded from, and a
// browser refuses to construct a Worker from a cross-origin script. Monaco
// catches that and runs the worker code on the main thread instead — the
// "Could not create web worker(s) ... might cause UI freezes" warning, which
// for an editor two people are typing in live is exactly the thread you don't
// want tokenization and IntelliSense sitting on. The same fallback path then
// throws `url.startsWith is not a function`, and the AMD loader ends up
// double-registering language modules ("Duplicate definition of module").
//
// Serving it from our own origin fixes all three at once: the workers actually
// spawn, there's no CDN round trip on first paint, and the version stops
// drifting (the loader's pinned default was 0.55.1 while node_modules had
// 0.56.0 — so the editor on screen wasn't even the version in the lockfile).
//
// public/monaco/vs is copied out of node_modules by scripts/copy-monaco.mjs on
// install and before dev/build; it's generated, so it's gitignored rather than
// committed.

import { loader } from "@monaco-editor/react";

// Safe at module scope: loader.config only merges into the loader's own state
// object — it touches neither `window` nor Monaco itself, so it's inert during
// server rendering and simply has to have run before <Editor> first mounts.
loader.config({ paths: { vs: "/monaco/vs" } });
