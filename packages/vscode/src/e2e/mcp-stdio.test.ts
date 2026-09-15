import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { vendorPaths } from "@muin/core";

const wasmReady = existsSync(vendorPaths().wasm);
const script = join(process.cwd(), "packages/vscode/dist/mcp-stdio.js");

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith("BUN_")) continue;
    out[key] = value;
  }
  return out;
}

describe.skipIf(!wasmReady)("VS Code bundled MCP stdio", () => {
  test("connects with no PDF, then open / pwd / close", async () => {
    const built = await Bun.spawn(["bun", "run", "--filter", "muin", "build"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    }).exited;
    expect(built).toBe(0);
    expect(existsSync(script)).toBe(true);

    const transport = new StdioClientTransport({
      command: "node",
      args: [script],
      cwd: process.cwd(),
      stderr: "pipe",
      env: env(),
    });
    const errChunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    const client = new Client({ name: "muin-vscode-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("open");
      await client.callTool({ name: "open", arguments: { path: "fixtures/pdf/minimal.pdf" } });
      const pwd = await client.callTool({ name: "pwd", arguments: {} });
      expect(JSON.stringify(pwd.content)).toContain("1 0 R");
      await client.callTool({ name: "close", arguments: {} });
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\nstderr:\n${Buffer.concat(errChunks).toString()}`,
      );
    } finally {
      await client.close();
    }
  });
});
