// Vendors Monaco's prebuilt AMD bundle into public/ so the editor and its web
// workers are served from our own origin. See lib/monacoSetup.ts for why that
// matters; without it Monaco falls back to running language services on the
// main thread.
//
// Runs on install and before dev/build. The output is generated and
// gitignored, so a fresh clone gets it from `npm install`.

import { cp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "monaco-editor", "min", "vs");
const destination = join(root, "public", "monaco", "vs");
const stamp = join(root, "public", "monaco", ".version");

if (!existsSync(source)) {
  console.error(`[copy-monaco] ${source} is missing — is monaco-editor installed?`);
  process.exit(1);
}

const { version } = JSON.parse(
  await readFile(join(root, "node_modules", "monaco-editor", "package.json"), "utf8")
);

// Skip the copy when the vendored tree already matches the installed version,
// so `npm run dev` doesn't re-copy several thousand files on every start.
const current = existsSync(stamp) ? (await readFile(stamp, "utf8")).trim() : null;
if (current === version) {
  process.exit(0);
}

await rm(join(root, "public", "monaco"), { recursive: true, force: true });
await cp(source, destination, { recursive: true });
await writeFile(stamp, `${version}\n`);

console.log(`[copy-monaco] vendored monaco-editor@${version} into public/monaco/vs`);
