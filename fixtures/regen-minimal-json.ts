// Regenerates fixtures/json/minimal.json from fixtures/pdf/minimal.pdf using the
// exact qpdf invocation the adapter uses (see WasmQpdfAdapter.loadStructure).
// Run from the repo root: bun fixtures/regen-minimal-json.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadQpdfModule } from "../packages/core/src/pdf/qpdf-wasm.ts";

const root = new URL("..", import.meta.url).pathname;
const { module, run } = await loadQpdfModule();
module.FS.mkdir("/work");
module.FS.writeFile("/work/input.pdf", readFileSync(join(root, "fixtures/pdf/minimal.pdf")));
const { status, stderr } = run([
  "--json=2",
  "--json-stream-data=none",
  "--json-key=qpdf",
  "/work/input.pdf",
  "/work/structure.json",
]);
const raw = module.FS.readFile("/work/structure.json");
if (status !== 0 && raw.byteLength === 0) throw new Error(`qpdf failed: ${stderr}`);
const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
const out = join(root, "fixtures/json/minimal.json");
writeFileSync(out, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(`wrote ${out} (${raw.byteLength} raw bytes)`);
