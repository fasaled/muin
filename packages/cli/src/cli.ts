import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSession,
  formatProcessError,
  helpText,
  MuinError,
  NotFoundError,
  parseCommand,
  serveMcpStdio,
  UsageError,
  vendorPaths,
} from "@muin/core";
import { completionHelp, completionScript, normalizeCompletionShell } from "./completion.ts";
import { startTui } from "./tui/start.ts";

export { UsageError };

export const VERSION = "0.0.0";

const HELP = `muin — PDF internal structure explorer

Usage:
  muin <file.pdf>                      Interactive TUI
  muin <file.pdf> <command> [args]     One-shot command (no TUI)
  muin --mcp                           MCP server (agent calls open/close)
  muin --mcp <file.pdf>                MCP server, pre-open this PDF
  muin --max-bytes <n> <file.pdf> ...  Cap input size (default: 200 MiB)
  muin help                            Command list
  muin completion bash|zsh|fish|powershell  Print shell completion script
  muin --help
  muin --version

Examples:
  muin doc.pdf check
  muin doc.pdf ls 3 0 R
  muin doc.pdf find --type Stream --where "/Filter == /FlateDecode"

Encrypted PDFs are not supported.

https://github.com/fasaled/muin
`;

const SHORT_USAGE = `Usage: muin <file.pdf> [<command> ...]
       muin --mcp
Try muin --help`;

export type CliArgs =
  | { mode: "help" }
  | { mode: "version" }
  | { mode: "cmdhelp" }
  | { mode: "completion"; shell?: string }
  | { mode: "tui"; file: string; maxBytes?: number }
  | { mode: "oneshot"; file: string; line: string; maxBytes?: number }
  | { mode: "mcp"; file?: string; maxBytes?: number };

export function joinCommandLine(tokens: string[]): string {
  return tokens
    .map((t) => (t.length === 0 || /[\s"]/.test(t) ? `"${t.replaceAll('"', '\\"')}"` : t))
    .join(" ");
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.filter((a) => a.length > 0);
  if (args.length === 0) {
    throw new UsageError(`missing PDF path\n${SHORT_USAGE}`);
  }

  let mcp = false;
  let help = false;
  let version = false;
  let maxBytes: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "-h" || a === "--help") {
      help = true;
      continue;
    }
    if (a === "-v" || a === "--version") {
      version = true;
      continue;
    }
    if (a === "--mcp") {
      mcp = true;
      continue;
    }
    if (a === "--max-bytes") {
      const raw = args[++i];
      if (raw === undefined) {
        throw new UsageError("--max-bytes requires a number");
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new UsageError(`invalid --max-bytes: ${raw}`);
      }
      maxBytes = n;
      continue;
    }
    if (a.startsWith("-") && positional.length === 0) {
      throw new UsageError(`unknown option: ${a}\n${SHORT_USAGE}`);
    }
    positional.push(a);
  }

  if (help) return { mode: "help" };
  if (version) return { mode: "version" };

  if (mcp) {
    if (positional.length > 1) {
      throw new UsageError(`--mcp does not take a one-shot command\n${SHORT_USAGE}`);
    }
    const file = positional[0];
    if (file === undefined) {
      return maxBytes === undefined ? { mode: "mcp" } : { mode: "mcp", maxBytes };
    }
    return maxBytes === undefined ? { mode: "mcp", file } : { mode: "mcp", file, maxBytes };
  }

  if (positional.length === 1 && positional[0] === "help") {
    return { mode: "cmdhelp" };
  }
  if (positional[0] === "completion") {
    if (positional.length === 1) return { mode: "completion" };
    const shell = positional[1];
    if (positional.length === 2 && shell !== undefined) return { mode: "completion", shell };
    throw new UsageError("usage: muin completion [bash|zsh|fish|powershell]");
  }

  if (positional.length === 0) {
    throw new UsageError(`missing PDF path\n${SHORT_USAGE}`);
  }
  const file = positional[0];
  if (file === undefined) {
    throw new UsageError(`missing PDF path\n${SHORT_USAGE}`);
  }
  const rest = positional.slice(1);
  if (rest.length === 0) {
    return maxBytes === undefined ? { mode: "tui", file } : { mode: "tui", file, maxBytes };
  }
  const line = joinCommandLine(rest);
  return maxBytes === undefined ? { mode: "oneshot", file, line } : { mode: "oneshot", file, line, maxBytes };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.mode === "help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (parsed.mode === "version") {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (parsed.mode === "cmdhelp") {
      process.stdout.write(`${helpText()}\n`);
      return 0;
    }
    if (parsed.mode === "completion") {
      if (parsed.shell === undefined) {
        process.stdout.write(completionHelp());
        return 0;
      }
      const shell = normalizeCompletionShell(parsed.shell);
      if (shell === undefined) {
        throw new UsageError(`unknown shell: ${parsed.shell} (bash, zsh, fish, or powershell)`);
      }
      process.stdout.write(completionScript(shell));
      return 0;
    }

    const { js, wasm } = vendorPaths();
    if (!existsSync(js) || !existsSync(wasm)) {
      process.stderr.write(
        "muin: qpdf WASM is missing. Rebuild with Docker (see docs/wasm.md).\n",
      );
      return 1;
    }

    if (parsed.mode === "mcp") {
      const initialPath = parsed.file === undefined ? undefined : resolve(parsed.file);
      if (initialPath !== undefined && !existsSync(initialPath)) {
        throw new NotFoundError(`file not found: ${initialPath}`);
      }
      await serveMcpStdio(
        initialPath === undefined
          ? {}
          : parsed.maxBytes === undefined
            ? { initialPath }
            : { initialPath, maxBytes: parsed.maxBytes },
      );
      return 0;
    }

    const file = resolve(parsed.file);
    if (!existsSync(file)) {
      throw new NotFoundError(`file not found: ${file}`);
    }

    if (parsed.mode === "oneshot") {
      const cmd = parseCommand(parsed.line);
      if (cmd.name === "quit") {
        throw new UsageError("quit is not a one-shot command; omit the command to open the TUI");
      }
      const session = await createSession(
        file,
        parsed.maxBytes === undefined ? {} : { maxBytes: parsed.maxBytes },
      );
      try {
        const result = await session.run(parsed.line);
        if (result.kind === "bytes") {
          process.stdout.write(result.bytes);
        } else if (result.kind === "json") {
          process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
        } else if (result.kind === "text") {
          process.stdout.write(`${result.text}\n`);
        }
      } finally {
        session.close();
      }
      return 0;
    }

    if (process.stderr.isTTY) {
      process.stderr.write(`opening ${parsed.file}…\n`);
    }
    const session = await createSession(
      file,
      parsed.maxBytes === undefined ? {} : { maxBytes: parsed.maxBytes },
    );
    await startTui(session);
    return 0;
  } catch (err) {
    process.stderr.write(`muin: ${formatProcessError(err)}\n`);
    if (err instanceof UsageError) return 2;
    if (err instanceof MuinError) return 1;
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
