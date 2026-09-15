export type WebviewAssets = {
  visScript: string;
  nonce: string;
  cspSource: string;
};

export function webviewHtml(assets: WebviewAssets): string {
  const { visScript, nonce, cspSource } = assets;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Muin</title>
  <style>
    html, body { margin: 0; height: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font: 13px/1.45 var(--vscode-font-family); }
    button, input { font: inherit; color: inherit; }
    #app { display: grid; grid-template-rows: auto 1fr auto auto auto; height: 100%; }
    header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    header .file { font-weight: 600; }
    header .cwd { font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-textLink-foreground); }
    header .path { opacity: 0.75; font-size: 12px; }
    .spacer { flex: 1; }
    .toolbar button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px;
    }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .toolbar button:disabled { opacity: 0.45; cursor: default; }
    #graph { position: relative; min-height: 200px; }
    #empty { display: none; position: absolute; inset: 0; place-items: center; opacity: 0.7; }
    #empty.show { display: grid; }
    #busy { display: none; position: absolute; inset: 0; place-items: center; background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent); }
    #busy.show { display: grid; }
    #detail { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-top: 1px solid var(--vscode-panel-border); max-height: 26vh; }
    .pane { overflow: auto; padding: 8px 12px; min-width: 0; }
    .pane + .pane { border-left: 1px solid var(--vscode-panel-border); }
    .pane h2 { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    #log { max-height: 18vh; overflow: auto; padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; }
    #log .cmd { color: var(--vscode-textLink-foreground); }
    #log .err { color: var(--vscode-errorForeground); }
    form { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); }
    input {
      flex: 1; padding: 6px 8px; border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    }
    form button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 6px 12px; cursor: pointer;
    }
    form button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <span class="file" id="file">Opening…</span>
      <code class="cwd" id="cwd"></code>
      <span class="path" id="path"></span>
      <span class="spacer"></span>
      <span class="toolbar">
        <button type="button" id="back" disabled title="Previous object (back)">Back</button>
        <button type="button" id="help" title="Command help">Help</button>
      </span>
    </header>
    <div id="graph">
      <div id="empty">No objects in this neighborhood. Try <code>cd /Root</code> or <code>tree</code>.</div>
      <div id="busy">Working…</div>
    </div>
    <div id="detail">
      <div class="pane"><h2>Current object</h2><pre id="ls"></pre></div>
      <div class="pane"><h2>References</h2><pre id="refs"></pre></div>
    </div>
    <div id="log" aria-live="polite"></div>
    <form id="cmd">
      <input id="line" placeholder="ls  ·  cd /Pages  ·  find --type Page  ·  help" autocomplete="off" spellcheck="false" />
      <button type="submit">Run</button>
    </form>
  </div>
  <script nonce="${nonce}" src="${visScript}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const graphEl = document.getElementById("graph");
    const logEl = document.getElementById("log");
    const input = document.getElementById("line");
    const backBtn = document.getElementById("back");
    let network;
    let busy = false;
    const history = [];
    let histPos = -1;

    function setBusy(on) {
      busy = on;
      document.getElementById("busy").classList.toggle("show", on);
    }

    function appendLog(text, kind) {
      if (!text) return;
      const line = document.createElement("div");
      if (kind) line.className = kind;
      line.textContent = text;
      logEl.appendChild(line);
      while (logEl.childElementCount > 40) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }

    let drawTimer = 0;
    function draw(graph, cwd) {
      if (drawTimer) cancelAnimationFrame(drawTimer);
      drawTimer = requestAnimationFrame(() => {
        const raw = graph && graph.nodes ? graph.nodes : [];
        document.getElementById("empty").classList.toggle("show", raw.length === 0);
        const nodes = raw.map((n) => ({
          id: n.ref,
          label: n.kind ? n.ref + "\\n" + n.kind : n.ref,
          color: n.ref === cwd
            ? { background: "#1b7f4e", border: "#3dd68c", highlight: { background: "#1b7f4e", border: "#3dd68c" } }
            : undefined,
          font: n.ref === cwd ? { color: "#fff" } : undefined,
        }));
        const edges = (graph.edges || []).map((e, i) => ({
          id: "e" + i,
          from: e.from,
          to: e.to,
          arrows: "to",
        }));
        const data = { nodes, edges };
        const hierarchical = nodes.length > 0 && nodes.length <= 50;
        const options = {
          physics: false,
          interaction: { hover: true, tooltipDelay: 200, hideEdgesOnDrag: true },
          layout: { hierarchical: { enabled: hierarchical, direction: "UD", sortMethod: "directed", nodeSpacing: 140, levelSeparation: 80 } },
          nodes: { shape: "box", margin: 8, font: { face: "monospace", size: 12 }, color: { background: "#3c3c3c", border: "#888", highlight: { background: "#094771", border: "#3794ff" } } },
          edges: { smooth: false, color: { color: "#888" } },
        };
        if (!network) {
          network = new vis.Network(graphEl, data, options);
          network.on("click", (params) => {
            const id = params.nodes && params.nodes[0];
            if (!id || busy) return;
            setBusy(true);
            vscode.postMessage({ type: "cd", ref: id });
          });
        } else {
          network.setOptions(options);
          network.setData(data);
        }
      });
    }

    window.addEventListener("message", (event) => {
      setBusy(false);
      const msg = event.data || {};
      if (msg.type === "state") {
        document.getElementById("file").textContent = msg.fileName || "PDF";
        document.getElementById("cwd").textContent = msg.cwd || "";
        document.getElementById("path").textContent = (msg.path || []).join("  /  ");
        document.getElementById("ls").textContent = msg.ls || "";
        document.getElementById("refs").textContent = msg.refs || "";
        backBtn.disabled = !msg.canBack;
        if (msg.log) appendLog(msg.log, msg.log.startsWith("error:") ? "err" : "");
        draw(msg.graph || { nodes: [], edges: [] }, msg.cwd);
      }
      if (msg.type === "log" && msg.log) {
        appendLog(msg.log, msg.log.startsWith("error:") ? "err" : "");
      }
    });

    document.getElementById("cmd").addEventListener("submit", (e) => {
      e.preventDefault();
      const line = input.value.trim();
      if (!line || busy) return;
      history.push(line);
      histPos = -1;
      appendLog("› " + line, "cmd");
      input.value = "";
      setBusy(true);
      vscode.postMessage({ type: "run", line });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        if (history.length === 0) return;
        e.preventDefault();
        histPos = Math.min(histPos + 1, history.length - 1);
        input.value = history[history.length - 1 - histPos];
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histPos <= 0) { histPos = -1; input.value = ""; return; }
        histPos -= 1;
        input.value = history[history.length - 1 - histPos];
      }
    });

    backBtn.addEventListener("click", () => {
      if (busy || backBtn.disabled) return;
      appendLog("› back", "cmd");
      setBusy(true);
      vscode.postMessage({ type: "run", line: "back" });
    });
    document.getElementById("help").addEventListener("click", () => {
      if (busy) return;
      appendLog("› help", "cmd");
      setBusy(true);
      vscode.postMessage({ type: "run", line: "help" });
    });

    setBusy(true);
    vscode.postMessage({ type: "ready" });
    input.focus();
  </script>
</body>
</html>`;
}
