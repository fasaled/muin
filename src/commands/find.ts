import { UsageError } from "../errors.ts";
import {
  dictGet,
  isStream,
  objectTypeName,
  type PdfDict,
  type PdfRef,
  type PdfValue,
} from "../pdf/model.ts";
import { getValue, type Session } from "../graph/session.ts";

export type WhereClause = {
  key: string;
  op: "==" | "!=" | ">" | "<";
  value: PdfValue;
};

export function parseWhere(expr: string): WhereClause[] {
  const parts = expr
    .split(/\s+(?:AND|&&)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new UsageError("empty --where expression");
  return parts.map(parseClause);
}

function parseClause(raw: string): WhereClause {
  const m = raw.match(/^(\/[\w.]+)\s*(==|!=|>|<)\s*(.+)$/);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new UsageError(`invalid --where clause: ${raw}`);
  }
  const op = m[2] as WhereClause["op"];
  return { key: m[1], op, value: parseLiteral(m[3].trim()) };
}

function parseLiteral(raw: string): PdfValue {
  if (raw === "null") return { kind: "null" };
  if (raw === "true") return { kind: "bool", value: true };
  if (raw === "false") return { kind: "bool", value: false };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { kind: "number", value: Number(raw) };
  if (raw.startsWith("/")) return { kind: "name", value: raw };
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return { kind: "string", value: raw.slice(1, -1) };
  }
  return { kind: "string", value: raw };
}

function valuesEqual(a: PdfValue | undefined, b: PdfValue): boolean {
  if (a === undefined) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "null":
      return true;
    case "bool":
    case "number":
    case "string":
    case "name":
      return a.value === (b as typeof a).value;
    default:
      return false;
  }
}

function numeric(value: PdfValue | undefined): number | undefined {
  return value?.kind === "number" ? value.value : undefined;
}

export function matchWhere(value: PdfValue, clauses: WhereClause[]): boolean {
  const dict: PdfDict | undefined = isStream(value)
    ? value.dict
    : value.kind === "dict"
      ? value
      : undefined;
  if (!dict) return false;
  for (const clause of clauses) {
    const left = dictGet(dict, clause.key);
    if (clause.op === "==") {
      if (!valuesEqual(left, clause.value)) return false;
    } else if (clause.op === "!=") {
      if (valuesEqual(left, clause.value)) return false;
    } else {
      const l = numeric(left);
      const r = numeric(clause.value);
      if (l === undefined || r === undefined) return false;
      if (clause.op === ">" && !(l > r)) return false;
      if (clause.op === "<" && !(l < r)) return false;
    }
  }
  return true;
}

export function matchType(value: PdfValue, type: string): boolean {
  const t = type.startsWith("/") ? type.slice(1) : type;
  if (t.toLowerCase() === value.kind) return true;
  return objectTypeName(value).toLowerCase() === t.toLowerCase();
}

export function findObjects(session: Session, type: string, where?: string): PdfRef[] {
  const clauses = where ? parseWhere(where) : [];
  const hits: PdfRef[] = [];
  for (const obj of Object.values(session.structure.objects)) {
    const value = getValue(session, obj.ref);
    if (!matchType(value, type)) continue;
    if (clauses.length > 0 && !matchWhere(value, clauses)) continue;
    hits.push(obj.ref);
  }
  return hits;
}
