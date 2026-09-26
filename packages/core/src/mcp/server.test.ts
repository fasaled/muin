import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession } from "../graph/session.ts";
import { readJournal } from "../journal/reader.ts";
import { MCP_STREAM_MAX_BYTES } from "../limits.ts";
import { bindSession } from "../session.ts";
import { addStreamObject, fakeAdapter, fixturePath, loadMinimalStructure, minimalSession } from "../test/helpers.ts";
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
    const structure = loadMinimalStructure();
    addStreamObject(structure);
    const { client, server } = await connect({
      openSession: async () =>
        bindSession(openSession("minimal.pdf", structure), fakeAdapter({ readStream: async () => big })),
    });
    await client.callTool({ name: "open", arguments: { path: fixturePath("pdf", "minimal.pdf") } });
    const result = await client.callTool({ name: "stream", arguments: { ref: "4 0 R" } });
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

  test("journals every agent operation, but not the open tool's internal pwd", async () => {
    const events: { type: string; line?: string }[] = [];
    const journal = {
      record: (input: { type: string; line?: string }) => events.push(input),
      close: () => {},
    };
    const { client, server } = await connect({ openSession: fakeOpen(), journal });
    await client.callTool({ name: "open", arguments: { path: fixturePath("pdf", "minimal.pdf"), maxBytes: 1000 } });
    await client.callTool({ name: "cd", arguments: { target: "/Pages" } });
    await client.callTool({ name: "pwd", arguments: {} });
    await client.callTool({ name: "close", arguments: {} });

    expect(events.map((e) => (e.type === "cmd" ? `cmd:${e.line}` : e.type))).toEqual([
      "open",
      "cmd:cd /Pages",
      "cmd:pwd",
      "close",
    ]);
    await client.close();
    await server.close();
  });

  test("rotates the journal on every successful open when eventsPath is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muin-rotate-test-"));
    try {
      const journal = join(dir, "live.jsonl");
      const { client, server } = await connect({ openSession: fakeOpen(), eventsPath: journal });
      await client.callTool({ name: "open", arguments: { path: "/tmp/a.pdf" } });
      await client.callTool({ name: "cd", arguments: { target: "/Pages" } });
      await client.callTool({ name: "open", arguments: { path: "/tmp/b.pdf" } });
      await client.callTool({ name: "pwd", arguments: {} });

      const live = readJournal(journal).map((e) => (e.type === "cmd" ? `cmd:${e.line}` : e.type));
      expect(live).toEqual(["open", "cmd:pwd"]);

      const backups = readdirSync(dir).filter((f) => f !== "live.jsonl");
      expect(backups).toHaveLength(1);
      expect(backups[0]).toMatch(/^live-\d{8}-\d{6}\.jsonl$/);
      const old = readJournal(join(dir, backups[0] as string)).map((e) =>
        e.type === "cmd" ? `cmd:${e.line}` : e.type,
      );
      expect(old).toEqual(["open", "cmd:cd /Pages", "close"]);

      await client.close();
      await server.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
