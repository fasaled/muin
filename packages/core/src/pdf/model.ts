export type PdfRef = {
  objectNumber: number;
  generation: number;
};

export function refKey(ref: PdfRef): string {
  return `${ref.objectNumber} ${ref.generation} R`;
}

export function formatRef(ref: PdfRef): string {
  return refKey(ref);
}

const REF_RE = /^(\d+)\s+(\d+)\s+R$/;
const REF_COMMA_RE = /^(\d+)\s*,\s*(\d+)$/;
const REF_PAIR_RE = /^(\d+)\s+(\d+)$/;

export function parseRef(input: string): PdfRef | undefined {
  const s = input.trim();
  const m = REF_RE.exec(s) ?? REF_COMMA_RE.exec(s) ?? REF_PAIR_RE.exec(s);
  if (!m) return undefined;
  const objectNumber = Number(m[1]);
  const generation = Number(m[2]);
  if (!Number.isInteger(objectNumber) || !Number.isInteger(generation)) return undefined;
  return { objectNumber, generation };
}

export function refsEqual(a: PdfRef, b: PdfRef): boolean {
  return a.objectNumber === b.objectNumber && a.generation === b.generation;
}

export type PdfNull = { kind: "null" };
export type PdfBool = { kind: "bool"; value: boolean };
export type PdfNumber = { kind: "number"; value: number };
export type PdfString = { kind: "string"; value: string };
export type PdfName = { kind: "name"; value: string };
export type PdfRefValue = { kind: "ref"; ref: PdfRef };
export type PdfArray = { kind: "array"; items: PdfValue[] };
export type PdfDict = { kind: "dict"; entries: Record<string, PdfValue> };
export type PdfStream = { kind: "stream"; dict: PdfDict; length: number };

export type PdfScalar = PdfNull | PdfBool | PdfNumber | PdfString | PdfName | PdfRefValue;
export type PdfValue = PdfScalar | PdfArray | PdfDict | PdfStream;

export type PdfIndirectObject = {
  ref: PdfRef;
  value: PdfValue;
};

export type PdfStructure = {
  pdfVersion: string;
  trailer: PdfDict;
  objects: Record<string, PdfIndirectObject>;
};

export function isDict(value: PdfValue): value is PdfDict {
  return value.kind === "dict";
}

export function isArray(value: PdfValue): value is PdfArray {
  return value.kind === "array";
}

export function isStream(value: PdfValue): value is PdfStream {
  return value.kind === "stream";
}

export function isRef(value: PdfValue): value is PdfRefValue {
  return value.kind === "ref";
}

export function dictGet(dict: PdfDict, key: string): PdfValue | undefined {
  const k = key.startsWith("/") ? key : `/${key}`;
  return dict.entries[k];
}

export function nameEquals(value: PdfValue | undefined, expected: string): boolean {
  if (value === undefined || value.kind !== "name") return false;
  const n = expected.startsWith("/") ? expected : `/${expected}`;
  return value.value === n;
}

export function collectRefs(value: PdfValue, into: PdfRef[] = []): PdfRef[] {
  switch (value.kind) {
    case "ref":
      into.push(value.ref);
      break;
    case "array":
      for (const item of value.items) collectRefs(item, into);
      break;
    case "dict":
      for (const v of Object.values(value.entries)) collectRefs(v, into);
      break;
    case "stream":
      collectRefs(value.dict, into);
      break;
    default:
      break;
  }
  return into;
}

export function objectTypeName(value: PdfValue): string {
  if (value.kind === "stream") {
    const t = dictGet(value.dict, "/Type");
    if (t && t.kind === "name") return t.value.slice(1);
    return "Stream";
  }
  if (value.kind === "dict") {
    const t = dictGet(value, "/Type");
    if (t && t.kind === "name") return t.value.slice(1);
    return "Dict";
  }
  if (value.kind === "array") return "Array";
  if (value.kind === "name") return "Name";
  if (value.kind === "ref") return "Ref";
  return value.kind === "null" ? "Null" : value.kind === "bool" ? "Bool" : value.kind === "number" ? "Number" : "String";
}
