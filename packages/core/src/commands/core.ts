import { NotFoundError, UsageError } from "../errors.ts";
import {
  TREE_DEFAULT_DEPTH,
  EXPORT_DEFAULT_DEPTH,
  assertExportNodeCount,
  clampExportDepth,
} from "../limits.ts";
import type { PdfAdapter } from "../pdf/adapter.ts";
import {
  dictGet,
  formatRef,
  isArray,
  isDict,
  isRef,
  isStream,
  parseRef,
  refKey,
  type PdfRef,
  type PdfValue,
} from "../pdf/model.ts";
import {
  back as sessionBack,
  cd as sessionCd,
  getValue,
  incoming,
  outgoingRefs,
  type Session,
} from "../graph/session.ts";
import { findObjects, matchWhere, parseWhere } from "./find.ts";
import { formatLocation, formatLs, formatRefList, formatValue, sanitizeQpdfMessage } from "./format.ts";
import { helpText } from "./help.ts";
import { parseCommand, type ParsedCommand } from "./parse.ts";

export type Result =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "quit" };

export type Outcome = {
  session: Session;
  result: Result;
};

function resolveRef(session: Session, token: string | undefined): PdfRef {
  if (token === undefined) return session.cwd;
  const parsed = parseRef(token);
  if (parsed) return parsed;
  return sessionCd(session, token).cwd;
}

export async function runLine(
  session: Session,
  line: string,
  adapter?: PdfAdapter,
): Promise<Outcome> {
  return runParsed(session, parseCommand(line), adapter);
}

export async function runParsed(
  session: Session,
  cmd: ParsedCommand,
  adapter?: PdfAdapter,
): Promise<Outcome> {
  switch (cmd.name) {
    case "help":
      return { session, result: { kind: "text", text: helpText(cmd.command) } };
    case "quit":
      return { session, result: { kind: "quit" } };
    case "pwd":
      return {
        session,
        result: {
          kind: "text",
          text: formatLocation(session),
        },
      };
    case "ls": {
      const ref = resolveRef(session, cmd.ref);
      return { session, result: { kind: "text", text: formatLs(getValue(session, ref)) } };
    }
    case "cat": {
      const ref = resolveRef(session, cmd.ref);
      return { session, result: { kind: "text", text: formatValue(getValue(session, ref)) } };
    }
    case "cd": {
      const next = sessionCd(session, cmd.target);
      return { session: next, result: { kind: "text", text: formatLocation(next) } };
    }
    case "back": {
      const next = sessionBack(session);
      return { session: next, result: { kind: "text", text: formatLocation(next) } };
    }
    case "refs": {
      const ref = resolveRef(session, cmd.ref);
      const text = [
        formatRefList("outgoing", outgoingRefs(session, ref)),
        formatRefList("incoming", incoming(session, ref)),
      ].join("\n");
      return { session, result: { kind: "text", text } };
    }
    case "find": {
      const refs = findObjects(session, cmd.type, cmd.where);
      const text = refs.length === 0 ? "(no matches)" : refs.map(formatRef).join("\n");
      return { session, result: { kind: "text", text } };
    }
    case "tree": {
      const start = cmd.ref ? resolveRef(session, cmd.ref) : pagesRoot(session);
      const depth = cmd.depth ?? TREE_DEFAULT_DEPTH;
      return { session, result: { kind: "text", text: formatTree(session, start, depth) } };
    }
    case "stream": {
      if (!adapter) throw new UsageError("stream requires a PDF adapter");
      const ref = resolveRef(session, cmd.ref);
      const bytes = await adapter.readStream(ref, cmd.mode);
      return { session, result: { kind: "bytes", bytes } };
    }
    case "check": {
      if (!adapter) throw new UsageError("check requires a PDF adapter");
      const report = await adapter.check();
      const dangling = danglingRefs(session);
      const lines = [
        ...report.findings.map((f) => `${f.severity}: ${sanitizeQpdfMessage(f.message, session.filePath)}`),
        ...dangling.map((r) => `warning: dangling reference ${formatRef(r)}`),
      ];
      if (lines.length === 0) lines.push("ok");
      return { session, result: { kind: "text", text: lines.join("\n") } };
    }
    case "export_graph": {
      const graph = exportGraph(session, cmd);
      return { session, result: { kind: "json", value: graph } };
    }
  }
}

