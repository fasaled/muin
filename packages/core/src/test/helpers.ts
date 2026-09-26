import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openSession, type Session } from "../graph/session.ts";
import type { CheckReport, PdfAdapter, StreamMode } from "../pdf/adapter.ts";
import { refKey, type PdfRef, type PdfStructure, type PdfValue } from "../pdf/model.ts";
import { parseQpdfJson } from "../pdf/qpdf-json.ts";

export function fixturePath(...parts: string[]): string {
  return join(process.cwd(), "fixtures", ...parts);
}

/**
 * The parsed minimal PDF. fixtures/json/minimal.json is not hand-written: regenerate it
 * from fixtures/pdf/minimal.pdf with `bun fixtures/regen-minimal-json.ts` (same qpdf
 * invocation as the adapter) and keep the two in sync — unit tests assume the real
 * document's numbering.
 */
export function loadMinimalStructure() {
  return parseQpdfJson(JSON.parse(readFileSync(fixturePath("json", "minimal.json"), "utf8")));
}

export function minimalSession(filePath = "minimal.pdf"): Session {
  return openSession(filePath, loadMinimalStructure());
}

/**
 * The minimal PDF has no streams. Attach a synthetic one for stream/find tests that
 * need a stream object; stream *bytes* still come from the (fake) adapter.
 */
export function addStreamObject(
  structure: PdfStructure,
  ref: PdfRef = { objectNumber: 4, generation: 0 },
  filter = "/FlateDecode",
): void {
  structure.objects[refKey(ref)] = {
    ref,
    value: {
      kind: "stream",
      dict: {
        kind: "dict",
        entries: {
          "/Length": { kind: "number", value: 10 },
          "/Filter": { kind: "name", value: filter },
        },
      },
      length: 10,
    },
  };
}

export function fakeAdapter(overrides: Partial<PdfAdapter> = {}): PdfAdapter {
  const structure = loadMinimalStructure();
  return {
    loadStructure: async () => structure,
    getObject: (ref: PdfRef): PdfValue => {
      const obj = structure.objects[`${ref.objectNumber} ${ref.generation} R`];
      if (!obj) throw new Error(`missing ${ref.objectNumber} ${ref.generation} R`);
      return obj.value;
    },
    readStream: async (_ref: PdfRef, _mode: StreamMode) => new Uint8Array([1, 2, 3, 4]),
    check: async (): Promise<CheckReport> => ({ ok: true, findings: [] }),
    ...overrides,
  };
}
