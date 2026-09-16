import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_STREAM_MAX_BYTES } from "../limits.ts";
import { bindSession } from "../session.ts";
import { fakeAdapter, fixturePath, minimalSession } from "../test/helpers.ts";
import { createMcpServer, MUIN_FOCUSED_PDF_FILE, readFocusedPdfPath } from "./server.ts";

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
        "focused",
        "help",
        "ls",
        "neighbors",
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

  test("focused reports the callback path", async () => {
    const { client, server } = await connect({ focusedPdf: () => "/tmp/in-focus.pdf" });
    const out = await client.callTool({ name: "focused", arguments: {} });
    expect(JSON.stringify(out.content)).toContain("/tmp/in-focus.pdf");
    await client.close();
    await server.close();
  });

  test("open without path uses the focused PDF", async () => {
    const opened: string[] = [];
    const { client, server } = await connect({
      focusedPdf: () => "/tmp/in-focus.pdf",
      openSession: async (path) => {
        opened.push(path);
        return bindSession(minimalSession(path), fakeAdapter());
      },
    });
    await client.callTool({ name: "open", arguments: {} });
    expect(opened.some((p) => p.endsWith("in-focus.pdf"))).toBe(true);
    await client.close();
    await server.close();
  });

  test("open without path fails when nothing is focused", async () => {
    const { client, server } = await connect({ openSession: fakeOpen() });
    const out = await client.callTool({ name: "open", arguments: {} });
    expect(JSON.stringify(out)).toMatch(/focused/i);
    await client.close();
    await server.close();
  });
});

describe("readFocusedPdfPath", () => {
  test("reads the hint file the VS Code extension writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "muin-focus-"));
    const file = join(dir, "focused-pdf");
    writeFileSync(file, "/abs/doc.pdf\n");
    expect(readFocusedPdfPath({ [MUIN_FOCUSED_PDF_FILE]: file })).toBe("/abs/doc.pdf");
  });

  test("empty hint file means nothing focused", () => {
    const dir = mkdtempSync(join(tmpdir(), "muin-focus-"));
    const file = join(dir, "focused-pdf");
    writeFileSync(file, "");
    expect(readFocusedPdfPath({ [MUIN_FOCUSED_PDF_FILE]: file })).toBeUndefined();
  });
});
