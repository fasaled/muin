import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Locate the session worker next to this module (source) or next to the bundle. */
export function resolveSessionWorker(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  const names = ["session-worker.js", "session-worker.ts"];
  for (let i = 0; i < 8; i++) {
    for (const name of names) {
      const here = join(dir, name);
      if (existsSync(here)) return here;
      const nested = join(dir, "worker", name);
      if (existsSync(nested)) return nested;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("muin session worker script not found (session-worker.js)");
}
