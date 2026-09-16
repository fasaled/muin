import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LimitError, vendorPaths } from "@muin/core";
import { resolveSessionWorker } from "./path.ts";
import { createWorkerSession } from "./client.ts";

describe("resolveSessionWorker", () => {
  test("finds the TypeScript worker next to this package", () => {
    const path = resolveSessionWorker();
    expect(path.endsWith("session-worker.ts") || path.endsWith("session-worker.js")).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});

const wasmReady = existsSync(vendorPaths().wasm);

describe.skipIf(!wasmReady)("createWorkerSession", () => {
  test("opens a PDF off the main thread and runs pwd", async () => {
    const session = await createWorkerSession("fixtures/pdf/minimal.pdf");
    try {
      const snap = session.snapshot();
      expect(snap.cwd.objectNumber).toBe(1);
      const pwd = await session.run("pwd");
      expect(pwd.kind).toBe("text");
      if (pwd.kind === "text") expect(pwd.text).toContain("1 0 R");
    } finally {
      session.close();
    }
  });

  test("propagates typed errors from the worker", async () => {
    await expect(createWorkerSession("fixtures/pdf/minimal.pdf", { maxBytes: 1 })).rejects.toThrow(LimitError);
  });

  const bundledWorker = join(process.cwd(), "packages/vscode/dist/session-worker.js");

  test.skipIf(!existsSync(bundledWorker))("opens a PDF with the VS Code bundled worker script", async () => {
    const session = await createWorkerSession("fixtures/pdf/minimal.pdf", { workerScript: bundledWorker });
    try {
      const pwd = await session.run("pwd");
      expect(pwd.kind).toBe("text");
      if (pwd.kind === "text") expect(pwd.text).toContain("1 0 R");
    } finally {
      session.close();
    }
  });

  test.skipIf(!existsSync(bundledWorker))("opens a PDF in a forked child process (VS Code isolation)", async () => {
    const session = await createWorkerSession("fixtures/pdf/minimal.pdf", {
      workerScript: bundledWorker,
      workerProcess: true,
    });
    try {
      const pwd = await session.run("pwd");
      expect(pwd.kind).toBe("text");
      if (pwd.kind === "text") expect(pwd.text).toContain("1 0 R");
    } finally {
      session.close();
    }
  });
});

describe("Node worker_threads (VS Code extension host)", () => {
  test("can load the TypeScript worker (strip-only, no parameter properties)", async () => {
    const proc = Bun.spawn(
      [
        "node",
        "-e",
        `const { Worker } = require("worker_threads");
const path = require("path");
const script = path.resolve(${JSON.stringify(join(process.cwd(), "packages/core/src/worker/session-worker.ts"))});
const worker = new Worker(script, { execArgv: [] });
worker.on("error", (err) => { console.error(err); process.exit(1); });
worker.on("message", (msg) => {
  if (!msg.ok) { console.error(msg.error); process.exit(1); }
  process.exit(0);
});
worker.postMessage({
  type: "open",
  id: 1,
  filePath: ${JSON.stringify(join(process.cwd(), "fixtures/pdf/minimal.pdf"))},
  options: {},
});
setTimeout(() => process.exit(2), 15000);`,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code, stderr).toBe(0);
  });
});