function pagesRoot(session: Session): PdfRef {
  const catalog = getValue(session);
  const pages = isDict(catalog) ? dictGet(catalog, "/Pages") : undefined;
  if (pages && isRef(pages)) return pages.ref;
  return session.cwd;
}

function formatTree(session: Session, ref: PdfRef, depth: number, indent = 0): string {
  const pad = "  ".repeat(indent);
  const value = getValue(session, ref);
  const type = isDict(value) || isStream(value) ? dictGet(isStream(value) ? value.dict : value, "/Type") : undefined;
  const typeName = type && type.kind === "name" ? type.value : "";
  const line = `${pad}${formatRef(ref)} ${typeName}`.trimEnd();
  if (depth <= 0) return line;
  const dict = isStream(value) ? value.dict : value;
  const kids = isDict(dict) ? dictGet(dict, "/Kids") : undefined;
  if (!kids || !isArray(kids)) return line;
  const childLines = kids.items
    .filter(isRef)
    .map((item) => formatTree(session, item.ref, depth - 1, indent + 1));
  return [line, ...childLines].join("\n");
}

function danglingRefs(session: Session): PdfRef[] {
  const missing: PdfRef[] = [];
  const seen = new Set<string>();
  for (const obj of Object.values(session.structure.objects)) {
    for (const ref of outgoingRefs(session, obj.ref)) {
      const key = refKey(ref);
      if (session.structure.objects[key] === undefined && !seen.has(key)) {
        seen.add(key);
        missing.push(ref);
      }
    }
  }
  return missing;
}

function exportGraph(
  session: Session,
  cmd: Extract<ParsedCommand, { name: "export_graph" }>,
): { nodes: unknown[]; edges: unknown[] } {
  const nodeKeys = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  if (cmd.find) {
    const clauses = parseWhere(cmd.find);
    for (const obj of Object.values(session.structure.objects)) {
      if (matchWhere(getValue(session, obj.ref), clauses)) nodeKeys.add(refKey(obj.ref));
    }
    for (const key of nodeKeys) {
      const ref = parseRef(key);
      if (!ref) continue;
      for (const to of outgoingRefs(session, ref)) {
        const tk = refKey(to);
        if (nodeKeys.has(tk)) edges.push({ from: key, to: tk });
      }
    }
  } else {
    const start = cmd.from ? resolveRef(session, cmd.from) : session.cwd;
    const depth = clampExportDepth(cmd.depth ?? EXPORT_DEFAULT_DEPTH);
    const queue: { ref: PdfRef; d: number }[] = [{ ref: start, d: 0 }];
    const queued = new Set<string>([refKey(start)]);
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const key = refKey(item.ref);
      nodeKeys.add(key);
      if (item.d >= depth) continue;
      for (const to of outgoingRefs(session, item.ref)) {
        edges.push({ from: key, to: refKey(to) });
        const tk = refKey(to);
        if (!queued.has(tk) && session.structure.objects[tk]) {
          queued.add(tk);
          queue.push({ ref: to, d: item.d + 1 });
        }
      }
    }
  }

  assertExportNodeCount(nodeKeys.size);
  const nodes = [...nodeKeys].map((key) => {
    const ref = parseRef(key);
    if (!ref) return { ref: key };
    let value: PdfValue;
    try {
      value = getValue(session, ref);
    } catch (err) {
      if (err instanceof NotFoundError) return { ref: key, missing: true };
      throw err;
    }
    return { ref: key, kind: value.kind };
  });
  return { nodes, edges };
}
