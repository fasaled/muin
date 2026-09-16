import { basename } from "node:path";
import * as vscode from "vscode";
import { formatProcessError, MUIN_FOCUSED_PDF_FILE } from "@muin/core";
import { focusedPdfFsPath, focusedPdfHintFile, writeFocusedPdfHint } from "./focus.ts";
import { mcpStdioInvocation } from "./mcp-target.ts";
import { openExplorer, revealExplorer } from "./panel.ts";

let lastPdf: string | undefined;
let status: vscode.StatusBarItem | undefined;
let hintFile: string | undefined;

function publishFocused(): void {
  if (!hintFile) return;
  writeFocusedPdfHint(hintFile, focusedPdfFsPath(lastPdf));
}

export function activate(context: vscode.ExtensionContext): void {
  const storage = context.globalStorageUri ?? context.storageUri;
  if (storage) hintFile = focusedPdfHintFile(storage);

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.command = "muin.explorePdf";
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("muin.explorePdf", async (uri?: vscode.Uri) => {
      let picked = uri;
      if (!picked && lastPdf && revealExplorer(lastPdf)) {
        return;
      }
      if (!picked) {
        picked = (
          await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { PDF: ["pdf"] },
            title: "Open PDF in Muin",
            openLabel: "Explore",
          })
        )?.[0];
      }
      if (!picked) return;
      lastPdf = picked.fsPath;
      setStatus(lastPdf);
      publishFocused();
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Muin: opening ${basename(picked.fsPath)}…` },
          async () => openExplorer(context, picked.fsPath),
        );
      } catch (err) {
        lastPdf = undefined;
        setStatus(undefined);
        publishFocused();
        await vscode.window.showErrorMessage(`Muin could not open this PDF: ${formatProcessError(err)}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => publishFocused()),
    vscode.window.tabGroups.onDidChangeTabs(() => publishFocused()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => publishFocused()),
  );
  publishFocused();

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("muin.mcp", {
      provideMcpServerDefinitions: async () => [stdioDefinition(context)],
      resolveMcpServerDefinition: async (server) => {
        publishFocused();
        return server;
      },
    }),
  );
}

function setStatus(pdfPath: string | undefined): void {
  if (!status) return;
  if (!pdfPath) {
    status.hide();
    return;
  }
  status.text = `$(type-hierarchy) Muin: ${basename(pdfPath)}`;
  status.tooltip = "Reveal the Muin graph, or pick another PDF";
  status.show();
}

function stdioDefinition(context: vscode.ExtensionContext): vscode.McpStdioServerDefinition {
  const script = vscode.Uri.joinPath(context.extensionUri, "dist", "mcp-stdio.js").fsPath;
  const env: Record<string, string> = {};
  if (hintFile) env[MUIN_FOCUSED_PDF_FILE] = hintFile;
  const inv = mcpStdioInvocation(process.execPath, script, Object.keys(env).length > 0 ? env : undefined);
  return new vscode.McpStdioServerDefinition(inv.label, inv.command, inv.args, inv.env ?? {});
}

export function deactivate(): void {}
