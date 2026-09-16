import { existsSync } from "node:fs";
import { basename } from "node:path";
import * as vscode from "vscode";
import { createSession, formatProcessError, type MuinSession } from "@muin/core";
import { handleWebviewMessage, type WebviewInbound } from "./host.ts";
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
    },
  );
  panels.set(pdfPath, panel);

  panel.webview.html = webviewHtml({
    nonce: nonce(),
    cspSource: panel.webview.cspSource,
  });

  let session: MuinSession | undefined;
  const pending: WebviewInbound[] = [];
  let disposed = false;
  let chain = Promise.resolve();

  const enqueue = (fn: () => Promise<void>) => {
    chain = chain.then(fn, fn);
  };

  const handle = async (msg: WebviewInbound) => {
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

  panel.webview.onDidReceiveMessage((msg: WebviewInbound) => {
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
    const workerScript = context.asAbsolutePath("dist/session-worker.js");
    if (!existsSync(workerScript)) {
      throw new Error(`Muin session worker missing at ${workerScript}; rebuild the VS Code extension`);
    }
    session = sessions.get(pdfPath) ?? (await createSession(pdfPath, { workerScript, workerProcess: true }));
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
