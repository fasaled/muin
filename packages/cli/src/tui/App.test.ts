import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { bindSession } from "@muin/core";
import { fakeAdapter, minimalSession } from "../../../core/src/test/helpers.ts";
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
});
