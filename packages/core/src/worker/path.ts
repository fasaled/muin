import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** CJS bundle `__dirname` (eval, so Bun does not inline `import.meta.url` to the .ts source). */
function startingDir(): string {
  try {
    const dir = eval("__dirname") as unknown;
    if (typeof dir === "string" && dir.length > 0) return dir;
  } catch {
    // ESM: no __dirname
  }
  return dirname(fileURLToPath(import.meta.url));
}

function workerCandidates(dir: string, name: string): string[] {
  return [
    join(dir, name),
    join(dir, "worker", name),
    join(dir, "dist", name),
    join(dir, "cli", "dist", name),
    join(dir, "packages", "cli", "dist", name),
  ];
}

/** Locate the session worker next to this module (source) or next to the bundle. */
export function resolveSessionWorker(): string {
  const jsOnly = !process.versions.bun;
  const names = jsOnly ? ["session-worker.js"] : ["session-worker.js", "session-worker.ts"];
  let dir = startingDir();
  for (let i = 0; i < 8; i++) {
    for (const name of names) {
      for (const candidate of workerCandidates(dir, name)) {
        if (existsSync(candidate)) return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("muin session worker script not found (session-worker.js)");
}
