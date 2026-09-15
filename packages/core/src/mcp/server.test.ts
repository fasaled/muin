import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { MCP_STREAM_MAX_BYTES } from "../limits.ts";
import { bindSession } from "../session.ts";
import { fakeAdapter, fixturePath, minimalSession } from "../test/helpers.ts";
import { createMcpServer } from "./server.ts";

async function connect(opts?: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "muin-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function fakeOpen() {
  return async () => bindSession(minimalSession(), fakeAdapter());
}

describe("MCP server", () => {
  test("lists open/close and query tools", async () => {
    const { client, server } = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "back",
        "cat",
        "cd",
        "check",
        "close",
        "export_graph",
        "find",
        "help",
        "ls",
        "open",
        "pwd",
        "refs",
        "stream",
        "tree",
      ].sort(),
    );
    await client.close();
    await server.close();
  });

  test("query tools fail before open", async () => {
    const { client, server } = await connect();
    const pwd = await client.callTool({ name: "pwd", arguments: {} });
    expect(JSON.stringify(pwd)).toMatch(/no PDF is open/i);
    await client.close();
    await server.close();
  });

  test("open then pwd/cd/ls then close", async () => {
    const { client, server } = await connect({ openSession: fakeOpen() });
    const opened = await client.callTool({ name: "open", arguments: { path: fixturePath("pdf", "minimal.pdf") } });
    expect(JSON.stringify(opened.content)).toContain("1 0 R");

    await client.callTool({ name: "cd", arguments: { target: "/Pages" } });
    const ls = await client.callTool({ name: "ls", arguments: {} });
    expect(JSON.stringify(ls.content)).toContain("/Kids");

    const closed = await client.callTool({ name: "close", arguments: {} });
    expect(JSON.stringify(closed.content)).toContain("closed");

    const pwd = await client.callTool({ name: "pwd", arguments: {} });
    expect(JSON.stringify(pwd)).toMatch(/no PDF is open/i);

    await client.close();
    await server.close();
  });

  test("open replaces a previous PDF", async () => {
    let opens = 0;
    const { client, server } = await connect({
      openSession: async () => {
        opens += 1;
        return bindSession(minimalSession(`doc-${opens}.pdf`), fakeAdapter());
      },
    });
    await client.callTool({ name: "open", arguments: { path: "/tmp/a.pdf" } });
    await client.callTool({ name: "open", arguments: { path: "/tmp/b.pdf" } });
    expect(opens).toBe(2);
    const pwd = await client.callTool({ name: "pwd", arguments: {} });
    expect(JSON.stringify(pwd.content)).toContain("1 0 R");
    await client.close();
    await server.close();
  });

  test("stream tool caps oversized bytes instead of dumping them all as base64", async () => {
    const big = new Uint8Array(MCP_STREAM_MAX_BYTES + 10);
    const { client, server } = await connect({
      openSession: async () =>
        bindSession(minimalSession(), fakeAdapter({ readStream: async () => big })),
    });
    await client.callTool({ name: "open", arguments: { path: fixturePath("pdf", "minimal.pdf") } });
    const result = await client.callTool({ name: "stream", arguments: { ref: "5 0 R" } });
    const text = JSON.stringify(result.content);
    expect(text).toContain("truncated");
    expect(text).toContain(String(big.byteLength));
    await client.close();
    await server.close();
  });

  test("close is idempotent", async () => {
    const { client, server } = await connect();
    const once = await client.callTool({ name: "close", arguments: {} });
    expect(JSON.stringify(once.content)).toContain("no PDF was open");
    await client.close();
    await server.close();
  });
});
