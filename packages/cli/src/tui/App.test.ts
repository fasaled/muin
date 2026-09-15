import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { bindSession } from "@muin/core";
import { openSession } from "../../../core/src/graph/session.ts";
import { fakeAdapter, loadMinimalStructure, minimalSession } from "../../../core/src/test/helpers.ts";
import { App, renderResult } from "./App.tsx";

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
    expect(frame).toContain("3 0 R");
    instance.unmount();
  });

  test("Tab toggles focus between prompt and graph", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("Tab complete/graph");
    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Tab → object");
    instance.unmount();
  });

  test("Tab then Enter navigates into the selected graph neighbor", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    instance.stdin.write("\t");
    await Bun.sleep(10);
    instance.stdin.write("\r");
    await Bun.sleep(50);
    expect(session.snapshot().cwd).toEqual({ objectNumber: 3, generation: 0 });
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
    expect(frame).toContain("4 0 R");
    expect(frame).not.toContain("outgoing");

    instance.stdin.write("");
    await Bun.sleep(50);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("outgoing");
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
    expect(frame).toContain("› cd 3 0 R");
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
    expect(before).toContain("1  pwd");
    expect(before).toMatch(/\/\d+/); // a "N/total" position indicator is shown
    expect(before).not.toContain("25  pwd"); // the last entry doesn't fit yet

    instance.stdin.write("[B"); // down arrow
    await Bun.sleep(10);
    const after = instance.lastFrame() ?? "";
    expect(after).not.toEqual(before); // scrolling actually changed the visible window

    instance.unmount();
  });

  test("Tab cycles prompt -> graph -> object -> prompt", async () => {
    const session = bindSession(minimalSession("minimal.pdf"), fakeAdapter());
    const instance = render(createElement(App, { session }));
    await Bun.sleep(50);
    expect(instance.lastFrame() ?? "").toContain("Tab complete/graph");

    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Tab → object");

    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Tab/Esc → prompt");

    instance.stdin.write("\t");
    await Bun.sleep(10);
    expect(instance.lastFrame() ?? "").toContain("Tab complete/graph");

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

    instance.stdin.write("\t"); // focus graph
    await Bun.sleep(10);
    instance.stdin.write("\t"); // focus object
    await Bun.sleep(10);
    instance.stdin.write("[B"); // down arrow: scroll
    await Bun.sleep(10);
    const after = instance.lastFrame() ?? "";
    expect(after).not.toEqual(before);

    instance.unmount();
  });
});
