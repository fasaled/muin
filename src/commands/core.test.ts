import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openSession } from "../graph/session.ts";
import { parseQpdfJson } from "../pdf/qpdf-json.ts";
import { runLine } from "./core.ts";
import { parseCommand } from "./parse.ts";

const structure = parseQpdfJson(
  JSON.parse(readFileSync(new URL("../../fixtures/json/minimal.json", import.meta.url), "utf8")),
);

function session() {
  return openSession("minimal.pdf", structure);
}

describe("parseCommand", () => {
  test("find with where", () => {
    expect(parseCommand('find --type Stream --where "/Filter == /FlateDecode"')).toEqual({
      name: "find",
      type: "Stream",
      where: "/Filter == /FlateDecode",
    });
  });

  test("stream flags", () => {
    expect(parseCommand("stream 5 0 R --raw")).toEqual({
      name: "stream",
      ref: "5 0 R",
      mode: "raw",
    });
  });
});

describe("runLine", () => {
  test("pwd at catalog", async () => {
    const out = await runLine(session(), "pwd");
    expect(out.result.kind).toBe("text");
    if (out.result.kind === "text") {
      expect(out.result.text).toContain("1 0 R");
      expect(out.result.text).toContain("/Root");
    }
  });

  test("ls and cd", async () => {
    const ls = await runLine(session(), "ls");
    expect(ls.result.kind).toBe("text");
    if (ls.result.kind === "text") expect(ls.result.text).toContain("/Pages");
    const cd = await runLine(session(), "cd /Pages");
    expect(cd.session.cwd).toEqual({ objectNumber: 3, generation: 0 });
  });

  test("find streams with FlateDecode", async () => {
    const out = await runLine(session(), 'find --type Stream --where "/Filter == /FlateDecode"');
    expect(out.result.kind).toBe("text");
    if (out.result.kind === "text") expect(out.result.text).toContain("5 0 R");
  });

  test("refs incoming and outgoing", async () => {
    const s = session();
    const atPages = await runLine(s, "cd /Pages");
    const refs = await runLine(atPages.session, "refs");
    expect(refs.result.kind).toBe("text");
    if (refs.result.kind === "text") {
      expect(refs.result.text).toContain("outgoing");
      expect(refs.result.text).toContain("4 0 R");
      expect(refs.result.text).toContain("incoming");
      expect(refs.result.text).toContain("1 0 R");
    }
  });

  test("export_graph is bounded JSON", async () => {
    const out = await runLine(session(), "export_graph --depth 2");
    expect(out.result.kind).toBe("json");
    if (out.result.kind === "json") {
      const g = out.result.value as { nodes: unknown[]; edges: unknown[] };
      expect(g.nodes.length).toBeGreaterThan(0);
      expect(g.nodes.length).toBeLessThanOrEqual(5000);
    }
  });

  test("tree from pages", async () => {
    const out = await runLine(session(), "tree --depth 2");
    expect(out.result.kind).toBe("text");
    if (out.result.kind === "text") {
      expect(out.result.text).toContain("3 0 R");
      expect(out.result.text).toContain("4 0 R");
    }
  });
});
