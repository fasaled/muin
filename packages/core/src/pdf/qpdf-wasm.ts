import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFileSize, assertJsonSize } from "../limits.ts";
import { wrapIoError } from "../process-error.ts";
import { CorruptPdfError, EncryptedPdfError } from "../errors.ts";
import type { CheckFinding, CheckReport, PdfAdapter, StreamMode } from "./adapter.ts";
import { parseQpdfJson } from "./qpdf-json.ts";
import { formatRef, refKey, type PdfRef, type PdfStructure, type PdfValue } from "./model.ts";
import { NotFoundError } from "../errors.ts";
import { yieldToEventLoop } from "../yield.ts";

export type QpdfFS = {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
  mkdir: (path: string) => void;
  unlink: (path: string) => void;
};

export type QpdfModule = {
  callMain: (args: string[]) => number;
  FS: QpdfFS;
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

export function joinOutput(chunks: string[]): string {
  if (chunks.length === 0) return "";
  return chunks.join("\n");
}

export async function loadQpdfModule(create?: CreateQpdf): Promise<{
  module: QpdfModule;
  run: (args: string[]) => { status: number; stdout: string; stderr: string };
}> {
  const paths = vendorPaths();
  const factory =
    create ??
    ((await import(pathToFileURL(paths.js).href)) as { default: CreateQpdf }).default;

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const module = await factory({
    noInitialRun: true,
    locateFile: (file) => (file.endsWith(".wasm") ? paths.wasm : file),
    print: (text) => {
      stdoutChunks.push(text);
    },
    printErr: (text) => {
      stderrChunks.push(text);
    },
  });

  const run = (args: string[]) => {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    let status = 0;
    try {
      status = module.callMain(args);
    } catch (err) {
      const maybe = err as { status?: number };
      status = typeof maybe.status === "number" ? maybe.status : 1;
    }
    return {
      status,
      stdout: joinOutput(stdoutChunks),
      stderr: joinOutput(stderrChunks),
    };
  };

  return { module, run };
}

function ensureDir(fs: QpdfFS, path: string): void {
  try {
    fs.mkdir(path);
  } catch {
    // already exists
  }
}

function tryUnlink(fs: QpdfFS, path: string): void {
  try {
    fs.unlink(path);
  } catch {
    // missing
  }
}

function tryReadFile(fs: QpdfFS, path: string): Uint8Array | undefined {
  try {
    return fs.readFile(path);
  } catch {
    return undefined;
  }
}

export class WasmQpdfAdapter implements PdfAdapter {
  private structure: PdfStructure | undefined;
  private inPath = "/work/input.pdf";

  constructor(
    private readonly loaded: Awaited<ReturnType<typeof loadQpdfModule>>,
  ) {}

  static async create(create?: CreateQpdf): Promise<WasmQpdfAdapter> {
    return new WasmQpdfAdapter(await loadQpdfModule(create));
  }

  async loadStructure(filePath: string, maxBytes?: number): Promise<PdfStructure> {
    const info = await stat(filePath).catch((err) => {
      throw wrapIoError(err, filePath);
    });
    assertFileSize(info.size, maxBytes);

    let bytes: Buffer | undefined;
    try {
      bytes = await readFile(filePath);
    } catch (err) {
      throw wrapIoError(err, filePath);
    }

    const fs = this.loaded.module.FS;
    ensureDir(fs, "/work");
    this.inPath = "/work/input.pdf";
    fs.writeFile(this.inPath, bytes);
    bytes = undefined;
    await yieldToEventLoop();

    const probe = this.loaded.run(["--is-encrypted", this.inPath]);
    const probeText = probe.stdout + probe.stderr;
    if (probe.status === 0 || /invalid password|encrypted/i.test(probeText)) {
      if (probe.status === 0 || /password/i.test(probeText)) {
        throw new EncryptedPdfError();
      }
    }

    const jsonPath = "/work/structure.json";
    tryUnlink(fs, jsonPath);
    const { stdout, stderr, status } = this.loaded.run([
      "--json=2",
      "--json-stream-data=none",
      "--json-key=qpdf",
      this.inPath,
      jsonPath,
    ]);
    await yieldToEventLoop();

    let jsonBytes = tryReadFile(fs, jsonPath);
    tryUnlink(fs, jsonPath);

    if (!jsonBytes || jsonBytes.byteLength === 0) {
      if (stdout.trim().length === 0) {
        if (/password|encrypt/i.test(stderr)) throw new EncryptedPdfError(stderr.trim());
        throw new CorruptPdfError(stderr.trim() || `qpdf exited ${status}`);
      }
      jsonBytes = new TextEncoder().encode(stdout);
    }

    assertJsonSize(jsonBytes.byteLength);
    let jsonText = new TextDecoder("utf8").decode(jsonBytes);
    jsonBytes = new Uint8Array();
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText) as unknown;
    } catch {
      throw new CorruptPdfError("qpdf JSON was not parseable");
    }
    jsonText = "";
    await yieldToEventLoop();
    this.structure = parseQpdfJson(raw);
    raw = null;
    return this.structure;
  }

  getObject(ref: PdfRef): PdfValue {
    if (!this.structure) throw new NotFoundError("no PDF loaded");
    const obj = this.structure.objects[refKey(ref)];
    if (!obj) throw new NotFoundError(`no object ${formatRef(ref)}`);
    return obj.value;
  }

  async readStream(ref: PdfRef, mode: StreamMode): Promise<Uint8Array> {
    const fs = this.loaded.module.FS;
    const id = `${ref.objectNumber},${ref.generation}`;
    const decode = mode === "decoded" ? "generalized" : "none";
    const jsonPath = "/work/one.json";
    tryUnlink(fs, jsonPath);
    const { stdout, stderr } = this.loaded.run([
      "--json=2",
      `--json-object=${id}`,
      "--json-stream-data=inline",
      `--decode-level=${decode}`,
      "--json-key=qpdf",
      this.inPath,
      jsonPath,
    ]);
    let jsonBytes = tryReadFile(fs, jsonPath);
    tryUnlink(fs, jsonPath);
    const text =
      jsonBytes && jsonBytes.byteLength > 0 ? new TextDecoder("utf8").decode(jsonBytes) : stdout;
    if (text.trim().length === 0) {
      throw new NotFoundError(stderr.trim() || `could not read stream ${formatRef(ref)}`);
    }
    const parsed = JSON.parse(text) as {
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
