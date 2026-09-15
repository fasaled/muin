import { describe, expect, test } from "bun:test";
import { formatBytes, sanitizeQpdfMessage } from "./format.ts";

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
