import { describe, expect, test } from "bun:test";
import { splitLsRefs, webviewHtml } from "./webview.ts";

describe("webviewHtml", () => {
  const html = webviewHtml({
    nonce: "testnonce",
    cspSource: "https://example.test",
  });

  test("mirrors the TUI: neighborhood graph, object pane, command box", () => {
    expect(html).toContain("muin");
    expect(html).toContain('id="graph"');
    expect(html).toContain('id="incoming"');
    expect(html).toContain('id="outgoing"');
    expect(html).toContain('id="currentRef"');
    expect(html).toContain('id="object"');
    expect(html).toContain('id="ls"');
    expect(html).toContain('id="cmd"');
    expect(html).toContain('id="line"');
    expect(html).toContain('id="back"');
    expect(html).toContain("nonce-testnonce");
    expect(html).not.toContain("vis-network");
    expect(html).not.toContain("vis.Network");
    expect(html).not.toContain('id="refs"');
  });

  test("posts cd on neighbor click and run on submit", () => {
    expect(html).toContain('postMessage({ type: "cd"');
    expect(html).toContain('postMessage({ type: "run", line }');
    expect(html).toContain('postMessage({ type: "ready" }');
    expect(html).toContain("const ref = m[1]");
    expect(html).toContain("cdTo(ref, false)");
  });

  test("uses the TUI color language on top of VS Code tokens", () => {
    expect(html).toContain("--vscode-editor-background");
    expect(html).toContain("--vscode-terminal-ansiCyan");
    expect(html).toContain("--vscode-terminal-ansiGreen");
    expect(html).toContain('class="brand"');
    expect(html).toContain("›");
  });

  test("wires Tab-completion: requests completions and renders the suggestion list", () => {
    expect(html).toContain('id="suggestions"');
    expect(html).toContain('postMessage({ type: "complete"');
    expect(html).toContain('msg.type === "completions"');
  });

  test("empty Tab from the prompt focuses the graph, like the TUI", () => {
    expect(html).toContain('setFocus("graph")');
    expect(html).toContain("input.value.trim().length === 0");
  });

  test("non-navigation results open a dismissible overlay instead of a growing log", () => {
    expect(html).not.toContain('id="log"');
    expect(html).toContain('id="overlay"');
    expect(html).toContain('id="overlayClose"');
    expect(html).toContain('msg.type === "overlay"');
    expect(html).toContain("overlayOpen()");
  });

  test("errors show as a single status line, not an appended entry", () => {
    expect(html).toContain('id="status"');
    expect(html).toContain('msg.type === "log"');
    expect(html).toContain("setStatus(msg.log");
  });
});

describe("splitLsRefs", () => {
  test("turns object-pane refs into clickable tokens", () => {
    const parts = splitLsRefs("/Pages   3 0 R\n/Type    /Catalog\n/Out     10 0 R");
    expect(parts.filter((p) => p.kind === "ref").map((p) => p.value)).toEqual(["3 0 R", "10 0 R"]);
    expect(parts.some((p) => p.kind === "text" && p.value.includes("/Catalog"))).toBe(true);
  });
});
