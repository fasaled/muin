import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSession, type CommandResult, type MuinSession, type SessionOptions } from "../session.ts";
import type { ParsedCommand } from "../commands/parse.ts";
import { helpText } from "../commands/help.ts";
import { UsageError } from "../errors.ts";
import { MCP_STREAM_MAX_BYTES } from "../limits.ts";

function asText(result: CommandResult): string {
  if (result.kind === "text") return result.text;
  if (result.kind === "json") return JSON.stringify(result.value, null, 2);
  if (result.kind === "bytes") {
    const total = result.bytes.byteLength;
    if (total > MCP_STREAM_MAX_BYTES) {
      const b64 = Buffer.from(result.bytes.subarray(0, MCP_STREAM_MAX_BYTES)).toString("base64");
      return `base64 (${total} bytes, truncated to ${MCP_STREAM_MAX_BYTES})\n${b64}`;
    }
    const b64 = Buffer.from(result.bytes).toString("base64");
    return `base64 (${total} bytes)\n${b64}`;
  }
  return "";
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

export type McpServerOptions = {
  openSession?: (path: string, options?: SessionOptions) => Promise<MuinSession>;
  session?: MuinSession;
};

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const opener = options.openSession ?? createSession;
  let session: MuinSession | undefined = options.session;
  const server = new McpServer({ name: "muin", version: "0.0.0" });

  const requireSession = (): MuinSession => {
    if (!session) {
      throw new UsageError("no PDF is open; call the open tool first");
    }
    return session;
  };

  server.tool(
    "open",
    "Open a PDF and start a navigation session. Closes any PDF already open. Later tools (ls, cd, find, …) operate on this file until close.",
    { path: z.string(), maxBytes: z.number().positive().optional() },
    async (args) => {
      const filePath = resolve(String(args.path));
      session?.close();
      session = undefined;
      const opts: SessionOptions = args.maxBytes === undefined ? {} : { maxBytes: args.maxBytes };
      session = await opener(filePath, opts);
      const pwd = await session.run("pwd");
      return textResult(`opened ${session.filePath}\n${asText(pwd)}`);
    },
  );

  server.tool("close", "Close the current PDF session and free the worker. Safe if nothing is open.", {}, async () => {
    if (!session) return textResult("no PDF was open");
    session.close();
    session = undefined;
    return textResult("closed");
  });

  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    toCmd: (args: Record<string, unknown>) => ParsedCommand,
  ) => {
    server.tool(name, description, schema, async (args) => {
      const current = requireSession();
      const result = await current.runCommand(toCmd(args as Record<string, unknown>));
      return textResult(asText(result));
    });
  };

  const ref = z.string().optional();

  tool("ls", "List keys, array indices, or stream metadata of the current (or given) object", { ref }, (a) =>
    a.ref ? { name: "ls", ref: String(a.ref) } : { name: "ls" },
  );
  tool("cd", "Move to an object: 'O G R', 'O,G', a dict key (/Pages), or an array index", { target: z.string() }, (a) => ({
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
  server.tool("help", "Command help, including MCP open/close", { command: z.string().optional() }, async (args) => {
    const extra =
      "open   open a PDF by path (starts or replaces the session)\nclose  close the current PDF session";
    const cmd = args.command === undefined ? undefined : String(args.command);
    if (cmd === "open") return textResult("open  open a PDF by path and start a session (closes any previous PDF)");
    if (cmd === "close") return textResult("close  close the current PDF session");
    return textResult(`${helpText(cmd)}\n${cmd ? "" : extra}`.trim());
  });

  return server;
}

export type ServeMcpOptions = McpServerOptions & {
  initialPath?: string;
  maxBytes?: number;
};

export async function serveMcpStdio(options: ServeMcpOptions = {}): Promise<void> {
  const opener = options.openSession ?? createSession;
  let session = options.session;
  if (options.initialPath) {
    session = await opener(
      resolve(options.initialPath),
      options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes },
    );
  }
  const server = createMcpServer(session === undefined ? { openSession: opener } : { openSession: opener, session });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    const prev = server.server.onclose;
    server.server.onclose = () => {
      prev?.();
      resolve();
    };
  });
  await server.connect(transport);
  await closed;
}
