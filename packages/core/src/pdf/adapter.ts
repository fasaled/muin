import type { PdfRef, PdfStructure, PdfValue } from "./model.ts";

export type StreamMode = "raw" | "decoded";

export type CheckFinding = {
  severity: "error" | "warning" | "info";
  message: string;
};

export type CheckReport = {
  ok: boolean;
  findings: CheckFinding[];
};

export type PdfAdapter = {
  loadStructure(filePath: string, maxBytes?: number): Promise<PdfStructure>;
  getObject(ref: PdfRef): PdfValue;
  readStream(ref: PdfRef, mode: StreamMode): Promise<Uint8Array>;
  check(): Promise<CheckReport>;
};
