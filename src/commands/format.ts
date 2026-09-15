import { formatRef, isArray, isDict, isStream, type PdfRef, type PdfValue } from "../pdf/model.ts";

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
    if (keys.length === 0) return "(empty dict)";
    return keys
      .map((k) => {
        const v = value.entries[k];
        return v === undefined ? k : `${k}  ${preview(v)}`;
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
