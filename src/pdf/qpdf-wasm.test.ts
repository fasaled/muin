import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openSession } from "../graph/session.ts";
import { runLine } from "../commands/core.ts";
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
});
