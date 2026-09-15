import { runLine, runParsed, type Result } from "./commands/core.ts";
import type { ParsedCommand } from "./commands/parse.ts";
import { openSession, type Session } from "./graph/session.ts";
import type { PdfAdapter } from "./pdf/adapter.ts";
import { WasmQpdfAdapter } from "./pdf/qpdf-wasm.ts";
import type { PdfRef } from "./pdf/model.ts";
import { yieldToEventLoop } from "./yield.ts";

export type CommandResult = Result;

export type SessionSnapshot = {
  cwd: PdfRef;
  path: string[];
  historyLength: number;
};

export type SessionOptions = {
  maxBytes?: number;
};

export type MuinSession = {
  readonly filePath: string;
  snapshot(): SessionSnapshot;
  run(line: string): Promise<CommandResult>;
  runCommand(cmd: ParsedCommand): Promise<CommandResult>;
  close(): void;
};

export function bindSession(inner: Session, adapter: PdfAdapter): MuinSession {
  let current = inner;
  return {
    filePath: inner.filePath,
    snapshot: () => ({
      cwd: current.cwd,
      path: current.path,
      historyLength: current.history.length,
    }),
    run: async (line) => {
      await yieldToEventLoop();
      const out = await runLine(current, line, adapter);
      current = out.session;
      return out.result;
    },
    runCommand: async (cmd) => {
      await yieldToEventLoop();
      const out = await runParsed(current, cmd, adapter);
      current = out.session;
      return out.result;
    },
    close: () => {},
  };
}

/** In-process session (WASM on this thread). Used inside the session worker. */
export async function createSessionInProcess(
  filePath: string,
  options: SessionOptions = {},
): Promise<MuinSession> {
  await yieldToEventLoop();
  const adapter = await WasmQpdfAdapter.create();
  await yieldToEventLoop();
  const structure = await adapter.loadStructure(filePath, options.maxBytes);
  await yieldToEventLoop();
  return bindSession(openSession(filePath, structure), adapter);
}
