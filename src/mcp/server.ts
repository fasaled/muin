import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runParsed, type Result } from "../commands/core.ts";
import type { ParsedCommand } from "../commands/parse.ts";
import type { PdfAdapter } from "../pdf/adapter.ts";
import type { Session } from "../graph/session.ts";

function asText(result: Result): string {
  if (result.kind === "text") return result.text;
  if (result.kind === "json") return JSON.stringify(result.value, null, 2);
  if (result.kind === "bytes") {
    return Buffer.from(result.bytes).toString("base64");
  }
  return "";
}

export async function startMcp(session: Session, adapter: PdfAdapter): Promise<void> {
  let current = session;
  const server = new McpServer({ name: "muin", version: "0.0.0" });

  const tool = (name: string, description: string, schema: z.ZodRawShape, toCmd: (args: Record<string, unknown>) => ParsedCommand) => {
    server.tool(name, description, schema, async (args) => {
      const out = await runParsed(current, toCmd(args as Record<string, unknown>), adapter);
      current = out.session;
      return { content: [{ type: "text" as const, text: asText(out.result) }] };
    });
  };

  const ref = z.string().optional();

  tool("ls", "List keys, indices, or stream metadata", { ref }, (a) =>
    a.ref ? { name: "ls", ref: String(a.ref) } : { name: "ls" },
  );
  tool("cd", "Change current object", { target: z.string() }, (a) => ({
    name: "cd",
    target: String(a.target),
  }));
  tool("pwd", "Show current object and path from /Root", {}, () => ({ name: "pwd" }));
  tool("back", "Return to the previous object", {}, () => ({ name: "back" }));
  tool("refs", "Outgoing and incoming references", { ref }, (a) =>
    a.ref ? { name: "refs", ref: String(a.ref) } : { name: "refs" },
  );
  tool("cat", "Show full object (stream header only)", { ref }, (a) =>
    a.ref ? { name: "cat", ref: String(a.ref) } : { name: "cat" },
  );
  tool(
    "stream",
    "Extract stream bytes (base64 in the tool result)",
    { ref: z.string(), mode: z.enum(["raw", "decoded"]).optional() },
    (a) => ({
      name: "stream",
      ref: String(a.ref),
      mode: a.mode === "raw" ? "raw" : "decoded",
    }),
  );
  tool(
    "find",
    "Search objects by type and optional where clause",
    { type: z.string(), where: z.string().optional() },
    (a) =>
      a.where
        ? { name: "find", type: String(a.type), where: String(a.where) }
        : { name: "find", type: String(a.type) },
  );
  tool(
    "tree",
    "Show the page tree",
    { ref, depth: z.number().int().optional() },
    (a) => ({
      name: "tree",
      ...(a.ref ? { ref: String(a.ref) } : {}),
      ...(typeof a.depth === "number" ? { depth: a.depth } : {}),
    }),
  );
  tool("check", "Structural validation", {}, () => ({ name: "check" }));
  tool(
    "export_graph",
    "Bounded subgraph as JSON (nodes + edges)",
    {
      from: z.string().optional(),
      depth: z.number().int().optional(),
      find: z.string().optional(),
    },
    (a) => ({
      name: "export_graph",
      ...(a.from ? { from: String(a.from) } : {}),
      ...(typeof a.depth === "number" ? { depth: a.depth } : {}),
      ...(a.find ? { find: String(a.find) } : {}),
    }),
  );
  tool("help", "Command help", { command: z.string().optional() }, (a) =>
    a.command ? { name: "help", command: String(a.command) } : { name: "help" },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
