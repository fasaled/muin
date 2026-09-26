import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOURNAL_PREVIEW_MAX_CHARS } from "../limits.ts";
import { bindSession } from "../session.ts";
import { fakeAdapter, minimalSession } from "../test/helpers.ts";
import { createJournal, resultPreview, rotateJournal, type JournalEvent } from "./journal.ts";
import { parseJournalLine, readJournal, tailJournal } from "./reader.ts";
import { withJournal } from "./journaling.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "muin-journal-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cmdEvent(overrides: Partial<Extract<JournalEvent, { type: "cmd" }>> = {}): Extract<JournalEvent, { type: "cmd" }> {
  return {
    v: 1,
    ts: 1,
    type: "cmd",
    line: "ls",
    cmd: { name: "ls" },
    ok: true,
    snapshot: { cwd: { objectNumber: 1, generation: 0 }, path: ["/Root"], historyLength: 0 },
    ...overrides,
  };
}

describe("createJournal", () => {
  test("appends one JSONL line per event and creates parent directories", () => {
    const path = join(dir, "nested", "live.jsonl");
    const journal = createJournal(path);
    journal.record({ type: "open", path: "/tmp/a.pdf" });
    journal.record({ type: "cmd", line: "ls", cmd: { name: "ls" }, ok: true, snapshot: cmdEvent().snapshot });
    journal.record({ type: "close" });
    journal.close();

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    const events = lines.map((l) => JSON.parse(l) as JournalEvent);
    expect(events[0]).toMatchObject({ v: 1, type: "open", path: "/tmp/a.pdf" });
    expect(events[1]).toMatchObject({ v: 1, type: "cmd", line: "ls", ok: true });
    expect(events[2]).toMatchObject({ v: 1, type: "close" });
    for (const e of events) expect(typeof e.ts).toBe("number");
  });

  test("creates the file user-only readable", () => {
    const path = join(dir, "live.jsonl");
    const journal = createJournal(path);
    journal.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("record after close is a no-op, never throws", () => {
    const path = join(dir, "live.jsonl");
    const journal = createJournal(path);
    journal.record({ type: "close" });
    journal.close();
    expect(() => journal.record({ type: "close" })).not.toThrow();
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("follows the path across rotation instead of the renamed inode", () => {
    const path = join(dir, "live.jsonl");
    const backup = join(dir, "live-old.jsonl");
    const journal = createJournal(path);
    journal.record({ type: "open", path: "/a.pdf" });
    renameSync(path, backup);
    writeFileSync(path, "");
    journal.record({ type: "open", path: "/b.pdf" });
    journal.close();
    expect(readFileSync(backup, "utf8")).toContain("/a.pdf");
    expect(readFileSync(backup, "utf8")).not.toContain("/b.pdf");
    expect(readFileSync(path, "utf8")).toContain("/b.pdf");
    expect(readFileSync(path, "utf8")).not.toContain("/a.pdf");
  });

  test("recreates a deleted journal instead of losing events silently", () => {
    const path = join(dir, "live.jsonl");
    const journal = createJournal(path);
    journal.record({ type: "close" });
    rmSync(path);
    journal.record({ type: "close" });
    journal.close();
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("rotateJournal", () => {
  const fixedNow = new Date(2026, 8, 26, 21, 35, 0);

  test("missing and empty files have nothing to rotate", () => {
    expect(rotateJournal(join(dir, "absent.jsonl"), fixedNow)).toBeUndefined();
    const empty = join(dir, "empty.jsonl");
    writeFileSync(empty, "");
    expect(rotateJournal(empty, fixedNow)).toBeUndefined();
    expect(existsSync(empty)).toBe(true);
  });

  test("moves a non-empty journal to a timestamped backup", () => {
    const path = join(dir, "live.jsonl");
    writeFileSync(path, '{"v":1}\n');
    const backup = rotateJournal(path, fixedNow);
    expect(backup).toBe(join(dir, "live-20260926-213500.jsonl"));
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(backup as string, "utf8")).toBe('{"v":1}\n');
  });

  test("a colliding backup name gains a counter suffix", () => {
    const path = join(dir, "live.jsonl");
    writeFileSync(path, "old\n");
    writeFileSync(join(dir, "live-20260926-213500.jsonl"), "previous\n");
    const backup = rotateJournal(path, fixedNow);
    expect(backup).toBe(join(dir, "live-20260926-213500-2.jsonl"));
    expect(readFileSync(backup as string, "utf8")).toBe("old\n");
  });
});

describe("resultPreview", () => {
  test("text passes through; oversized text is truncated with a marker", () => {
    expect(resultPreview({ kind: "text", text: "hello" })).toBe("hello");
    const big = "x".repeat(JOURNAL_PREVIEW_MAX_CHARS + 100);
    const out = resultPreview({ kind: "text", text: big }) ?? "";
    expect(out).toContain("[+100 more chars]");
    expect(out.length).toBeLessThan(big.length + 40);
  });

  test("json is pretty-printed; bytes are summarized; quit has no preview", () => {
    expect(resultPreview({ kind: "json", value: { a: 1 } })).toContain('"a": 1');
    expect(resultPreview({ kind: "bytes", bytes: new Uint8Array(3) })).toContain("3 bytes");
    expect(resultPreview({ kind: "quit" })).toBeUndefined();
  });
});

describe("reader", () => {
  test("parseJournalLine skips malformed and foreign-version lines", () => {
    expect(parseJournalLine("not json")).toBeUndefined();
    expect(parseJournalLine('{"v":2,"type":"close"}')).toBeUndefined();
    expect(parseJournalLine(JSON.stringify(cmdEvent()))?.type).toBe("cmd");
  });

  test("readJournal reads all complete events; missing file reads as empty", () => {
    const path = join(dir, "live.jsonl");
    expect(readJournal(path)).toEqual([]);
    const journal = createJournal(path);
    journal.record({ type: "open", path: "/a.pdf" });
    journal.record({ type: "close" });
    journal.close();
    expect(readJournal(path).map((e) => e.type)).toEqual(["open", "close"]);
  });

  test("tailJournal delivers existing and appended events", async () => {
    const path = join(dir, "live.jsonl");
    const journal = createJournal(path);
    journal.record({ type: "open", path: "/a.pdf" });

    const received: JournalEvent[] = [];
    const tail = tailJournal(path, (events) => received.push(...events), { intervalMs: 10 });
    try {
      await Bun.sleep(50);
      expect(received.map((e) => e.type)).toEqual(["open"]);

      journal.record({ type: "close" });
      await Bun.sleep(50);
      expect(received.map((e) => e.type)).toEqual(["open", "close"]);
    } finally {
      tail.close();
      journal.close();
    }
  });

  test("tailJournal waits for the file to appear and never emits a partial line", async () => {
    const path = join(dir, "later.jsonl");
    const received: JournalEvent[] = [];
    const tail = tailJournal(path, (events) => received.push(...events), { intervalMs: 10 });
    try {
      await Bun.sleep(30);
      expect(received).toEqual([]);

      // A half-written line is not delivered until the newline lands.
      const full = JSON.stringify(cmdEvent({ line: "pwd" }));
      writeFileSync(path, `${JSON.stringify(cmdEvent({ line: "ls" }))}\n${full.slice(0, -10)}`);
      await Bun.sleep(50);
      expect(received.map((e) => (e.type === "cmd" ? e.line : e.type))).toEqual(["ls"]);

      appendFileSync(path, `${full.slice(-10)}\n`);
      await Bun.sleep(50);
      expect(received.map((e) => (e.type === "cmd" ? e.line : e.type))).toEqual(["ls", "pwd"]);
    } finally {
      tail.close();
    }
  });

  test("tailJournal fires onReset when the file is replaced by a shorter one", async () => {
    const path = join(dir, "live.jsonl");
    writeFileSync(path, `${JSON.stringify(cmdEvent({ line: "ls" }))}\n${JSON.stringify(cmdEvent({ line: "pwd" }))}\n`);
    const received: JournalEvent[] = [];
    let resets = 0;
    const tail = tailJournal(path, (events) => received.push(...events), {
      intervalMs: 10,
      onReset: () => {
        resets += 1;
      },
    });
    try {
      await Bun.sleep(50);
      expect(received).toHaveLength(2);
      expect(resets).toBe(0);

      // Rotation: the old file moves aside, a fresh (shorter) one takes its path.
      renameSync(path, `${path}.bak`);
      writeFileSync(path, `${JSON.stringify(cmdEvent({ line: "cd /Pages" }))}\n`);
      await Bun.sleep(50);
      expect(resets).toBe(1);
      expect(received.map((e) => (e.type === "cmd" ? e.line : e.type))).toEqual(["ls", "pwd", "cd /Pages"]);
    } finally {
      tail.close();
    }
  });
});

describe("withJournal", () => {
  function collect() {
    const events: JournalEvent[] = [];
    const journal = {
      record: (input: Omit<JournalEvent, "v" | "ts">) => events.push({ v: 1, ts: 1, ...input } as JournalEvent),
      close: () => {},
    };
    return { events, journal };
  }

  test("journals run() with parsed cmd, snapshot, and preview", async () => {
    const { events, journal } = collect();
    const session = withJournal(bindSession(minimalSession(), fakeAdapter()), journal);
    await session.run("cd /Pages");
    await session.run("ls");

    expect(events).toHaveLength(2);
    const [cd, ls] = events as [Extract<JournalEvent, { type: "cmd" }>, Extract<JournalEvent, { type: "cmd" }>];
    expect(cd.line).toBe("cd /Pages");
    expect(cd.cmd).toEqual({ name: "cd", target: "/Pages" });
    expect(cd.ok).toBe(true);
    expect(cd.snapshot.cwd).toEqual({ objectNumber: 2, generation: 0 });
    expect(ls.ok).toBe(true);
    expect(ls.preview).toContain("/Kids");
  });

  test("journals runCommand() with the canonical display line", async () => {
    const { events, journal } = collect();
    const session = withJournal(bindSession(minimalSession(), fakeAdapter()), journal);
    await session.runCommand({ name: "find", type: "Page" });
    const event = events[0] as Extract<JournalEvent, { type: "cmd" }>;
    expect(event.line).toBe("find --type Page");
    expect(event.cmd).toEqual({ name: "find", type: "Page" });
  });

  test("journals errors with ok:false and still throws", async () => {
    const { events, journal } = collect();
    const session = withJournal(bindSession(minimalSession(), fakeAdapter()), journal);
    await expect(session.run("bogus-command")).rejects.toThrow();
    const event = events[0] as Extract<JournalEvent, { type: "cmd" }>;
    expect(event.ok).toBe(false);
    expect(event.error).toContain("bogus-command");
    expect(event.cmd).toBeUndefined();
  });

  test("journals close", () => {
    const { events, journal } = collect();
    const session = withJournal(bindSession(minimalSession(), fakeAdapter()), journal);
    session.close();
    expect(events.map((e) => e.type)).toEqual(["close"]);
  });
});
