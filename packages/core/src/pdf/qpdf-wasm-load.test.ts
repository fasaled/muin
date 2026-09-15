import { describe, expect, test } from "bun:test";
import { joinOutput, type CreateQpdf, type QpdfFS, type QpdfModule } from "./qpdf-wasm.ts";
import { WasmQpdfAdapter } from "./qpdf-wasm.ts";
import { readFileSync } from "node:fs";

describe("joinOutput", () => {
  test("joins chunks without quadratic concat in the helper", () => {
    expect(joinOutput([])).toBe("");
    expect(joinOutput(["a", "b", "c"])).toBe("a\nb\nc");
  });
});

describe("WasmQpdfAdapter loadStructure", () => {
  test("reads structure JSON from the MEMFS output file", async () => {
    const files = new Map<string, Uint8Array>();
    const fixture = readFileSync(new URL("../../../../fixtures/json/minimal.json", import.meta.url));

    const create: CreateQpdf = async ({ printErr }) => {
      const FS: QpdfFS = {
        mkdir: () => undefined,
        writeFile: (path, data) => {
          files.set(path, data);
        },
        readFile: (path) => {
          const data = files.get(path);
          if (!data) throw new Error(`missing ${path}`);
          return data;
        },
        unlink: (path) => {
          files.delete(path);
        },
      };
      const module: QpdfModule = {
        FS,
        callMain: (args) => {
          if (args.includes("--is-encrypted")) {
            printErr("not encrypted");
            return 2;
          }
          const out = args.at(-1);
          if (out?.endsWith(".json")) {
            files.set(out, new Uint8Array(fixture));
            return 0;
          }
          return 0;
        },
      };
      return module;
    };

    const adapter = await WasmQpdfAdapter.create(create);
    const structure = await adapter.loadStructure("fixtures/pdf/minimal.pdf");
    expect(structure.objects["1 0 R"]?.value.kind).toBe("dict");
    expect(files.has("/work/structure.json")).toBe(false);
  });
});
