import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { bindSession } from "@muin/core";
import { openSession } from "../../../core/src/graph/session.ts";
import { fakeAdapter, loadMinimalStructure, minimalSession } from "../../../core/src/test/helpers.ts";
import { App, renderResult } from "./App.tsx";

const originalConfigHome = process.env.XDG_CONFIG_HOME;
const testConfigHome = mkdtempSync(join(tmpdir(), "muin-tui-test-"));

beforeAll(() => {
  process.env.XDG_CONFIG_HOME = testConfigHome;
});

beforeEach(() => {
  rmSync(join(testConfigHome, "muin", "history.json"), { force: true });
});

afterAll(() => {
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  rmSync(testConfigHome, { recursive: true, force: true });
});

describe("renderResult", () => {
  test("text and json", () => {
    expect(renderResult({ kind: "text", text: "hello" })).toBe("hello");
    expect(renderResult({ kind: "json", value: { a: 1 } })).toContain('"a": 1');
  });

  test("bytes and quit", () => {
    expect(renderResult({ kind: "bytes", bytes: new Uint8Array(12) })).toContain("12 bytes");
    expect(renderResult({ kind: "quit" })).toBe("");
  });
});

describe("App", () => {
  test("shows the current object and runs pwd", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("muin");
    expect(frame).toContain("1 0 R");
    instance.stdin.write("pwd");
    instance.stdin.write("\r");
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toMatch(/pwd|1 0 R/);
    instance.unmount();
  });

  test("shows the graph panel with the current neighborhood", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("outgoing");
    expect(frame).toContain("2 0 R");
    instance.unmount();
  });

  test("Tab completes while empty and Shift+Tab focuses the graph", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("Enter run   Tab complete   Up/Down history");
    instance.stdin.write("\u001b[Z");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Shift+Tab → object");
    instance.unmount();
  });

  test("Tab cycles the full initial command list", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› ls ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› cd ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› pwd ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› back ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› refs ");
    instance.unmount();
  });

  test("Tab then Enter navigates into the selected graph neighbor", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("\u001b[Z");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    expect(session.snapshot().cwd).toEqual({ objectNumber: 2, generation: 0 });
    instance.unmount();
  });

  test("shows the object pane for the current node", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("/Pages");
    instance.unmount();
  });

  test("a non-navigation command opens a dismissible overlay instead of a log", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("find --type Page");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("find --type Page");
    expect(frame).toContain("Esc closes");
    expect(frame).toContain("3 0 R");
    expect(frame).not.toContain("outgoing");

    instance.stdin.write("");
    await Bun.sleep(50);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("outgoing");
    instance.unmount();
  });

  test("shows the last executed command in the command panel", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("last: (none)");

    instance.stdin.write("pwd");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("last: pwd");

    instance.stdin.write("");
    await Bun.sleep(50);
    instance.stdin.write("cd /Pages");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("last: cd /Pages");
    expect(frame).toContain("outgoing");
    instance.unmount();
  });

  test("graph navigation records the equivalent cd as the last command", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("[Z");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("last: cd 2 0 R");
    expect(session.snapshot().cwd).toEqual({ objectNumber: 2, generation: 0 });
    instance.unmount();
  });

  test("cd closes an open overlay and refreshes the panes", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("help");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("Esc closes");

    instance.stdin.write("cd /Pages");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    const frame = instance.lastFrame() ?? "";
    expect(frame).not.toContain("Esc closes");
    expect(frame).toContain("outgoing");
    instance.unmount();
  });

  test("Tab with text opens a completion menu of matching commands", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("f");
    await Bun.sleep(10);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("find");
    instance.unmount();
  });

  test("Tab cycles through every matching command candidate", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("c");
    await Bun.sleep(10);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("cd");
    expect(instance.lastFrame() ?? "").toContain("› cd ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("cat");
    expect(instance.lastFrame() ?? "").toContain("› cat ");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("check");
    instance.unmount();
  });

  test("completing a ref argument fills the draft without submitting", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("cd ");
    await Bun.sleep(10);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(10);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("› cd 2 0 R");
    expect(session.snapshot().cwd).toEqual({ objectNumber: 1, generation: 0 });
    instance.unmount();
  });

  test("completes a reference from its typed prefix", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("cd 2");
    await Bun.sleep(10);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("› cd 2 0 R");
    expect(session.snapshot().cwd).toEqual({ objectNumber: 1, generation: 0 });
    instance.unmount();
  });

  test("Esc closes the completion menu without exiting", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("f");
    await Bun.sleep(10);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("find");
    instance.stdin.write("");
    await Bun.sleep(10);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("› f");
    instance.unmount();
  });

  test("history command lists previously run commands in the overlay", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("pwd");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    instance.stdin.write("");
    await Bun.sleep(50);

    instance.stdin.write("history");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(20);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("history");
    expect(frame).toContain("pwd");
    instance.unmount();
  });

  test("overlay content longer than the screen scrolls instead of being lost", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);

    for (let i = 0; i < 25; i++) {
      instance.stdin.write("pwd");
      await Bun.sleep(2);
      instance.stdin.write("\r");
      await Bun.sleep(5);
    }
    instance.stdin.write("history");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(30);

    const before = instance.lastFrame() ?? "";
    expect(before).toContain("25  pwd");
    expect(before).toMatch(/\/\d+/); // a "N/total" position indicator is shown
    expect(before).toContain("activity"); // command history is rendered inside the activity panel

    instance.stdin.write("[A"); // up arrow
    await Bun.sleep(10);
    const after = instance.lastFrame() ?? "";
    expect(after).not.toEqual(before); // scrolling actually changed the visible window

    instance.unmount();
  });

  test("Shift+Tab cycles prompt -> graph -> object -> prompt", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("Enter run   Tab complete   Up/Down history");

    instance.stdin.write("\u001b[Z");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Tab → object");

    instance.stdin.write("\u001b[Z");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Shift+Tab → prompt");

    instance.stdin.write("\u001b[Z");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Enter run   Tab complete   Up/Down history");

    instance.unmount();
  });

  test("the object pane scrolls when the current object's ls is longer than the screen", async () => {
    const structure = loadMinimalStructure();
    const catalog = structure.objects["1 0 R"];
    if (catalog && catalog.value.kind === "dict") {
      const big: Record<string, { kind: "number"; value: number }> = {};
      for (let i = 0; i < 40; i++) big[`/Key${i}`] = { kind: "number", value: i };
      catalog.value.entries = big;
    }
    const session = bindSession(openSession("minimal.pdf", structure), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);

    const before = instance.lastFrame() ?? "";
    expect(before).toContain("/Key0");
    expect(before).toMatch(/\/\d+/); // position indicator, e.g. "1-5/40"
    expect(before).not.toContain("/Key39"); // doesn't fit yet

    instance.stdin.write("\u001b[Z"); // focus graph
    await Bun.sleep(10);
    instance.stdin.write("\u001b[Z"); // focus object
    await Bun.sleep(10);
    instance.stdin.write("[B"); // down arrow: scroll
    await Bun.sleep(10);
    const after = instance.lastFrame() ?? "";
    expect(after).not.toEqual(before);

    instance.unmount();
  });
});
