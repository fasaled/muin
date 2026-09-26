import { describe, expect, test } from "bun:test";
import { formatBytes, formatCommand, formatSnapshot, sanitizeQpdfMessage } from "./format.ts";
import { parseCommand, type ParsedCommand } from "./parse.ts";

describe("formatSnapshot", () => {
  const ref = { objectNumber: 99, generation: 0 };

  test("shows a real breadcrumb trail", () => {
    expect(formatSnapshot(ref, ["/Root", "/Pages"])).toBe("99 0 R  ·  /Root /Pages");
  });

  test("a ref-jump's path is just the ref again — don't repeat it", () => {
    expect(formatSnapshot(ref, ["99 0 R"])).toBe("99 0 R");
  });

  test("empty path shows just the ref", () => {
    expect(formatSnapshot(ref, [])).toBe("99 0 R");
  });
});

describe("formatBytes", () => {
  test("utf-8 preview", () => {
    const text = formatBytes(new TextEncoder().encode("hello"));
    expect(text).toContain("5 bytes");
    expect(text).toContain("hello");
  });

  test("binary hex dump", () => {
    const text = formatBytes(new Uint8Array([0, 1, 2, 255]));
    expect(text).toContain("4 bytes");
    expect(text).toMatch(/00 01 02 ff/i);
  });

  test("decoded text past the old 256-byte preview limit is not truncated", () => {
    const long = "A".repeat(10_000);
    const text = formatBytes(new TextEncoder().encode(long));
    expect(text).toContain(long);
    expect(text).not.toContain("more bytes");
  });

  test("a large binary stream still caps the hex dump, not the reported size", () => {
    const bytes = new Uint8Array(20_000);
    bytes.fill(0);
    bytes[0] = 0xff; // stays binary: NUL bytes fail the UTF-8 text heuristic
    const text = formatBytes(bytes);
    expect(text).toContain("20000 bytes");
    expect(text).toMatch(/\[\+\d+ more bytes\]/);
    const hexLines = text.split("\n").filter((l) => /^[0-9a-f]{8}\s/.test(l));
    expect(hexLines.length).toBeLessThan(20_000 / 16);
  });
});

describe("formatCommand", () => {
  const cases: ParsedCommand[] = [
    { name: "ls" },
    { name: "ls", ref: "3 0 R" },
    { name: "cd", target: "3 0 R" },
    { name: "cd", target: "/Pages" },
    { name: "pwd" },
    { name: "back" },
    { name: "refs", ref: "4 0 R" },
    { name: "neighbors" },
    { name: "cat", ref: "5 0 R" },
    { name: "stream", mode: "raw" },
    { name: "stream", ref: "5 0 R", mode: "decoded" },
    { name: "find", type: "Stream" },
    { name: "find", type: "Stream", where: "/Length > 1000" },
    { name: "find", type: "Font", where: "/BaseFont == /Arial AND /Length != 0" },
    { name: "tree" },
    { name: "tree", ref: "3 0 R", depth: 4 },
    { name: "check" },
    { name: "export_graph" },
    { name: "export_graph", from: "1 0 R", depth: 3 },
    { name: "export_graph", find: "/Type == /Page" },
    { name: "help" },
    { name: "help", command: "find" },
    { name: "quit" },
  ];

  test("round-trips through parseCommand", () => {
    for (const cmd of cases) {
      expect(parseCommand(formatCommand(cmd))).toEqual(cmd);
    }
  });

  test("quotes values with whitespace or quotes", () => {
    expect(formatCommand({ name: "find", type: "Stream", where: "/Length > 5" })).toBe(
      'find --type Stream --where "/Length > 5"',
    );
    expect(formatCommand({ name: "cd", target: "3 0 R" })).toBe('cd "3 0 R"');
    expect(formatCommand({ name: "find", type: "A", where: `has "double" quotes` })).toBe(
      `find --type A --where 'has "double" quotes'`,
    );
  });

  test("throws for a token containing both quote kinds (no escape syntax exists)", () => {
    expect(() => formatCommand({ name: "find", type: "A", where: `both "and' quotes` })).toThrow();
    expect(() => formatCommand({ name: "cd", target: "" })).toThrow();
  });
});

describe("sanitizeQpdfMessage", () => {
  test("replaces wasm paths and this.program", () => {
    const raw = "WARNING: /work/input.pdf, object 3 0: kid 0 Resources is missing; this.program: operation succeeded";
    const out = sanitizeQpdfMessage(raw, "/tmp/doc.pdf");
    expect(out).not.toContain("/work/input.pdf");
    expect(out).toContain("doc.pdf");
    expect(out).toContain("qpdf:");
    expect(out.startsWith("WARNING")).toBe(false);
  });
});
