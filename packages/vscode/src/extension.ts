import { basename } from "node:path";
import * as vscode from "vscode";
import { formatProcessError } from "@muin/core";
import { mcpStdioInvocation, shouldAdvertiseMcp } from "./mcp-target.ts";
import { openExplorer, revealExplorer } from "./panel.ts";

let lastPdf: string | undefined;
const mcpChange = new vscode.EventEmitter<void>();
let status: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
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
      mcpChange.fire();
      setStatus(lastPdf);
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Muin: opening ${basename(picked.fsPath)}…` },
          async () => openExplorer(context, picked.fsPath),
        );
      } catch (err) {
        lastPdf = undefined;
        mcpChange.fire();
        setStatus(undefined);
        await vscode.window.showErrorMessage(`Muin could not open this PDF: ${formatProcessError(err)}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("muin.mcp", {
      onDidChangeMcpServerDefinitions: mcpChange.event,
      provideMcpServerDefinitions: async () => {
        if (!shouldAdvertiseMcp(lastPdf) || lastPdf === undefined) return [];
        return [stdioDefinition(context, lastPdf)];
      },
      resolveMcpServerDefinition: async () => {
        if (!lastPdf) {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { PDF: ["pdf"] },
            title: "PDF for Muin (Copilot / MCP)",
            openLabel: "Use this PDF",
          });
          if (!picked?.[0]) return undefined;
          lastPdf = picked[0].fsPath;
          setStatus(lastPdf);
        }
        return stdioDefinition(context, lastPdf);
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

function stdioDefinition(context: vscode.ExtensionContext, pdfPath: string): vscode.McpStdioServerDefinition {
  const script = vscode.Uri.joinPath(context.extensionUri, "dist", "mcp-stdio.js").fsPath;
  const inv = mcpStdioInvocation(process.execPath, script, pdfPath);
  return new vscode.McpStdioServerDefinition(inv.label, inv.command, inv.args, {});
}

export function deactivate(): void {
  mcpChange.dispose();
}
