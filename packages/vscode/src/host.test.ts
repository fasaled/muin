import { describe, expect, test } from "bun:test";
import { bindSession } from "@muin/core";
import { fakeAdapter, minimalSession } from "../../core/src/test/helpers.ts";
import { formatPanelResult, graphMutates, handleWebviewMessage, trimGraphForUi, truncateOutput } from "./host.ts";

function session() {
  return bindSession(minimalSession("minimal.pdf"), fakeAdapter());
}

describe("graphMutates", () => {
  test("navigation and search refresh the graph", () => {
    expect(graphMutates("cd /Pages")).toBe(true);
    expect(graphMutates("back")).toBe(true);
    expect(graphMutates("find --type Page")).toBe(true);
    expect(graphMutates("export_graph --depth 1")).toBe(true);
  });

  test("inspect commands do not", () => {
    expect(graphMutates("ls")).toBe(false);
    expect(graphMutates("pwd")).toBe(false);
    expect(graphMutates("cat")).toBe(false);
    expect(graphMutates("check")).toBe(false);
    expect(graphMutates("help")).toBe(false);
  });
});

describe("truncateOutput", () => {
  test("leaves short strings alone", () => {
    expect(truncateOutput("ok", 10)).toBe("ok");
  });

  test("caps long strings", () => {
    const out = truncateOutput("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("truncated");
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
    expect(out.log).toContain("opened");
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

  test("run pwd logs without replacing the graph payload type", async () => {
    const out = await handleWebviewMessage(session(), { type: "run", line: "pwd" });
    expect(out.type).toBe("log");
    if (out.type !== "log") return;
    expect(out.log).toContain("1 0 R");
  });

  test("run cd refreshes state", async () => {
    const out = await handleWebviewMessage(session(), { type: "run", line: "cd /Pages" });
    expect(out.type).toBe("state");
    if (out.type !== "state") return;
    expect(out.cwd).toBe("3 0 R");
  });

  test("unknown message is an empty log", async () => {
    const out = await handleWebviewMessage(session(), { type: "nope" });
    expect(out).toEqual({ type: "log", log: "" });
  });
});
