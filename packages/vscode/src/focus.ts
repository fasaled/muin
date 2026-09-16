import * as vscode from "vscode";
import { isPdfPath, pickFocusedPdf, writeFocusedPdfHint } from "./focus-path.ts";

export { isPdfPath, pickFocusedPdf, writeFocusedPdfHint };

export function tabInputFsPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  if (input instanceof vscode.TabInputText) return input.uri.fsPath;
  if (input instanceof vscode.TabInputCustom) return input.uri.fsPath;
  if (input instanceof vscode.TabInputNotebook) return input.uri.fsPath;
  if (input instanceof vscode.TabInputTextDiff) return input.modified.fsPath;
  return undefined;
}

export function focusedPdfFsPath(lastPdf: string | undefined): string | undefined {
  const tabFsPath = tabInputFsPath(vscode.window.tabGroups.activeTabGroup.activeTab?.input);
  const editorFsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
  return pickFocusedPdf({
    ...(tabFsPath === undefined ? {} : { tabFsPath }),
    ...(editorFsPath === undefined ? {} : { editorFsPath }),
    ...(lastPdf === undefined ? {} : { lastPdf }),
  });
}

export function focusedPdfHintFile(storageUri: vscode.Uri): string {
  return vscode.Uri.joinPath(storageUri, "focused-pdf").fsPath;
}
