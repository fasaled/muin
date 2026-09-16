import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPdfPath, pickFocusedPdf, writeFocusedPdfHint } from "./focus-path.ts";

describe("pickFocusedPdf", () => {
  test("prefers the active tab when it is a PDF", () => {
    expect(
      pickFocusedPdf({
        tabFsPath: "/w/a.pdf",
        editorFsPath: "/w/b.pdf",
        lastPdf: "/w/c.pdf",
      }),
    ).toBe("/w/a.pdf");
  });

  test("falls back to the active editor, then the Muin panel file", () => {
    expect(pickFocusedPdf({ tabFsPath: "/w/note.ts", lastPdf: "/w/c.pdf" })).toBe("/w/c.pdf");
    expect(pickFocusedPdf({ editorFsPath: "/w/b.PDF", lastPdf: "/w/c.pdf" })).toBe("/w/b.PDF");
    expect(pickFocusedPdf({ lastPdf: "/w/c.pdf" })).toBe("/w/c.pdf");
    expect(pickFocusedPdf({})).toBeUndefined();
  });
});

describe("isPdfPath", () => {
  test("matches .pdf case-insensitively", () => {
    expect(isPdfPath("/x/Y.PDF")).toBe(true);
    expect(isPdfPath("/x/y.ts")).toBe(false);
  });
});

describe("writeFocusedPdfHint", () => {
  test("writes the path or an empty file", () => {
    const dir = mkdtempSync(join(tmpdir(), "muin-hint-"));
    const file = join(dir, "nested", "focused-pdf");
    writeFocusedPdfHint(file, "/w/doc.pdf");
    expect(readFileSync(file, "utf8")).toBe("/w/doc.pdf");
    writeFocusedPdfHint(file, undefined);
    expect(readFileSync(file, "utf8")).toBe("");
  });
});
