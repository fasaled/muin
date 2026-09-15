import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFileSize } from "../limits.ts";
import { CorruptPdfError, EncryptedPdfError } from "../errors.ts";
import type { CheckFinding, CheckReport, PdfAdapter, StreamMode } from "./adapter.ts";
import { parseQpdfJson } from "./qpdf-json.ts";
import { formatRef, refKey, type PdfRef, type PdfStructure, type PdfValue } from "./model.ts";
import { NotFoundError } from "../errors.ts";

export type QpdfModule = {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    mkdir: (path: string) => void;
    unlink: (path: string) => void;
  };
};

export type CreateQpdf = (opts: {
  noInitialRun: boolean;
  locateFile: (file: string) => string;
  print: (text: string) => void;
  printErr: (text: string) => void;
}) => Promise<QpdfModule>;

function vendorDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "vendor/qpdf");
    if (existsSync(join(candidate, "qpdf.wasm"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(fileURLToPath(import.meta.url)), "../../vendor/qpdf");
}

export function vendorPaths(): { js: string; wasm: string } {
  const dir = vendorDir();
  return { js: join(dir, "qpdf.mjs"), wasm: join(dir, "qpdf.wasm") };
}

export async function loadQpdfModule(create?: CreateQpdf): Promise<{
  module: QpdfModule;
  run: (args: string[]) => { status: number; stdout: string; stderr: string };
}> {
  const paths = vendorPaths();
  const factory =
    create ??
    ((await import(pathToFileURL(paths.js).href)) as { default: CreateQpdf }).default;

  let stdout = "";
  let stderr = "";
  const module = await factory({
    noInitialRun: true,
    locateFile: (file) => (file.endsWith(".wasm") ? paths.wasm : file),
    print: (text) => {
      stdout += text + "\n";
    },
    printErr: (text) => {
      stderr += text + "\n";
    },
  });

  const run = (args: string[]) => {
    stdout = "";
    stderr = "";
    let status = 0;
    try {
      status = module.callMain(args);
    } catch (err) {
      // emscripten may throw on non-zero exit
      const maybe = err as { status?: number };
      status = typeof maybe.status === "number" ? maybe.status : 1;
    }
    return { status, stdout, stderr };
  };

  return { module, run };
}

export class WasmQpdfAdapter implements PdfAdapter {
  private structure: PdfStructure | undefined;
  private inPath = "/input.pdf";

  constructor(
    private readonly loaded: Awaited<ReturnType<typeof loadQpdfModule>>,
  ) {}

  static async create(create?: CreateQpdf): Promise<WasmQpdfAdapter> {
    return new WasmQpdfAdapter(await loadQpdfModule(create));
  }

  async loadStructure(filePath: string, maxBytes?: number): Promise<PdfStructure> {
    const bytes = await readFile(filePath);
    assertFileSize(bytes.byteLength, maxBytes);
    try {
      this.loaded.module.FS.mkdir("/work");
    } catch {
      // already exists
    }
    this.inPath = "/work/input.pdf";
    this.loaded.module.FS.writeFile(this.inPath, bytes);

    const probe = this.loaded.run(["--is-encrypted", this.inPath]);
    const probeText = probe.stdout + probe.stderr;
    if (probe.status === 0 || /invalid password|encrypted/i.test(probeText)) {
      if (probe.status === 0 || /password/i.test(probeText)) {
        throw new EncryptedPdfError();
      }
    }

    const { stdout, stderr, status } = this.loaded.run([
      "--json=2",
      "--json-stream-data=none",
      this.inPath,
    ]);
    if (stdout.trim().length === 0) {
      if (/password|encrypt/i.test(stderr)) throw new EncryptedPdfError(stderr.trim());
      throw new CorruptPdfError(stderr.trim() || `qpdf exited ${status}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(stdout) as unknown;
    } catch {
      throw new CorruptPdfError("qpdf JSON was not parseable");
    }
    this.structure = parseQpdfJson(json);
    return this.structure;
  }

  getObject(ref: PdfRef): PdfValue {
    if (!this.structure) throw new NotFoundError("no PDF loaded");
    const obj = this.structure.objects[refKey(ref)];
    if (!obj) throw new NotFoundError(`no object ${formatRef(ref)}`);
    return obj.value;
  }

  async readStream(ref: PdfRef, mode: StreamMode): Promise<Uint8Array> {
    const id = `${ref.objectNumber},${ref.generation}`;
    const decode = mode === "decoded" ? "generalized" : "none";
    const { stdout, stderr } = this.loaded.run([
      "--json=2",
      `--json-object=${id}`,
      "--json-stream-data=inline",
      `--decode-level=${decode}`,
      this.inPath,
    ]);
    if (stdout.trim().length === 0) {
      throw new NotFoundError(stderr.trim() || `could not read stream ${formatRef(ref)}`);
    }
    const parsed = JSON.parse(stdout) as {
      qpdf?: [unknown, Record<string, { stream?: { data?: string } }>];
    };
    const objects = parsed.qpdf?.[1] ?? {};
    const key = `obj:${formatRef(ref)}`;
    const data = objects[key]?.stream?.data;
    if (typeof data !== "string") {
      throw new NotFoundError(`${formatRef(ref)} is not a stream or has no inline data`);
    }
    return Uint8Array.from(Buffer.from(data, "base64"));
  }

  async check(): Promise<CheckReport> {
    const { stdout, stderr, status } = this.loaded.run(["--check", this.inPath]);
    const text = `${stdout}\n${stderr}`;
    const findings: CheckFinding[] = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (/WARNING/i.test(t)) findings.push({ severity: "warning", message: t });
      else if (/ERROR/i.test(t)) findings.push({ severity: "error", message: t });
      else findings.push({ severity: "info", message: t });
    }
    return { ok: status === 0, findings };
  }
}
