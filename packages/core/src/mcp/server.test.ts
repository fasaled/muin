import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { bindSession } from "../session.ts";
import { fakeAdapter, minimalSession } from "../test/helpers.ts";
import { createMcpServer } from "./server.ts";

async function connect() {
  const server = createMcpServer(bindSession(minimalSession(), fakeAdapter()));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "muin-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server", () => {
  test("lists command tools", async () => {
    const { client, server } = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "back",
        "cat",
        "cd",
        "check",
        "export_graph",
        "find",
        "help",
        "ls",
        "pwd",
        "refs",
        "stream",
        "tree",
      ].sort(),
    );
    await client.close();
    await server.close();
  });

  test("pwd, cd, and ls share session state", async () => {
    const { client, server } = await connect();
    const pwd = await client.callTool({ name: "pwd", arguments: {} });
    const pwdText = JSON.stringify(pwd.content);
    expect(pwdText).toContain("1 0 R");

    await client.callTool({ name: "cd", arguments: { target: "/Pages" } });
    const ls = await client.callTool({ name: "ls", arguments: {} });
    const lsText = JSON.stringify(ls.content);
    expect(lsText).toContain("/Kids");

    const graph = await client.callTool({ name: "export_graph", arguments: { depth: 1 } });
    const graphText = JSON.stringify(graph.content);
    expect(graphText).toContain("nodes");

    await client.close();
    await server.close();
  });
});
