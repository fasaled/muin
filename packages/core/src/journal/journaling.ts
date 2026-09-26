import { formatCommand } from "../commands/format.ts";
import { parseCommand, type ParsedCommand } from "../commands/parse.ts";
import { formatProcessError } from "../process-error.ts";
import type { CommandResult, MuinSession } from "../session-local.ts";
import { resultPreview, type Journal } from "./journal.ts";

/**
 * Session decorator that journals every command. The single instrumentation point for
 * observation: hosts (MCP today, TUI if it ever records itself) wrap their session and
 * get command events for free; only open/close lifecycle events stay host-level.
 */
export function withJournal(session: MuinSession, journal: Journal): MuinSession {
  const recordOk = (input: { line: string; cmd?: ParsedCommand }, result: CommandResult): void => {
    const preview = resultPreview(result);
    journal.record({
      type: "cmd",
      ...input,
      ok: true,
      snapshot: session.snapshot(),
      ...(preview === undefined ? {} : { preview }),
    });
  };
  const recordError = (input: { line: string; cmd?: ParsedCommand }, err: unknown): void => {
    journal.record({ type: "cmd", ...input, ok: false, error: formatProcessError(err), snapshot: session.snapshot() });
  };

  return {
    filePath: session.filePath,
    snapshot: () => session.snapshot(),
    run: async (line) => {
      let cmd: ParsedCommand | undefined;
      try {
        cmd = parseCommand(line);
      } catch {
        cmd = undefined;
      }
      const input = cmd === undefined ? { line } : { line, cmd };
      try {
        const result = await session.run(line);
        recordOk(input, result);
        return result;
      } catch (err) {
        recordError(input, err);
        throw err;
      }
    },
    runCommand: async (cmd) => {
      const input = { line: displayLine(cmd), cmd };
      try {
        const result = await session.runCommand(cmd);
        recordOk(input, result);
        return result;
      } catch (err) {
        recordError(input, err);
        throw err;
      }
    },
    close: () => {
      session.close();
      journal.record({ type: "close" });
    },
  };
}

function displayLine(cmd: ParsedCommand): string {
  try {
    return formatCommand(cmd);
  } catch {
    // A token with both quote kinds has no command-line form; the name still identifies the op.
    return cmd.name;
  }
}
