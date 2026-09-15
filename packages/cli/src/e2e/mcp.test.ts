import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
});
