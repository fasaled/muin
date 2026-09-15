import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { UsageError, MuinError } from "./errors.ts";
import { openSession } from "./graph/session.ts";
import { startMcp } from "./mcp/server.ts";
import { WasmQpdfAdapter, vendorPaths } from "./pdf/qpdf-wasm.ts";
import { startTui } from "./tui/start.ts";

export { UsageError };

export const VERSION = "0.0.0";

const HELP = `muin — PDF internal structure explorer

Usage:
  muin <file.pdf>              Interactive TUI
  muin --mcp <file.pdf>        MCP server on stdio
  muin --help
  muin --version

The TUI and MCP server are mutually exclusive. Mode is chosen once
at process start.

Encrypted PDFs are not supported.

Docs: https://github.com/fasaled/muin
`;

export type CliMode = "tui" | "mcp" | "help" | "version";

export type CliArgs =
  | { mode: "help" }
  | { mode: "version" }
  | { mode: "tui"; file: string; maxBytes?: number }
  | { mode: "mcp"; file: string; maxBytes?: number };

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.filter((a) => a.length > 0);
  if (args.length === 0) {
    throw new UsageError("missing PDF path\n\n" + HELP);
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
    if (a.startsWith("-")) {
      throw new UsageError(`unknown option: ${a}\n\n` + HELP);
    }
    positional.push(a);
  }

  if (help) return { mode: "help" };
  if (version) return { mode: "version" };

  if (positional.length !== 1) {
    throw new UsageError("expected exactly one PDF path\n\n" + HELP);
  }
  const file = positional[0];
  if (file === undefined) {
    throw new UsageError("missing PDF path\n\n" + HELP);
  }
  if (mcp) {
    return maxBytes === undefined ? { mode: "mcp", file } : { mode: "mcp", file, maxBytes };
  }
  return maxBytes === undefined ? { mode: "tui", file } : { mode: "tui", file, maxBytes };
}

export function formatHelp(): string {
  return HELP;
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
    const { js, wasm } = vendorPaths();
    if (!existsSync(js) || !existsSync(wasm)) {
      process.stderr.write(
        "muin: qpdf WASM is not vendored yet. Build it with Docker (see docs/wasm.md).\n",
      );
      return 1;
    }
    const file = resolve(parsed.file);
    const adapter = await WasmQpdfAdapter.create();
    const structure = await adapter.loadStructure(file, parsed.maxBytes);
    const session = openSession(file, structure);
    if (parsed.mode === "mcp") {
      await startMcp(session, adapter);
      return 0;
    }
    await startTui(session, adapter);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`muin: ${message}\n`);
    if (err instanceof UsageError) return 2;
    if (err instanceof MuinError) return 1;
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
