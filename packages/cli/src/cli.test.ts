import { describe, expect, test } from "bun:test";
import { joinCommandLine, parseArgs, UsageError, VERSION } from "./cli.ts";

describe("parseArgs", () => {
  test("help flags", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("version flags", () => {
    expect(parseArgs(["--version"])).toEqual({ mode: "version" });
    expect(parseArgs(["-v"])).toEqual({ mode: "version" });
  });

  test("TUI mode with a file", () => {
    expect(parseArgs(["doc.pdf"])).toEqual({ mode: "tui", file: "doc.pdf" });
  });

  test("one-shot command after the file", () => {
    expect(parseArgs(["doc.pdf", "check"])).toEqual({ mode: "oneshot", file: "doc.pdf", line: "check" });
    expect(parseArgs(["doc.pdf", "ls", "3", "0", "R"])).toEqual({
      mode: "oneshot",
      file: "doc.pdf",
      line: "ls 3 0 R",
    });
    expect(parseArgs(["doc.pdf", "find", "--type", "Stream", "--where", "/Filter == /FlateDecode"])).toEqual({
      mode: "oneshot",
      file: "doc.pdf",
      line: 'find --type Stream --where "/Filter == /FlateDecode"',
    });
  });

  test("muin help without a file", () => {
    expect(parseArgs(["help"])).toEqual({ mode: "cmdhelp" });
  });

  test("rejects a one-shot mixed with --mcp", () => {
    expect(() => parseArgs(["--mcp", "doc.pdf", "ls"])).toThrow(UsageError);
  });

  test("MCP mode without a file", () => {
    expect(parseArgs(["--mcp"])).toEqual({ mode: "mcp" });
  });

  test("MCP mode with a file", () => {
    expect(parseArgs(["--mcp", "doc.pdf"])).toEqual({ mode: "mcp", file: "doc.pdf" });
    expect(parseArgs(["doc.pdf", "--mcp"])).toEqual({ mode: "mcp", file: "doc.pdf" });
  });

  test("max-bytes", () => {
    expect(parseArgs(["--max-bytes", "1024", "doc.pdf"])).toEqual({
      mode: "tui",
      file: "doc.pdf",
      maxBytes: 1024,
    });
  });

  test("rejects missing file", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
  });

  test("a second positional is a one-shot line, not a second file", () => {
    expect(parseArgs(["a.pdf", "b.pdf"])).toEqual({ mode: "oneshot", file: "a.pdf", line: "b.pdf" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--nope", "a.pdf"])).toThrow(UsageError);
  });

  test("rejects invalid max-bytes", () => {
    expect(() => parseArgs(["--max-bytes", "nope", "a.pdf"])).toThrow(UsageError);
    expect(() => parseArgs(["--max-bytes"])).toThrow(UsageError);
  });

  test("--events requires and follows --mcp", () => {
    expect(parseArgs(["--mcp", "--events", "live.jsonl"])).toEqual({ mode: "mcp", events: "live.jsonl" });
    expect(parseArgs(["--mcp", "doc.pdf", "--events", "live.jsonl"])).toEqual({
      mode: "mcp",
      file: "doc.pdf",
      events: "live.jsonl",
    });
    expect(parseArgs(["--mcp", "--max-bytes", "1024", "--events", "live.jsonl"])).toEqual({
      mode: "mcp",
      maxBytes: 1024,
      events: "live.jsonl",
    });
    expect(() => parseArgs(["--events", "live.jsonl"])).toThrow(UsageError);
    expect(() => parseArgs(["--events"])).toThrow(UsageError);
    expect(() => parseArgs(["doc.pdf", "--events", "live.jsonl"])).toThrow(UsageError);
  });

  test("--follow is standalone and exclusive", () => {
    expect(parseArgs(["--follow", "live.jsonl"])).toEqual({ mode: "follow", journal: "live.jsonl" });
    expect(() => parseArgs(["--follow"])).toThrow(UsageError);
    expect(() => parseArgs(["--follow", "live.jsonl", "doc.pdf"])).toThrow(UsageError);
    expect(() => parseArgs(["--follow", "live.jsonl", "--mcp"])).toThrow(UsageError);
    expect(() => parseArgs(["--follow", "live.jsonl", "--events", "other.jsonl"])).toThrow(UsageError);
    expect(() => parseArgs(["--follow", "live.jsonl", "--max-bytes", "1024"])).toThrow(UsageError);
  });
});

describe("joinCommandLine", () => {
  test("quotes tokens with spaces", () => {
    expect(joinCommandLine(["find", "--where", "/A == /B"])).toBe('find --where "/A == /B"');
  });
});

describe("VERSION", () => {
  test("matches the package version", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(VERSION).toBe(pkg.version);
  });
});
