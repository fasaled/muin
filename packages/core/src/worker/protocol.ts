import type { ParsedCommand } from "../commands/parse.ts";
import type { CommandResult, SessionOptions, SessionSnapshot } from "../session-local.ts";

export type WorkerRequestBody =
  | { type: "open"; filePath: string; options: SessionOptions }
  | { type: "run"; line: string }
  | { type: "runCommand"; cmd: ParsedCommand }
  | { type: "close" };

export type WorkerRequest = WorkerRequestBody & { id: number };

export type WorkerErrorShape = {
  name: string;
  message: string;
  code: string;
};

export type WorkerResponse =
  | { id: number; ok: true; result?: CommandResult; snapshot?: SessionSnapshot }
  | { id: number; ok: false; error: WorkerErrorShape };
