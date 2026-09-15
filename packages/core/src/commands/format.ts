import type { Session } from "../graph/session.ts";
import { formatRef, isArray, isDict, isStream, type PdfRef, type PdfValue } from "../pdf/model.ts";

export function formatSnapshot(cwd: { objectNumber: number; generation: number }, path: string[]): string {
  const trail = path.length > 0 ? path.join(" ") : "";
  return trail.length > 0 ? `${formatRef(cwd)}  ·  ${trail}` : formatRef(cwd);
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
      return `stream length=${value.length}\n${formatValue(value.dict, indent, depth)}`;
  }
}

export function formatLs(value: PdfValue): string {
  if (isStream(value)) {
    return `stream\n${formatLs(value.dict)}`;
  }
  if (isDict(value)) {
    const keys = Object.keys(value.entries).sort();
    if (keys.length === 0) return "(empty dictionary)";
    const width = Math.max(...keys.map((k) => k.length));
    return keys
      .map((k) => {
        const v = value.entries[k];
        return v === undefined ? k : `${k.padEnd(width)}  ${preview(v)}`;
      })
      .join("\n");
  }
  if (isArray(value)) {
    if (value.items.length === 0) return "(empty array)";
    return value.items.map((item, i) => `[${i}]  ${preview(item)}`).join("\n");
  }
  return preview(value);
}

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
      return `array[${value.items.length}]`;
    case "dict":
      return `dict[${Object.keys(value.entries).length}]`;
    case "stream":
      return `stream length=${value.length}`;
  }
}

export function formatRefList(label: string, refs: PdfRef[]): string {
  if (refs.length === 0) return `${label}: (none)`;
  return `${label}:\n${refs.map((r) => `  ${formatRef(r)}`).join("\n")}`;
}

export function formatBytes(bytes: Uint8Array, previewLimit = 256): string {
  const n = bytes.byteLength;
  const head = `stream  ${n} byte${n === 1 ? "" : "s"}`;
  if (n === 0) return head;
  const slice = bytes.subarray(0, previewLimit);
  const text = decodeUtf8Preview(slice);
  const extra = n > previewLimit ? `\n… ${n - previewLimit} more bytes` : "";
  if (text !== undefined) return `${head}\n${text}${extra}`;
  return `${head}\n${hexdump(slice)}${extra}`;
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

export function sanitizeQpdfMessage(message: string, filePath: string): string {
  const name = filePath.replace(/^.*[/\\]/, "") || filePath;
  const argv1 = (process.argv[1] ?? "").replace(/^.*[/\\]/, "");
  let out = message.replaceAll("/work/input.pdf", name).replace(/\bthis\.program\b/g, "qpdf");
  if (argv1.length > 0) out = out.replaceAll(`${argv1}:`, "qpdf:");
  return out.replace(/^WARNING:\s*/i, "").replace(/^ERROR:\s*/i, "");
}
