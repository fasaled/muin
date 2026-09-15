import { basename } from "node:path";
import * as vscode from "vscode";
import { createSession, formatProcessError, type MuinSession } from "@muin/core";
import { handleWebviewMessage } from "./host.ts";
import { webviewHtml } from "./webview.ts";

const sessions = new Map<string, MuinSession>();
const panels = new Map<string, vscode.WebviewPanel>();

export function sessionFor(path: string): MuinSession | undefined {
  return sessions.get(path);
}

export function revealExplorer(pdfPath: string): boolean {
  const existing = panels.get(pdfPath);
  if (!existing) return false;
  existing.reveal(vscode.ViewColumn.Beside);
  return true;
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function openExplorer(context: vscode.ExtensionContext, pdfPath: string): Promise<void> {
  if (revealExplorer(pdfPath)) return;

  const panel = vscode.window.createWebviewPanel(
    "muin.explorer",
    `Muin: ${basename(pdfPath)}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    },
  );
  panels.set(pdfPath, panel);

  const vis = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "vis-network.min.js"));
  panel.webview.html = webviewHtml({
    visScript: vis.toString(),
    nonce: nonce(),
    cspSource: panel.webview.cspSource,
  });

  let session: MuinSession | undefined;
  const pending: { type?: string; line?: string; ref?: string }[] = [];
  let disposed = false;
  let chain = Promise.resolve();

  const enqueue = (fn: () => Promise<void>) => {
    chain = chain.then(fn, fn);
  };

  const handle = async (msg: { type?: string; line?: string; ref?: string }) => {
    if (!session) {
      pending.push(msg);
      return;
    }
    try {
      const out = await handleWebviewMessage(session, msg);
      if (!disposed) await panel.webview.postMessage(out);
    } catch (err) {
      if (!disposed) {
        await panel.webview.postMessage({ type: "log", log: `error: ${formatProcessError(err)}` });
      }
    }
  };

  panel.webview.onDidReceiveMessage((msg: { type?: string; line?: string; ref?: string }) => {
    enqueue(() => handle(msg));
  });

  panel.onDidDispose(() => {
    disposed = true;
    session?.close();
    sessions.delete(pdfPath);
    panels.delete(pdfPath);
  });

  context.subscriptions.push(panel);

  try {
    session = sessions.get(pdfPath) ?? (await createSession(pdfPath));
    if (disposed) {
      session.close();
      return;
    }
    sessions.set(pdfPath, session);
    const queuedMsgs = pending.splice(0);
    for (const msg of queuedMsgs) {
      enqueue(() => handle(msg));
    }
  } catch (err) {
    if (!disposed) {
      await panel.webview.postMessage({
        type: "log",
        log: `error: ${formatProcessError(err)}`,
      });
      panel.dispose();
    }
    throw err;
  }
}
