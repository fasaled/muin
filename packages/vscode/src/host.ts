import { formatBytes, yieldToEventLoop, type CommandResult, type MuinSession } from "@muin/core";

export const UI_GRAPH_MAX_NODES = 80;
export const UI_TEXT_MAX_CHARS = 8_000;

export type WebviewInbound = { type?: string; line?: string; ref?: string };

export type HostState = {
  type: "state";
  fileName: string;
  cwd: string;
  path: string[];
  canBack: boolean;
  graph: unknown;
  ls: string;
  refs: string;
  log: string;
};

export type HostLog = { type: "log"; log: string };

export type HostOutbound = HostState | HostLog;

export function truncateOutput(text: string, max = UI_TEXT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated ${text.length - max} characters`;
}

export function formatPanelResult(result: CommandResult): string {
  if (result.kind === "text") return truncateOutput(result.text);
  if (result.kind === "json") return truncateOutput(JSON.stringify(result.value, null, 2));
  if (result.kind === "bytes") return formatBytes(result.bytes);
  return "";
}

export type GraphPayload = { nodes: { ref: string; kind?: string }[]; edges: { from: string; to: string }[] };

export function trimGraphForUi(graph: unknown, cwd: string, maxNodes = UI_GRAPH_MAX_NODES): GraphPayload {
  const raw = graph as { nodes?: { ref: string; kind?: string }[]; edges?: { from: string; to: string }[] };
  const nodes = raw.nodes ?? [];
  const edges = raw.edges ?? [];
  if (nodes.length <= maxNodes) {
    return { nodes, edges };
  }
  const byId = new Map(nodes.map((n) => [n.ref, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
    const back = adj.get(e.to) ?? [];
    back.push(e.from);
    adj.set(e.to, back);
  }
  const keep = new Set<string>();
  const queue = [cwd];
  if (byId.has(cwd)) keep.add(cwd);
  else if (nodes[0]) {
    keep.add(nodes[0].ref);
    queue[0] = nodes[0].ref;
  }
  while (queue.length > 0 && keep.size < maxNodes) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const next of adj.get(id) ?? []) {
      if (keep.has(next)) continue;
      keep.add(next);
      queue.push(next);
      if (keep.size >= maxNodes) break;
    }
  }
  const keptNodes = nodes.filter((n) => keep.has(n.ref));
  const keptEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes: keptNodes, edges: keptEdges };
}

export function graphMutates(line: string): boolean {
  const cmd = line.trim().split(/\s+/)[0] ?? "";
  return cmd === "cd" || cmd === "back" || cmd === "find" || cmd === "export_graph";
}

function fileNameOf(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

export async function snapshotState(session: MuinSession, log = ""): Promise<HostState> {
  const graph = await session.run("export_graph --depth 2");
  await yieldToEventLoop();
  const ls = await session.run("ls");
  await yieldToEventLoop();
  const refs = await session.run("refs");
  const snap = session.snapshot();
  const cwd = `${snap.cwd.objectNumber} ${snap.cwd.generation} R`;
  const rawGraph = graph.kind === "json" ? graph.value : { nodes: [], edges: [] };
  return {
    type: "state",
    fileName: fileNameOf(session.filePath),
    cwd,
    path: snap.path,
    canBack: snap.historyLength > 0,
    graph: trimGraphForUi(rawGraph, cwd),
    ls: ls.kind === "text" ? truncateOutput(ls.text, 4_000) : "",
    refs: refs.kind === "text" ? truncateOutput(refs.text, 4_000) : "",
    log,
  };
}

export async function handleWebviewMessage(session: MuinSession, msg: WebviewInbound): Promise<HostOutbound> {
  if (msg.type === "ready") {
    return snapshotState(session, `opened ${fileNameOf(session.filePath)}`);
  }
  if (msg.type === "cd" && msg.ref) {
    const result = await session.run(`cd ${msg.ref}`);
    return snapshotState(session, formatPanelResult(result));
  }
  if (msg.type === "run" && msg.line) {
    const result = await session.run(msg.line);
    const text = formatPanelResult(result);
    if (graphMutates(msg.line)) return snapshotState(session, text);
    return { type: "log", log: text };
  }
  return { type: "log", log: "" };
}
