import { describe, expect, test } from "bun:test";
import { LimitError, NotFoundError, UsageError } from "../errors.ts";
import { fakeAdapter, loadMinimalStructure, minimalSession } from "../test/helpers.ts";
import { runLine } from "./core.ts";
import { parseCommand } from "./parse.ts";

function session() {
  return minimalSession();
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
      expect(out.result.text).toContain("·");
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

  test("cat, help, quit", async () => {
    const cat = await runLine(session(), "cat");
    expect(cat.result.kind).toBe("text");
    if (cat.result.kind === "text") expect(cat.result.text).toContain("/Catalog");

    const help = await runLine(session(), "help cd");
    expect(help.result.kind).toBe("text");
    if (help.result.kind === "text") expect(help.result.text).toContain("cd ");

    const quit = await runLine(session(), "quit");
    expect(quit.result).toEqual({ kind: "quit" });
  });

  test("back after cd", async () => {
    const atPages = await runLine(session(), "cd /Pages");
    const back = await runLine(atPages.session, "back");
    expect(back.session.cwd).toEqual({ objectNumber: 1, generation: 0 });
  });

  test("stream and check use the adapter", async () => {
    const adapter = fakeAdapter();
    const stream = await runLine(session(), "stream 5 0 R --raw", adapter);
    expect(stream.result.kind).toBe("bytes");
    if (stream.result.kind === "bytes") expect([...stream.result.bytes]).toEqual([1, 2, 3, 4]);

    const check = await runLine(session(), "check", adapter);
    expect(check.result.kind).toBe("text");
    if (check.result.kind === "text") expect(check.result.text).toBe("ok");
  });

  test("stream and check require an adapter", async () => {
    await expect(runLine(session(), "stream 5 0 R")).rejects.toThrow(UsageError);
    await expect(runLine(session(), "check")).rejects.toThrow(UsageError);
  });

  test("check reports dangling refs", async () => {
    const structure = loadMinimalStructure();
    const catalog = structure.objects["1 0 R"];
    if (catalog && catalog.value.kind === "dict") {
      catalog.value.entries["/Broken"] = { kind: "ref", ref: { objectNumber: 99, generation: 0 } };
    }
    const { openSession } = await import("../graph/session.ts");
    const s = openSession("minimal.pdf", structure);
    const check = await runLine(s, "check", fakeAdapter());
    expect(check.result.kind).toBe("text");
    if (check.result.kind === "text") expect(check.result.text).toContain("dangling reference 99 0 R");
  });

  test("export_graph --find and depth limit", async () => {
    const found = await runLine(session(), 'export_graph --find "/Type == /Page"');
    expect(found.result.kind).toBe("json");
    if (found.result.kind === "json") {
      const g = found.result.value as { nodes: { ref: string }[] };
      expect(g.nodes.some((n) => n.ref === "4 0 R")).toBe(true);
    }
    await expect(runLine(session(), "export_graph --depth 9")).rejects.toThrow(LimitError);
  });

  test("cd to a missing object", async () => {
    await expect(runLine(session(), "cd 99 0 R")).rejects.toThrow(NotFoundError);
  });
});
