import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
});
