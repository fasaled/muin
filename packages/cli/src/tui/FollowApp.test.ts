import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { bindSession, type JournalEvent, type ParsedCommand, type SessionSnapshot } from "@muin/core";
import { fakeAdapter, minimalSession } from "../../../core/src/test/helpers.ts";
import { createMirror } from "./follow.ts";
import { FollowApp } from "./FollowApp.tsx";

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

function events(): JournalEvent[] {
  return [
    { v: 1, ts: 1, type: "open", path: "minimal.pdf" },
    cmdEvent("cd /Pages", { name: "cd", target: "/Pages" }, { snapshot: snapshot(2, 1) }),
    cmdEvent("ls", { name: "ls" }, { snapshot: snapshot(2, 1), preview: "/Kids …" }),
  ];
}

function fakeSource() {
  let callback: ((events: JournalEvent[]) => void) | undefined;
  let reset: (() => void) | undefined;
  return {
    source: {
      subscribe: (cb: (events: JournalEvent[]) => void, onReset?: () => void) => {
        callback = cb;
        reset = onReset;
        return () => {
          callback = undefined;
          reset = undefined;
        };
      },
    },
    emit: (incoming: JournalEvent[]) => callback?.(incoming),
    rotate: () => reset?.(),
  };
}

function fakeMirror() {
  return createMirror({
    openSession: async (path) => bindSession(minimalSession(path), fakeAdapter()),
  });
}

describe("FollowApp", () => {
  test("waits for the journal, then mirrors open/cd and shows the mode badge", async () => {
    const { source, emit } = fakeSource();
    const mirror = fakeMirror();
    const instance = render(createElement(FollowApp, { source, mirror, journalPath: "/tmp/live.jsonl" }));
    await Bun.sleep(30);
    expect(instance.lastFrame() ?? "").toContain("waiting for journal");

    emit(events());
    await Bun.sleep(100);
    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("play");
    expect(frame).toContain("3/3");
    expect(frame).toContain("/Kids");
    expect(frame).toContain("Esc exit");
    expect(frame).toContain("journal: /tmp/live.jsonl");

    instance.stdin.write(" ");
    await Bun.sleep(30);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("paused");
    mirror.close();
    instance.unmount();
  });

  test("left/right steps scrub history and pause autoplay", async () => {
    const { source, emit } = fakeSource();
    const mirror = fakeMirror();
    const instance = render(createElement(FollowApp, { source, mirror, journalPath: "/tmp/live.jsonl" }));
    emit(events());
    await Bun.sleep(100);
    expect(instance.lastFrame() ?? "").toContain("op: $ ls");

    instance.stdin.write("[D"); // left arrow
    await Bun.sleep(100);
    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("2/3");
    expect(frame).toContain("paused");
    expect(frame).toContain("op: $ cd /Pages");

    instance.stdin.write("[D"); // left arrow: back to the open event
    await Bun.sleep(100);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("1/3");
    expect(frame).toContain("opened minimal.pdf");

    instance.stdin.write("[C"); // right arrow
    await Bun.sleep(100);
    expect(instance.lastFrame() ?? "").toContain("2/3");
    expect(instance.lastFrame() ?? "").toContain("op: $ cd /Pages");
    mirror.close();
    instance.unmount();
  });

  test("journal rotation clears the timeline and resumes with the new session", async () => {
    const { source, emit, rotate } = fakeSource();
    const mirror = fakeMirror();
    const instance = render(createElement(FollowApp, { source, mirror, journalPath: "/tmp/live.jsonl" }));
    emit(events());
    await Bun.sleep(100);
    expect(instance.lastFrame() ?? "").toContain("3/3");

    rotate();
    await Bun.sleep(100);
    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("waiting for operations");
    expect(frame).not.toContain("3/3");

    emit([{ v: 1, ts: 2, type: "open", path: "minimal.pdf" }]);
    await Bun.sleep(100);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("1/1");
    expect(frame).toContain("play");
    mirror.close();
    instance.unmount();
  });

  test("the graph pane never runs navigation commands", async () => {
    const { source, emit } = fakeSource();
    const opened: string[] = [];
    const mirror = createMirror({
      openSession: async (path) => {
        opened.push(path);
        return bindSession(minimalSession(path), fakeAdapter());
      },
    });
    const instance = render(createElement(FollowApp, { source, mirror, journalPath: "/tmp/live.jsonl" }));
    emit(events());
    await Bun.sleep(100);

    instance.stdin.write("\r"); // Enter: must not cd or reopen anything
    await Bun.sleep(50);
    expect(opened).toEqual(["minimal.pdf"]);
    mirror.close();
    instance.unmount();
  });
});
