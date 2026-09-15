import { describe, expect, test } from "bun:test";
import { formatBytes, formatSnapshot, sanitizeQpdfMessage } from "./format.ts";

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
