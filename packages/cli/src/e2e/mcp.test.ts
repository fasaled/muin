import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vendorPaths } from "@muin/core";

const wasmReady = existsSync(vendorPaths().wasm);

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("BUN_")) continue;
    out[key] = value;
  }
  return out;
}

describe.skipIf(!wasmReady)("MCP stdio process", () => {
  test("starts without a PDF; open then pwd then close", async () => {
    const built = await Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    expect(built).toBe(0);

    const transport = new StdioClientTransport({
      command: "node",
      args: ["packages/cli/dist/cli.js", "--mcp"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: env(),
    });
    const errChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    const client = new Client({ name: "muin-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("open");
      const before = await client.callTool({ name: "pwd", arguments: {} });
      expect(JSON.stringify(before)).toMatch(/no PDF is open/i);

      const opened = await client.callTool({
        name: "open",
        arguments: { path: "fixtures/pdf/minimal.pdf" },
      });
      expect(JSON.stringify(opened.content)).toContain("1 0 R");

      const pwd = await client.callTool({ name: "pwd", arguments: {} });
      expect(JSON.stringify(pwd.content)).toContain("1 0 R");

      const closed = await client.callTool({ name: "close", arguments: {} });
      expect(JSON.stringify(closed.content)).toContain("closed");
    } catch (err) {
      const stderr = Buffer.concat(errChunks).toString();
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nstderr:\n${stderr}`);
    } finally {
      await client.close();
    }
  });

  test("--events journals every agent operation to the journal file", async () => {
    const built = await Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    expect(built).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), "muin-events-e2e-"));
    const journal = join(dir, "live.jsonl");
    const transport = new StdioClientTransport({
      command: "node",
      args: ["packages/cli/dist/cli.js", "--mcp", "--events", journal],
      cwd: process.cwd(),
      stderr: "pipe",
      env: env(),
    });
    const errChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    const client = new Client({ name: "muin-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      await client.callTool({ name: "open", arguments: { path: "fixtures/pdf/minimal.pdf" } });
      await client.callTool({ name: "cd", arguments: { target: "/Pages" } });
    } catch (err) {
      const stderr = Buffer.concat(errChunks).toString();
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nstderr:\n${stderr}`);
    } finally {
      await client.close();
    }

    const events = readFileSync(journal, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { v: number; type: string; line?: string; ok?: boolean; snapshot?: { cwd: unknown } });
    expect(events.map((e) => (e.type === "cmd" ? `cmd:${e.line}` : e.type))).toEqual(["open", "cmd:cd /Pages"]);
    expect(events.every((e) => e.v === 1)).toBe(true);
    const cd = events[1];
    expect(cd?.ok).toBe(true);
    expect(cd?.snapshot?.cwd).toEqual({ objectNumber: 2, generation: 0 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("--events rotates the journal on open, not on server startup", async () => {
    const built = await Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    expect(built).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), "muin-rotate-e2e-"));
    const journal = join(dir, "live.jsonl");
    writeFileSync(journal, '{"v":1,"ts":1,"type":"close"}\n');
    const transport = new StdioClientTransport({
      command: "node",
      args: ["packages/cli/dist/cli.js", "--mcp", "--events", journal],
      cwd: process.cwd(),
      stderr: "pipe",
      env: env(),
    });
    const errChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    const client = new Client({ name: "muin-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      // Connecting alone must not rotate: only opening a PDF starts a new journal.
      await Bun.sleep(200);
      expect(readdirSync(dir)).toEqual(["live.jsonl"]);

      await client.callTool({ name: "open", arguments: { path: "fixtures/pdf/minimal.pdf" } });
      await client.callTool({ name: "pwd", arguments: {} });
    } catch (err) {
      const stderr = Buffer.concat(errChunks).toString();
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nstderr:\n${stderr}`);
    } finally {
      await client.close();
    }

    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    const backup = files.find((f) => f !== "live.jsonl") ?? "";
    expect(backup).toMatch(/^live-\d{8}-\d{6}\.jsonl$/);
    expect(readFileSync(join(dir, backup), "utf8")).toContain('"type":"close"');

    const fresh = readFileSync(journal, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; line?: string });
    expect(fresh.map((e) => (e.type === "cmd" ? `cmd:${e.line}` : e.type))).toEqual(["open", "cmd:pwd"]);
    expect(Buffer.concat(errChunks).toString()).toContain("rotated previous journal");
    rmSync(dir, { recursive: true, force: true });
  });
});
