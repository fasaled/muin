import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindSession, type JournalEvent, type ParsedCommand, type SessionSnapshot } from "@muin/core";
import { fakeAdapter, minimalSession } from "../../../core/src/test/helpers.ts";
import { createMirror, formatEventLine, journalSource, type Mirror } from "./follow.ts";

function openEvent(path = "minimal.pdf", maxBytes?: number): JournalEvent {
  return { v: 1, ts: 1, type: "open", path, ...(maxBytes === undefined ? {} : { maxBytes }) };
}

function snapshot(objectNumber: number, historyLength = 0): SessionSnapshot {
  return { cwd: { objectNumber, generation: 0 }, path: ["/Root"], historyLength };
}

function cmdEvent(
  line: string,
  cmd: ParsedCommand,
  overrides: Partial<Extract<JournalEvent, { type: "cmd" }>> = {},
): JournalEvent {
  return { v: 1, ts: 1, type: "cmd", line, cmd, ok: true, snapshot: snapshot(1), ...overrides };
}

function fakeMirror(): Mirror {
  return createMirror({
    openSession: async (path) => bindSession(minimalSession(path), fakeAdapter()),
  });
}

describe("createMirror", () => {
  test("no events yet: waiting for the agent to open a PDF", async () => {
    const mirror = fakeMirror();
    const view = await mirror.seekTo([], -1);
    expect(view.status).toBe("waiting-open");
    mirror.close();
  });

  test("open then cd then ls mirrors the agent's state", async () => {
    const mirror = fakeMirror();
    const events = [
      openEvent(),
      cmdEvent("cd /Pages", { name: "cd", target: "/Pages" }, { snapshot: snapshot(2, 1) }),
      cmdEvent("ls", { name: "ls" }, { snapshot: snapshot(3, 1), preview: "/Kids …" }),
    ];

    const opened = await mirror.seekTo(events, 0);
    expect(opened.status).toBe("ready");
    expect(opened.snap?.cwd).toEqual({ objectNumber: 1, generation: 0 });
    expect(opened.overlay).toEqual({ title: "open", body: "opened minimal.pdf" });

    const moved = await mirror.seekTo(events, 1);
    expect(moved.status).toBe("ready");
    expect(moved.snap?.cwd).toEqual({ objectNumber: 2, generation: 0 });
    expect(moved.overlay).toBeNull();
    expect(moved.neighbors).not.toBeNull();
    expect(moved.objectText).toContain("/Kids");
    expect(moved.diverged).toBe(false);

    const queried = await mirror.seekTo(events, 2);
    expect(queried.snap?.cwd).toEqual({ objectNumber: 2, generation: 0 });
    expect(queried.overlay).toEqual({ title: "ls", body: "/Kids …" });

    mirror.close();
  });

  test("seeking backwards resets to the root and replays forward without reopening", async () => {
    let opens = 0;
    const mirror = createMirror({
      openSession: async (path) => {
        opens += 1;
        return bindSession(minimalSession(path), fakeAdapter());
      },
    });
    const events = [
      openEvent(),
      cmdEvent("cd /Pages", { name: "cd", target: "/Pages" }, { snapshot: snapshot(2, 1) }),
      cmdEvent("back", { name: "back" }, { snapshot: snapshot(1, 0) }),
    ];

    await mirror.seekTo(events, 2);
    const back = await mirror.seekTo(events, 1);
    expect(back.snap?.cwd).toEqual({ objectNumber: 2, generation: 0 });
    expect(back.diverged).toBe(false);
    const root = await mirror.seekTo(events, 0);
    expect(root.snap?.cwd).toEqual({ objectNumber: 1, generation: 0 });
    expect(opens).toBe(1);
    mirror.close();
  });

  test("failed nav operations are skipped, failed queries show their error", async () => {
    const mirror = fakeMirror();
    const events = [
      openEvent(),
      cmdEvent("cd /Nope", { name: "cd", target: "/Nope" }, { ok: false, error: "no object", snapshot: snapshot(1, 0) }),
      cmdEvent("pwd", { name: "pwd" }, { ok: false, error: "boom", snapshot: snapshot(1, 0) }),
    ];
    const skipped = await mirror.seekTo(events, 1);
    expect(skipped.snap?.cwd).toEqual({ objectNumber: 1, generation: 0 });
    expect(skipped.overlay).toBeNull();
    const failed = await mirror.seekTo(events, 2);
    expect(failed.overlay).toEqual({ title: "pwd", body: "error: boom" });
    mirror.close();
  });

  test("close ends the segment; querying past it waits for the next open", async () => {
    const mirror = fakeMirror();
    const events = [openEvent(), { v: 1, ts: 1, type: "close" } as JournalEvent];
    const closed = await mirror.seekTo(events, 1);
    expect(closed.status).toBe("waiting-open");
    expect(closed.overlay).toEqual({ title: "close", body: "closed" });
    mirror.close();
  });

  test("divergence from the recorded snapshot is flagged", async () => {
    const mirror = fakeMirror();
    const events = [
      openEvent(),
      cmdEvent("cd /Pages", { name: "cd", target: "/Pages" }, { snapshot: snapshot(5, 1) }),
    ];
    const view = await mirror.seekTo(events, 1);
    expect(view.snap?.cwd).toEqual({ objectNumber: 2, generation: 0 });
    expect(view.diverged).toBe(true);
    mirror.close();
  });

  test("a missing PDF surfaces an error view instead of throwing", async () => {
    const mirror = createMirror({
      openSession: async () => {
        throw new Error("file not found");
      },
    });
    const view = await mirror.seekTo([openEvent("/gone.pdf")], 0);
    expect(view.status).toBe("error");
    expect(view.overlay?.title).toBe("open");
    mirror.close();
  });
});

describe("formatEventLine", () => {
  test("one readable line per event", () => {
    expect(formatEventLine(openEvent("/a.pdf"))).toBe("opened /a.pdf");
    expect(formatEventLine({ v: 1, ts: 1, type: "close" })).toBe("closed");
    expect(formatEventLine(cmdEvent("ls", { name: "ls" }))).toBe("$ ls");
    expect(formatEventLine(cmdEvent("pwd", { name: "pwd" }, { ok: false, error: "boom" }))).toBe("$ pwd  [error] boom");
  });
});

describe("journalSource", () => {
  test("forwards events and rotation resets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muin-source-test-"));
    try {
      const path = join(dir, "live.jsonl");
      writeFileSync(path, "");
      const received: JournalEvent[] = [];
      let resets = 0;
      const source = journalSource(path, 10);
      const stop = source.subscribe(
        (events) => received.push(...events),
        () => {
          resets += 1;
        },
      );
      try {
        appendFileSync(path, `${JSON.stringify(cmdEvent("ls", { name: "ls" }))}\n`);
        await Bun.sleep(50);
        expect(received.map((e) => (e.type === "cmd" ? e.line : e.type))).toEqual(["ls"]);
        expect(resets).toBe(0);

        renameSync(path, `${path}.bak`);
        writeFileSync(path, "");
        await Bun.sleep(50);
        expect(resets).toBe(1);
      } finally {
        stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
