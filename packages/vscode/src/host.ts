import {
  complete,
  formatBytes,
  formatSnapshot,
  TEXT_PREVIEW_MAX_CHARS,
  yieldToEventLoop,
  type CommandResult,
  type MuinSession,
  type Neighbors,
} from "@muin/core";

// The overlay's #overlayBody scrolls (CSS overflow: auto), so this is a memory sanity cap, not a screen-space one.
export const UI_TEXT_MAX_CHARS = TEXT_PREVIEW_MAX_CHARS;

export type WebviewInbound = { type?: string; line?: string; ref?: string; cursor?: number };

export type HostState = {
  type: "state";
  fileName: string;
  cwd: string;
  path: string[];
  location: string;
  canBack: boolean;
  neighbors: Neighbors;
  ls: string;
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

/** cd/back are the only commands that move the current object — everything else is a query. */
export function isNavigationCommand(line: string): boolean {
  const cmd = line.trim().split(/\s+/)[0] ?? "";
  return cmd === "cd" || cmd === "back";
}

function fileNameOf(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

function emptyNeighbors(cwd: string): Neighbors {
  return {
    current: { ref: cwd },
    incoming: { entries: [], total: 0 },
    outgoing: { entries: [], total: 0 },
  };
}

function neighborsOf(result: CommandResult, cwd: string): Neighbors {
  if (result.kind !== "json" || result.value === null || typeof result.value !== "object") {
    return emptyNeighbors(cwd);
  }
  return result.value as Neighbors;
}

function neighborRefsOf(nb: Neighbors): string[] {
  return [...nb.incoming.entries, ...nb.outgoing.entries].map((e) => e.ref);
}

export async function snapshotState(session: MuinSession): Promise<HostState> {
  const nbRes = await session.run("neighbors");
  await yieldToEventLoop();
  const ls = await session.run("ls");
  const snap = session.snapshot();
  const cwd = `${snap.cwd.objectNumber} ${snap.cwd.generation} R`;
  const path = snap.path.length === 1 && snap.path[0] === cwd ? [] : snap.path;
  const neighbors = neighborsOf(nbRes, cwd);
  return {
    type: "state",
    fileName: fileNameOf(session.filePath),
    cwd,
    path,
    location: formatSnapshot(snap.cwd, path),
    canBack: snap.historyLength > 0,
    neighbors,
    ls: ls.kind === "text" ? truncateOutput(ls.text, 4_000) : "",
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
    const nbRes = await session.run("neighbors");
    const snap = session.snapshot();
    const cwd = `${snap.cwd.objectNumber} ${snap.cwd.generation} R`;
    const result = complete(msg.line, msg.cursor, {
      neighborRefs: neighborRefsOf(neighborsOf(nbRes, cwd)),
      extraCommands: ["history"],
    });
    return { type: "completions", items: result.items, replaceFrom: result.replaceFrom };
  }
  return { type: "log", log: "" };
}
