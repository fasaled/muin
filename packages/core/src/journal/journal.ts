import { closeSync, existsSync, fstatSync, mkdirSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { formatBytes } from "../commands/format.ts";
import type { ParsedCommand } from "../commands/parse.ts";
import { JOURNAL_PREVIEW_MAX_CHARS } from "../limits.ts";
import type { CommandResult, SessionSnapshot } from "../session-local.ts";

/**
 * Observation journal: one JSONL line per agent operation, appended by the MCP
 * process and tailed read-only by `muin --follow`. `cmd` is the structured source
 * of truth for replay; `line` is the canonical display form (formatCommand).
 */
export type JournalEvent =
  | { v: 1; ts: number; type: "open"; path: string; maxBytes?: number }
  | { v: 1; ts: number; type: "close" }
  | {
      v: 1;
      ts: number;
      type: "cmd";
      line: string;
      cmd?: ParsedCommand;
      ok: boolean;
      error?: string;
      snapshot: SessionSnapshot;
      preview?: string;
    };

export type JournalInput =
  | { type: "open"; path: string; maxBytes?: number }
  | { type: "close" }
  | {
      type: "cmd";
      line: string;
      cmd?: ParsedCommand;
      ok: boolean;
      error?: string;
      snapshot: SessionSnapshot;
      preview?: string;
    };

export type Journal = {
  record(event: JournalInput): void;
  close(): void;
};

/**
 * Append-only writer. The journal may contain PDF paths and content previews, so the
 * file is created 0600. Recording is best-effort: observation must never break the
 * observed process, so a write error disables the journal instead of throwing.
 *
 * An open fd follows the inode, not the path — after a rotation (or deletion) this
 * writer would keep appending to the renamed file forever. So before each record it
 * re-anchors: if the path no longer resolves to the open fd, it closes and reopens.
 */
export function createJournal(path: string): Journal {
  mkdirSync(dirname(path), { recursive: true });
  let fd = openSync(path, "a", 0o600);
  let closed = false;
  let broken = false;
  const reanchor = (): void => {
    let same = false;
    try {
      const current = fstatSync(fd);
      const atPath = statSync(path);
      same = current.ino === atPath.ino && current.dev === atPath.dev;
    } catch {
      same = false;
    }
    if (same) return;
    try {
      closeSync(fd);
    } catch {
      // already closed or invalid; reopening below decides
    }
    try {
      fd = openSync(path, "a", 0o600);
    } catch {
      fd = -1; // never a valid fd: the next record retries from a clean state
      throw new Error(`cannot open journal ${path}`);
    }
  };
  return {
    record(event: JournalInput): void {
      if (closed || broken) return;
      try {
        reanchor();
      } catch {
        return; // unreachable file right now; retry on the next event instead of latching broken
      }
      try {
        writeSync(fd, `${JSON.stringify({ v: 1, ts: Date.now(), ...event })}\n`);
      } catch {
        broken = true;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        closeSync(fd);
      } catch {
        // best-effort close, same rationale as record()
      }
    },
  };
}

/**
 * Rotate a journal aside: a non-empty existing file moves to a timestamped backup
 * next to it (`live-20260926-213500.jsonl`), so a fresh server process starts with
 * an empty journal — one file per server lifetime, i.e. per agent session. Returns
 * the backup path, or undefined when there was nothing to rotate. Backups are kept;
 * delete them when you no longer need them (they stay viewable via `muin --follow`).
 */
export function rotateJournal(path: string, now = new Date()): string | undefined {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return undefined;
  }
  if (size === 0) return undefined;
  const name = basename(path);
  const stem = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
  const stamp = formatStamp(now);
  const dir = dirname(path);
  let backup = join(dir, `${stem}-${stamp}.jsonl`);
  for (let i = 2; existsSync(backup); i++) {
    backup = join(dir, `${stem}-${stamp}-${i}.jsonl`);
  }
  renameSync(path, backup);
  return backup;
}

function formatStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Small per-event rendering of a command result; the follower's own session holds full output. */
export function resultPreview(result: CommandResult, maxChars = JOURNAL_PREVIEW_MAX_CHARS): string | undefined {
  let text: string;
  switch (result.kind) {
    case "text":
      text = result.text;
      break;
    case "json":
      text = JSON.stringify(result.value, null, 2);
      break;
    case "bytes":
      text = formatBytes(result.bytes);
      break;
    case "quit":
      return undefined;
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[+${text.length - maxChars} more chars]`;
}
