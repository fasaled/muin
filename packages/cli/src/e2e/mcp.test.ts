import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { vendorPaths } from "@muin/core";

const wasmReady = existsSync(vendorPaths().wasm);

describe.skipIf(!wasmReady)("MCP stdio process", () => {
  test("lists tools and answers pwd via the built CLI", async () => {
    const built = await Bun.spawn(["bun", "run", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    expect(built).toBe(0);

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (key.startsWith("BUN_")) continue;
      env[key] = value;
    }

    const transport = new StdioClientTransport({
      command: "node",
      args: ["packages/cli/dist/cli.js", "--mcp", "fixtures/pdf/minimal.pdf"],
      cwd: process.cwd(),
      stderr: "pipe",
      env,
    });
    const errChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    const client = new Client({ name: "muin-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("export_graph");
      const pwd = await client.callTool({ name: "pwd", arguments: {} });
      expect(JSON.stringify(pwd.content)).toContain("1 0 R");
    } catch (err) {
      const stderr = Buffer.concat(errChunks).toString();
      throw new Error(`${err instanceof Error ? err.message : String(err)}\nstderr:\n${stderr}`);
    } finally {
      await client.close();
    }
  });
});
