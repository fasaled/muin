import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { runLine } from "../commands/core.ts";
import { CorruptPdfError, LimitError } from "../errors.ts";
import { openSession } from "../graph/session.ts";
import { vendorPaths, WasmQpdfAdapter } from "./qpdf-wasm.ts";

const wasmReady = existsSync(vendorPaths().wasm);

describe.skipIf(!wasmReady)("WasmQpdfAdapter", () => {
  test("opens the minimal fixture", async () => {
    const adapter = await WasmQpdfAdapter.create();
    const structure = await adapter.loadStructure("fixtures/pdf/minimal.pdf");
    expect(Object.keys(structure.objects)).toContain("1 0 R");
    const session = openSession("fixtures/pdf/minimal.pdf", structure);
    const ls = await runLine(session, "ls", adapter);
    expect(ls.result.kind).toBe("text");
    if (ls.result.kind === "text") {
      expect(ls.result.text).toContain("/Pages");
    }
  });

  test("enforces --max-bytes", async () => {
    const adapter = await WasmQpdfAdapter.create();
    await expect(adapter.loadStructure("fixtures/pdf/minimal.pdf", 1)).rejects.toThrow(LimitError);
  });

  test("rejects a corrupt file", async () => {
    const adapter = await WasmQpdfAdapter.create();
    await expect(adapter.loadStructure("fixtures/pdf/corrupt.pdf")).rejects.toThrow(CorruptPdfError);
  });

  test("check and tree on a real PDF", async () => {
    const adapter = await WasmQpdfAdapter.create();
    const structure = await adapter.loadStructure("fixtures/pdf/minimal.pdf");
    const session = openSession("fixtures/pdf/minimal.pdf", structure);
    const tree = await runLine(session, "tree", adapter);
    expect(tree.result.kind).toBe("text");
    if (tree.result.kind === "text") expect(tree.result.text).toContain("Page");
    const check = await runLine(session, "check", adapter);
    expect(check.result.kind).toBe("text");
  });
});
