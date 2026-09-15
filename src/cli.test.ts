import { describe, expect, test } from "bun:test";
import { parseArgs, UsageError, VERSION } from "./cli.ts";

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
    expect(() => parseArgs(["--mcp"])).toThrow(UsageError);
  });

  test("rejects two files", () => {
    expect(() => parseArgs(["a.pdf", "b.pdf"])).toThrow(UsageError);
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--nope", "a.pdf"])).toThrow(UsageError);
  });

  test("rejects invalid max-bytes", () => {
    expect(() => parseArgs(["--max-bytes", "nope", "a.pdf"])).toThrow(UsageError);
    expect(() => parseArgs(["--max-bytes"])).toThrow(UsageError);
  });
});

describe("VERSION", () => {
  test("is the reservation version", () => {
    expect(VERSION).toBe("0.0.0");
  });
});
