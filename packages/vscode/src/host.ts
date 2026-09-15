import {
  complete,
  formatBytes,
  TEXT_PREVIEW_MAX_CHARS,
  yieldToEventLoop,
  type CommandResult,
  type MuinSession,
  type Neighbors,
} from "@muin/core";

export const UI_GRAPH_MAX_NODES = 80;
// The overlay's #overlayBody scrolls (CSS overflow: auto), so this is a memory sanity cap, not a screen-space one.
export const UI_TEXT_MAX_CHARS = TEXT_PREVIEW_MAX_CHARS;

export type WebviewInbound = { type?: string; line?: string; ref?: string; cursor?: number };

export type HostState = {
  type: "state";
  fileName: string;
  cwd: string;
  path: string[];
  canBack: boolean;
  graph: unknown;
  ls: string;
  refs: string;
};

/** A one-line status/error, shown next to the input and replaced by the next outcome — never appended. */
export type HostLog = { type: "log"; log: string };

/** Result of any command other than cd/back: shown in a dismissible panel over the graph, not a growing log. */
export type HostOverlay = { type: "overlay"; title: string; body: string };

export type HostCompletions = { type: "completions"; items: string[]; replaceFrom: number };

export type HostOutbound = HostState | HostLog | HostOverlay | HostCompletions;

export function truncateOutput(text: string, max = UI_TEXT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[+${text.length - max} more chars]`;
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

/** cd/back are the only commands that move the current object — everything else is a query. */
export function isNavigationCommand(line: string): boolean {
  const cmd = line.trim().split(/\s+/)[0] ?? "";
  return cmd === "cd" || cmd === "back";
}

function fileNameOf(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

async function neighborRefs(session: MuinSession): Promise<string[]> {
  const res = await session.run("neighbors");
  if (res.kind !== "json") return [];
  const nb = res.value as Neighbors;
  return [...nb.incoming.entries, ...nb.outgoing.entries].map((e) => e.ref);
}

export async function snapshotState(session: MuinSession): Promise<HostState> {
  const graph = await session.run("export_graph --depth 2");
  await yieldToEventLoop();
  const ls = await session.run("ls");
  await yieldToEventLoop();
  const refs = await session.run("refs");
  const snap = session.snapshot();
  const cwd = `${snap.cwd.objectNumber} ${snap.cwd.generation} R`;
  const rawGraph = graph.kind === "json" ? graph.value : { nodes: [], edges: [] };
  // A ref-jump resets the path to just that ref (see graph/session.ts's cd()) — showing it
  // again next to cwd is pure duplication, not a breadcrumb, so drop it in that case.
  const path = snap.path.length === 1 && snap.path[0] === cwd ? [] : snap.path;
  return {
    type: "state",
    fileName: fileNameOf(session.filePath),
    cwd,
    path,
    canBack: snap.historyLength > 0,
    graph: trimGraphForUi(rawGraph, cwd),
    ls: ls.kind === "text" ? truncateOutput(ls.text, 4_000) : "",
    refs: refs.kind === "text" ? truncateOutput(refs.text, 4_000) : "",
  };
}

export async function handleWebviewMessage(session: MuinSession, msg: WebviewInbound): Promise<HostOutbound> {
  if (msg.type === "ready") {
    return snapshotState(session);
  }
  if (msg.type === "cd" && msg.ref) {
    await session.run(`cd ${msg.ref}`);
    return snapshotState(session);
  }
  if (msg.type === "run" && msg.line) {
    if (isNavigationCommand(msg.line)) {
      await session.run(msg.line);
      return snapshotState(session);
    }
    const result = await session.run(msg.line);
    return { type: "overlay", title: msg.line, body: formatPanelResult(result) };
  }
  if (msg.type === "complete" && msg.line !== undefined && typeof msg.cursor === "number") {
    const refs = await neighborRefs(session);
    const result = complete(msg.line, msg.cursor, { neighborRefs: refs });
    return { type: "completions", items: result.items, replaceFrom: result.replaceFrom };
  }
  return { type: "log", log: "" };
}
