import { describe, expect, test } from "bun:test";
import { webviewHtml } from "./webview.ts";

describe("webviewHtml", () => {
  const html = webviewHtml({
    visScript: "https://example.test/vis.js",
    nonce: "testnonce",
    cspSource: "https://example.test",
  });

  test("includes the graph, command box, and detail panes", () => {
    expect(html).toContain('id="graph"');
    expect(html).toContain('id="cmd"');
    expect(html).toContain('id="line"');
    expect(html).toContain('id="ls"');
    expect(html).toContain('id="refs"');
    expect(html).toContain('id="back"');
    expect(html).toContain("https://example.test/vis.js");
    expect(html).toContain("nonce-testnonce");
  });

  test("posts cd on node click and run on submit", () => {
    expect(html).toContain('postMessage({ type: "cd"');
    expect(html).toContain('postMessage({ type: "run"');
    expect(html).toContain('postMessage({ type: "ready"');
  });

  test("uses VS Code theme tokens", () => {
    expect(html).toContain("--vscode-editor-background");
    expect(html).toContain("--vscode-button-background");
  });

  test("defers graph layout to animation frames", () => {
    expect(html).toContain("requestAnimationFrame");
  });
});
