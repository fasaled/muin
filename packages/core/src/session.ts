export type {
  CommandResult,
  MuinSession,
  SessionOptions,
  SessionSnapshot,
} from "./session-local.ts";
export { bindSession, createSessionInProcess } from "./session-local.ts";

import { createWorkerSession } from "./worker/client.ts";
import type { MuinSession, SessionOptions } from "./session-local.ts";

/**
 * Open a PDF. WASM/`callMain` run on a worker thread so the TUI and
 * VS Code extension host stay responsive.
 */
export async function createSession(filePath: string, options: SessionOptions = {}): Promise<MuinSession> {
  return createWorkerSession(filePath, options);
}
