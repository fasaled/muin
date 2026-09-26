import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import type { JournalEvent } from "./journal.ts";

/** Parse one journal line. Unparseable lines are skipped, never thrown — a follower must tolerate a journal written by a newer muin. */
export function parseJournalLine(line: string): JournalEvent | undefined {
  try {
    const parsed = JSON.parse(line) as JournalEvent;
    if (parsed && parsed.v === 1 && typeof parsed.type === "string") return parsed;
  } catch {
    // fall through: skip line
  }
  return undefined;
}

/** Read every complete event currently in the journal. Missing file reads as empty. */
export function readJournal(path: string): JournalEvent[] {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      offset += readSync(fd, buffer, offset, size - offset, offset);
    }
    return parseChunk(buffer.toString("utf8"), true).events;
  } finally {
    closeSync(fd);
  }
}

export type JournalTail = { close(): void };

/**
 * Follow a journal file, delivering complete events as they are appended. Polls with an
 * offset rather than fs.watch (reliable across filesystems); waits for the file to appear,
 * tolerates truncation, and never emits a partially-written line.
 *
 * When the file shrinks below the read offset — rotation, manual truncation, or deletion
 * followed by recreation — the tail restarts at zero and `onReset` fires first, so the
 * follower can drop the previous session's timeline instead of concatenating sessions.
 */
export function tailJournal(
  path: string,
  onEvents: (events: JournalEvent[]) => void,
  options: { intervalMs?: number; onReset?: () => void } = {},
): JournalTail {
  const intervalMs = options.intervalMs ?? 250;
  const onReset = options.onReset;
  let offset = 0;
  let pending = "";
  let closed = false;

  const tick = (): void => {
    if (closed) return;
    try {
      const size = statSync(path).size;
      if (size < offset) {
        offset = 0;
        pending = "";
        onReset?.();
      }
      if (size === offset) return;
      const fd = openSync(path, "r");
      try {
        const buffer = Buffer.alloc(size - offset);
        let read = 0;
        while (read < buffer.byteLength) {
          read += readSync(fd, buffer, read, buffer.byteLength - read, offset + read);
        }
        pending += buffer.toString("utf8");
        offset = size;
      } finally {
        closeSync(fd);
      }
      const parsed = parseChunk(pending, false);
      pending = parsed.remainder;
      if (parsed.events.length > 0) onEvents(parsed.events);
    } catch {
      // File missing, unreadable, or replaced mid-read: keep waiting.
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    close(): void {
      closed = true;
      clearInterval(timer);
    },
  };
}

function parseChunk(text: string, flushRemainder: boolean): { events: JournalEvent[]; remainder: string } {
  const lines = text.split("\n");
  const remainder = flushRemainder ? "" : (lines.pop() ?? "");
  const events: JournalEvent[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const event = parseJournalLine(line);
    if (event !== undefined) events.push(event);
  }
  return { events, remainder };
}
