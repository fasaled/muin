import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_HISTORY = 200;

type HistoryFile = { version: 1; commands: string[] };

export function historyFilePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "muin", "history.json");
}

export function loadHistory(filePath = historyFilePath()): string[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<HistoryFile>;
    if (!Array.isArray(parsed.commands)) return [];
    return parsed.commands.filter((command): command is string => typeof command === "string").slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveHistory(commands: string[], filePath = historyFilePath()): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ version: 1, commands: commands.slice(-MAX_HISTORY) } satisfies HistoryFile) + "\n");
  } catch {
    // History is a convenience; a read-only home must not prevent the TUI from starting.
  }
}