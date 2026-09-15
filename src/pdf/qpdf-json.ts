import { CorruptPdfError, EncryptedPdfError } from "../errors.ts";
import { assertObjectCount } from "../limits.ts";
import {
  parseRef,
  type PdfDict,
  type PdfIndirectObject,
  type PdfRef,
  type PdfStructure,
  type PdfValue,
  refKey,
} from "./model.ts";

const OBJ_KEY = /^obj:(\d+)\s+(\d+)\s+R$/;

export function parseQpdfJson(input: unknown, maxObjects?: number): PdfStructure {
  if (typeof input !== "object" || input === null || !("qpdf" in input)) {
    throw new CorruptPdfError("qpdf JSON is missing the qpdf key");
  }
  const qpdf = (input as { qpdf: unknown }).qpdf;
  if (!Array.isArray(qpdf) || qpdf.length < 2) {
    throw new CorruptPdfError("qpdf JSON qpdf array is malformed");
  }
  const header = qpdf[0];
  const objectsRaw = qpdf[1];
  if (typeof header !== "object" || header === null || typeof objectsRaw !== "object" || objectsRaw === null) {
    throw new CorruptPdfError("qpdf JSON header or objects dictionary is malformed");
  }

  const pdfVersion =
    "pdfversion" in header && typeof header.pdfversion === "string" ? header.pdfversion : "unknown";

  const objects: Record<string, PdfIndirectObject> = {};
  let trailer: PdfDict | undefined;

  for (const [key, raw] of Object.entries(objectsRaw as Record<string, unknown>)) {
    if (key === "trailer") {
      trailer = asDict(parseObjectWrapper(raw), "trailer");
      continue;
    }
    const m = OBJ_KEY.exec(key);
    if (!m) continue;
    const ref: PdfRef = { objectNumber: Number(m[1]), generation: Number(m[2]) };
    const value = parseObjectWrapper(raw);
    objects[refKey(ref)] = { ref, value };
  }

  assertObjectCount(Object.keys(objects).length, maxObjects);

  if (trailer === undefined) {
    throw new CorruptPdfError("qpdf JSON is missing the trailer");
  }
  if (trailer.entries["/Encrypt"] !== undefined) {
    throw new EncryptedPdfError();
  }

  return { pdfVersion, trailer, objects };
}

function parseObjectWrapper(raw: unknown): PdfValue {
  if (typeof raw !== "object" || raw === null) {
    throw new CorruptPdfError("object wrapper is not an object");
  }
  if ("stream" in raw) {
    const stream = (raw as { stream: unknown }).stream;
    if (typeof stream !== "object" || stream === null) {
      throw new CorruptPdfError("stream wrapper is malformed");
    }
    const dictRaw = "dict" in stream ? (stream as { dict: unknown }).dict : {};
    const dict = asDict(parseValue(dictRaw), "stream dict");
    const lengthVal = dict.entries["/Length"];
    const length = lengthVal?.kind === "number" ? lengthVal.value : 0;
    return { kind: "stream", dict, length };
  }
  if ("value" in raw) {
    return parseValue((raw as { value: unknown }).value);
  }
  return parseValue(raw);
}

function parseValue(raw: unknown): PdfValue {
  if (raw === null) return { kind: "null" };
  if (typeof raw === "boolean") return { kind: "bool", value: raw };
  if (typeof raw === "number") return { kind: "number", value: raw };
  if (typeof raw === "string") return parseString(raw);
  if (Array.isArray(raw)) {
    return { kind: "array", items: raw.map(parseValue) };
  }
  if (typeof raw === "object") {
    const entries: Record<string, PdfValue> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      entries[k] = parseValue(v);
    }
    return { kind: "dict", entries };
  }
  throw new CorruptPdfError(`unsupported JSON value type: ${typeof raw}`);
}

function parseString(raw: string): PdfValue {
  const ref = parseRef(raw);
  if (ref && /^\d+\s+\d+\s+R$/.test(raw.trim())) {
    return { kind: "ref", ref };
  }
  if (raw.startsWith("/")) {
    return { kind: "name", value: raw };
  }
  if (raw.startsWith("u:")) {
    return { kind: "string", value: raw.slice(2) };
  }
  if (raw.startsWith("b:")) {
    return { kind: "string", value: raw.slice(2) };
  }
  return { kind: "string", value: raw };
}

function asDict(value: PdfValue, label: string): PdfDict {
  if (value.kind !== "dict") {
    throw new CorruptPdfError(`${label} is not a dictionary`);
  }
  return value;
}
