import { UsageError } from "../errors.ts";
import type { Session } from "../graph/session.ts";
import { BINARY_PREVIEW_MAX_BYTES, TEXT_PREVIEW_MAX_CHARS } from "../limits.ts";
import { formatRef, isArray, isDict, isStream, type PdfRef, type PdfValue } from "../pdf/model.ts";
import type { ParsedCommand } from "./parse.ts";

export function formatSnapshot(cwd: { objectNumber: number; generation: number }, path: string[]): string {
  const ref = formatRef(cwd);
  const trail = path.length > 0 ? path.join(" ") : "";
  // A ref-jump resets the path to just that ref (see graph/session.ts's cd()) — showing
  // it again after "·" is pure duplication, not a breadcrumb, so skip it in that case.
  if (trail.length === 0 || trail === ref) return ref;
  return `${ref}  ·  ${trail}`;
}

export function formatLocation(session: Session): string {
  return formatSnapshot(session.cwd, session.path);
}

export function formatValue(value: PdfValue, indent = 0, depth = 0): string {
  const pad = "  ".repeat(indent);
  if (depth > 4) return pad + "…";
  switch (value.kind) {
    case "null":
      return "null";
    case "bool":
      return String(value.value);
    case "number":
      return String(value.value);
    case "string":
      return JSON.stringify(value.value);
    case "name":
      return value.value;
    case "ref":
      return formatRef(value.ref);
    case "array": {
      if (value.items.length === 0) return "[]";
      const lines = value.items.map((item, i) => `${pad}  [${i}] ${formatValue(item, indent + 1, depth + 1)}`);
      return `[\n${lines.join("\n")}\n${pad}]`;
    }
    case "dict": {
      const keys = Object.keys(value.entries).sort();
      if (keys.length === 0) return "<< >>";
      const lines = keys.map((k) => {
        const v = value.entries[k];
        return `${pad}  ${k} ${v === undefined ? "" : formatValue(v, indent + 1, depth + 1)}`;
      });
      return `<<\n${lines.join("\n")}\n${pad}>>`;
    }
    case "stream":
      return `[stream length=${value.length}]\n${formatValue(value.dict, indent, depth)}`;
  }
}

export function formatLs(value: PdfValue): string {
  if (isStream(value)) {
    return `[stream]\n${formatLs(value.dict)}`;
  }
  if (isDict(value)) {
    const keys = Object.keys(value.entries).sort();
    if (keys.length === 0) return "[empty dictionary]";
    const width = Math.max(...keys.map((k) => k.length));
    return keys
      .map((k) => {
        const v = value.entries[k];
        return v === undefined ? k : `${k.padEnd(width)}  ${preview(v)}`;
      })
      .join("\n");
  }
  if (isArray(value)) {
    if (value.items.length === 0) return "[empty array]";
    return value.items.map((item, i) => `[${i}]  ${preview(item)}`).join("\n");
  }
  return preview(value);
}

// Square brackets mark a summary muin generated (not literal PDF content): [dict×2], [stream], (none).
// Real PDF tokens — names, refs, scalar values — are never bracketed.
function preview(value: PdfValue): string {
  switch (value.kind) {
    case "ref":
      return formatRef(value.ref);
    case "name":
      return value.value;
    case "string":
      return JSON.stringify(value.value);
    case "number":
    case "bool":
      return String(value.value);
    case "null":
      return "null";
    case "array":
      return `[array×${value.items.length}]`;
    case "dict":
      return `[dict×${Object.keys(value.entries).length}]`;
    case "stream":
      return `[stream length=${value.length}]`;
  }
}

export function formatRefList(label: string, refs: PdfRef[]): string {
  if (refs.length === 0) return `${label}: [none]`;
  return `${label}:\n${refs.map((r) => `  ${formatRef(r)}`).join("\n")}`;
}

// Decoded text pages through the UI's scroll, so its cap is generous; a hex dump of raw
// binary isn't useful reading past a few KB no matter how much scrolling is available.
export function formatBytes(bytes: Uint8Array): string {
  const n = bytes.byteLength;
  const head = `[stream]  ${n} byte${n === 1 ? "" : "s"}`;
  if (n === 0) return head;

  const textCap = Math.min(n, TEXT_PREVIEW_MAX_CHARS);
  const text = decodeUtf8Preview(bytes.subarray(0, textCap));
  if (text !== undefined) {
    const extra = n > textCap ? `\n[+${n - textCap} more bytes]` : "";
    return `${head}\n${text}${extra}`;
  }

  const binCap = Math.min(n, BINARY_PREVIEW_MAX_BYTES);
  const extra = n > binCap ? `\n[+${n - binCap} more bytes]` : "";
  return `${head}\n${hexdump(bytes.subarray(0, binCap))}${extra}`;
}

function decodeUtf8Preview(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function hexdump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.subarray(i, i + 16);
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

/**
 * Inverse of parseCommand, for display (journal lines, UI labels). The tokenizer has no
 * escape syntax, so a value containing both quote kinds (or an empty one) cannot be
 * represented — formatCommand throws UsageError there and callers fall back to cmd.name.
 */
export function formatCommand(cmd: ParsedCommand): string {
  switch (cmd.name) {
    case "ls":
    case "refs":
    case "cat":
    case "neighbors":
      return cmd.ref === undefined ? cmd.name : `${cmd.name} ${quoteToken(cmd.ref)}`;
    case "cd":
      return `cd ${quoteToken(cmd.target)}`;
    case "pwd":
    case "back":
    case "check":
    case "quit":
      return cmd.name;
    case "help":
      return cmd.command === undefined ? "help" : `help ${quoteToken(cmd.command)}`;
    case "stream": {
      const parts = ["stream", `--${cmd.mode}`];
      if (cmd.ref !== undefined) parts.push(quoteToken(cmd.ref));
      return parts.join(" ");
    }
    case "find": {
      const parts = ["find", "--type", quoteToken(cmd.type)];
      if (cmd.where !== undefined) parts.push("--where", quoteToken(cmd.where));
      return parts.join(" ");
    }
    case "tree": {
      const parts = ["tree"];
      if (cmd.depth !== undefined) parts.push("--depth", String(cmd.depth));
      if (cmd.ref !== undefined) parts.push(quoteToken(cmd.ref));
      return parts.join(" ");
    }
    case "export_graph": {
      const parts = ["export_graph"];
      if (cmd.from !== undefined) parts.push("--from", quoteToken(cmd.from));
      if (cmd.depth !== undefined) parts.push("--depth", String(cmd.depth));
      if (cmd.find !== undefined) parts.push("--find", quoteToken(cmd.find));
      return parts.join(" ");
    }
  }
}

function quoteToken(value: string): string {
  if (value.length > 0 && !/[\s"']/.test(value)) return value;
  if (value.length > 0 && !value.includes('"')) return `"${value}"`;
  if (value.length > 0 && !value.includes("'")) return `'${value}'`;
  throw new UsageError(`token cannot be quoted for a command line: ${JSON.stringify(value)}`);
}

export function sanitizeQpdfMessage(message: string, filePath: string): string {
  const name = filePath.replace(/^.*[/\\]/, "") || filePath;
  const argv1 = (process.argv[1] ?? "").replace(/^.*[/\\]/, "");
  let out = message.replaceAll("/work/input.pdf", name).replace(/\bthis\.program\b/g, "qpdf");
  if (argv1.length > 0) out = out.replaceAll(`${argv1}:`, "qpdf:");
  return out.replace(/^WARNING:\s*/i, "").replace(/^ERROR:\s*/i, "");
}
