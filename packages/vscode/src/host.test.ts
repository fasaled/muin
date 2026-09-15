import { describe, expect, test } from "bun:test";
import { bindSession } from "@muin/core";
import { fakeAdapter, minimalSession } from "../../core/src/test/helpers.ts";
import { formatPanelResult, handleWebviewMessage, isNavigationCommand, trimGraphForUi, truncateOutput } from "./host.ts";

function session() {
  return bindSession(minimalSession("minimal.pdf"), fakeAdapter());
}

describe("isNavigationCommand", () => {
  test("cd and back move the current object", () => {
    expect(isNavigationCommand("cd /Pages")).toBe(true);
    expect(isNavigationCommand("back")).toBe(true);
  });

  test("everything else is a query, shown in the overlay instead", () => {
    expect(isNavigationCommand("find --type Page")).toBe(false);
    expect(isNavigationCommand("export_graph --depth 1")).toBe(false);
    expect(isNavigationCommand("ls")).toBe(false);
    expect(isNavigationCommand("pwd")).toBe(false);
    expect(isNavigationCommand("cat")).toBe(false);
    expect(isNavigationCommand("check")).toBe(false);
    expect(isNavigationCommand("help")).toBe(false);
  });
});

describe("truncateOutput", () => {
  test("leaves short strings alone", () => {
    expect(truncateOutput("ok", 10)).toBe("ok");
  });

  test("caps long strings", () => {
    const out = truncateOutput("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("more chars");
  });
});

describe("trimGraphForUi", () => {
  test("keeps a neighborhood around cwd", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ ref: `${i} 0 R` }));
    const edges = Array.from({ length: 19 }, (_, i) => ({ from: `${i} 0 R`, to: `${i + 1} 0 R` }));
    const trimmed = trimGraphForUi({ nodes, edges }, "0 0 R", 5);
    expect(trimmed.nodes.length).toBeLessThanOrEqual(5);
    expect(trimmed.nodes.some((n) => n.ref === "0 0 R")).toBe(true);
  });
});

describe("formatPanelResult", () => {
  test("text, json, bytes, quit", () => {
    expect(formatPanelResult({ kind: "text", text: "ok" })).toBe("ok");
    expect(formatPanelResult({ kind: "json", value: { n: 1 } })).toContain('"n": 1');
    expect(formatPanelResult({ kind: "bytes", bytes: new Uint8Array(3) })).toContain("3 bytes");
    expect(formatPanelResult({ kind: "quit" })).toBe("");
  });
});

describe("handleWebviewMessage", () => {
  test("ready returns graph state at /Root", async () => {
    const out = await handleWebviewMessage(session(), { type: "ready" });
    expect(out.type).toBe("state");
    if (out.type !== "state") return;
    expect(out.cwd).toBe("1 0 R");
    expect(out.path).toEqual(["/Root"]);
    expect(out.fileName).toBe("minimal.pdf");
    expect(out.canBack).toBe(false);
    expect(out.ls).toContain("/Pages");
    const graph = out.graph as { nodes: { ref: string }[] };
    expect(graph.nodes.some((n) => n.ref === "1 0 R")).toBe(true);
  });

  test("cd updates cwd", async () => {
    const s = session();
    await handleWebviewMessage(s, { type: "ready" });
    const out = await handleWebviewMessage(s, { type: "cd", ref: "3 0 R" });
    expect(out.type).toBe("state");
    if (out.type !== "state") return;
    expect(out.cwd).toBe("3 0 R");
    expect(out.canBack).toBe(true);
  });

  test("a ref-jump's path doesn't repeat cwd (no '3 0 R  /  3 0 R' in the header)", async () => {
    const out = await handleWebviewMessage(session(), { type: "cd", ref: "3 0 R" });
    expect(out.type).toBe("state");
    if (out.type !== "state") return;
    expect(out.cwd).toBe("3 0 R");
    expect(out.path).toEqual([]);
  });

  test("run pwd opens a dismissible overlay instead of a log", async () => {
    const out = await handleWebviewMessage(session(), { type: "run", line: "pwd" });
    expect(out.type).toBe("overlay");
    if (out.type !== "overlay") return;
    expect(out.title).toBe("pwd");
    expect(out.body).toContain("1 0 R");
  });

  test("run cd refreshes state", async () => {
    const out = await handleWebviewMessage(session(), { type: "run", line: "cd /Pages" });
    expect(out.type).toBe("state");
    if (out.type !== "state") return;
    expect(out.cwd).toBe("3 0 R");
  });

  test("run find opens an overlay and does not touch cwd", async () => {
    const s = session();
    const out = await handleWebviewMessage(s, { type: "run", line: "find --type Page" });
    expect(out.type).toBe("overlay");
    if (out.type !== "overlay") return;
    expect(out.title).toBe("find --type Page");
    expect(out.body).toContain("4 0 R");
    expect(s.snapshot().cwd).toEqual({ objectNumber: 1, generation: 0 });
  });

  test("a bad command still throws, for the panel's error handling", async () => {
    await expect(handleWebviewMessage(session(), { type: "run", line: "cd /NoSuchKey" })).rejects.toThrow();
  });

  test("complete returns matching command names for the first token", async () => {
    const out = await handleWebviewMessage(session(), { type: "complete", line: "f", cursor: 1 });
    expect(out.type).toBe("completions");
    if (out.type !== "completions") return;
    expect(out.items).toEqual(["find"]);
    expect(out.replaceFrom).toBe(0);
  });

  test("complete returns neighbor refs for a ref-taking command", async () => {
    const out = await handleWebviewMessage(session(), { type: "complete", line: "cd ", cursor: 3 });
    expect(out.type).toBe("completions");
    if (out.type !== "completions") return;
    expect(out.items).toContain("3 0 R");
  });

  test("unknown message is an empty log", async () => {
    const out = await handleWebviewMessage(session(), { type: "nope" });
    expect(out).toEqual({ type: "log", log: "" });
  });
});
