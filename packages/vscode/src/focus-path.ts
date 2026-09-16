import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function isPdfPath(p: string): boolean {
  return p.toLowerCase().endsWith(".pdf");
}

export function pickFocusedPdf(input: {
  tabFsPath?: string;
  editorFsPath?: string;
  lastPdf?: string;
}): string | undefined {
  if (input.tabFsPath && isPdfPath(input.tabFsPath)) return input.tabFsPath;
  if (input.editorFsPath && isPdfPath(input.editorFsPath)) return input.editorFsPath;
  return input.lastPdf;
}

export function writeFocusedPdfHint(file: string, pdfPath: string | undefined): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, pdfPath ?? "", "utf8");
}
