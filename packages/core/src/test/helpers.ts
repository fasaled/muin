import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openSession, type Session } from "../graph/session.ts";
import type { CheckReport, PdfAdapter, StreamMode } from "../pdf/adapter.ts";
import type { PdfRef, PdfValue } from "../pdf/model.ts";
import { parseQpdfJson } from "../pdf/qpdf-json.ts";

export function fixturePath(...parts: string[]): string {
  return join(process.cwd(), "fixtures", ...parts);
}

export function loadMinimalStructure() {
  return parseQpdfJson(JSON.parse(readFileSync(fixturePath("json", "minimal.json"), "utf8")));
}

export function minimalSession(filePath = "minimal.pdf"): Session {
  return openSession(filePath, loadMinimalStructure());
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
