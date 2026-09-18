export type WebviewAssets = {
  nonce: string;
  cspSource: string;
};

/** Split `ls` text so `3 0 R` tokens can be clicked. Keep in sync with renderLs in the webview script. */
export function splitLsRefs(text: string): { kind: "text" | "ref"; value: string }[] {
  const re = /(\d+ \d+ R)/g;
  const parts: { kind: "text" | "ref"; value: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    const ref = m[1];
    if (ref) parts.push({ kind: "ref", value: ref });
    last = m.index + (m[1]?.length ?? 0);
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export function webviewHtml(assets: WebviewAssets): string {
  const { nonce, cspSource } = assets;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Muin</title>
  <style>
    :root {
      --muin-cyan: var(--vscode-terminal-ansiCyan, #4ec9b0);
      --muin-green: var(--vscode-terminal-ansiGreen, #3dd68c);
      --muin-yellow: var(--vscode-terminal-ansiYellow, #dcdcaa);
      --muin-dim: var(--vscode-descriptionForeground, #848484);
      --muin-border: var(--vscode-panel-border, #3c3c3c);
      --muin-focus: var(--vscode-focusBorder, var(--muin-cyan));
      --muin-bg: var(--vscode-editor-background);
      --muin-fg: var(--vscode-editor-foreground);
      --muin-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    }
    html, body { margin: 0; height: 100%; background: var(--muin-bg); color: var(--muin-fg); font: 13px/1.45 var(--muin-mono); }
    button, input { font: inherit; color: inherit; }
    #app { display: grid; grid-template-rows: auto 1fr auto; height: 100%; min-height: 0; }
    header { padding: 8px 12px 6px; }
    header .brand { color: var(--muin-cyan); font-weight: 700; }
    header .file { color: var(--muin-dim); }
    header .location { margin-top: 2px; display: flex; gap: 12px; align-items: baseline; }
    header .back {
      display: none; border: none; background: transparent; color: var(--muin-cyan);
      cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px;
    }
    header .back.show { display: inline; }
    header .back:hover { color: var(--muin-green); }
    header .rule { height: 1px; background: var(--muin-border); margin-top: 6px; }
    .spacer { flex: 1; }
    #content { position: relative; min-height: 0; }
    #main, #overlay { position: absolute; inset: 0 16px 8px; display: flex; flex-direction: column; min-height: 0; gap: 10px; padding: 0; }
    #main.hide { display: none; }
    #overlay { display: none; margin: 0; width: auto; }
    #overlay.show { display: flex; }
    .box {
      border: 1px solid var(--muin-border);
      border-radius: 12px;
      min-height: 0;
      padding: 6px 10px;
    }
    .box.focused { border-color: var(--muin-focus); }
    #graph {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 120px;
      cursor: default;
    }
    #graph.focused { border-color: var(--muin-focus); }
    #neighborhood { display: flex; flex: 1; min-height: 0; gap: 0; }
    .col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .col.side { flex: 1; padding: 0 8px; }
    .col.current { flex: 1.2; align-items: center; justify-content: center; text-align: center; padding: 8px 14px; }
    .col-title { color: var(--muin-dim); font-size: 11px; text-transform: lowercase; letter-spacing: 0.02em; border-bottom: 1px solid var(--muin-border); padding-bottom: 3px; margin-bottom: 4px; }
    .col.side:first-child .col-title { color: var(--muin-yellow); }
    .col.side:last-child .col-title { color: var(--muin-cyan); }
    .col.current .col-title { border: none; }
    #currentNode { border: 1px solid var(--muin-green); border-radius: 10px; padding: 12px 16px; min-width: 110px; }
    #currentNode .col-title { margin: 0 0 5px; }
    .list { flex: 1; overflow: auto; }
    .entry {
      display: flex; gap: 8px; align-items: baseline;
      padding: 2px 6px; border-radius: 3px; cursor: pointer;
      white-space: nowrap;
    }
    .entry:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }
    .entry.selected { background: color-mix(in srgb, var(--muin-focus) 12%, transparent); color: var(--muin-fg); border: 1px solid color-mix(in srgb, var(--muin-focus) 55%, transparent); border-radius: 8px; }
    .entry.missing { opacity: 0.55; cursor: default; }
    .entry .marker { width: 1.2em; flex: none; color: var(--muin-dim); }
    .col.side:first-child .entry.selected .marker { color: var(--muin-yellow); }
    .col.side:last-child .entry.selected .marker { color: var(--muin-cyan); }
    .entry.selected .marker { color: inherit; }
    .kind-real { }
    .kind-sum { color: var(--muin-dim); }
    .entry.selected .kind-sum { color: inherit; opacity: 0.85; }
    #currentRef { color: var(--muin-green); font-weight: 700; font-size: 15px; }
    #currentKind { margin-top: 4px; }
    #empty { display: none; flex: 1; align-items: center; justify-content: center; color: var(--muin-dim); }
    #empty.show { display: flex; }
    #neighborhood.hide { display: none; }
    #object { flex: 1; display: flex; flex-direction: column; min-height: 100px; }
    #object .col-title { display: flex; gap: 12px; align-items: baseline; }
    #ls { flex: 1; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
    #ls .ref {
      color: var(--vscode-textLink-foreground, var(--muin-cyan));
      cursor: pointer; text-decoration: underline;
      text-underline-offset: 2px;
      pointer-events: auto;
    }
    #ls .ref:hover { color: var(--vscode-textLink-activeForeground, var(--muin-green)); }
    #busy { display: none; position: absolute; inset: 0; place-items: center; background: color-mix(in srgb, var(--muin-bg) 70%, transparent); z-index: 2; color: var(--muin-yellow); }
    #busy.show { display: grid; }
    #overlay.box { border-color: var(--muin-yellow); }
    #overlayHeader { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    #overlayTitle { font-weight: 700; white-space: pre; overflow: hidden; text-overflow: ellipsis; }
    #overlayHeader .hint { color: var(--muin-dim); }
    #overlayClose {
      background: transparent; border: none; color: inherit; font-size: 16px;
      line-height: 1; cursor: pointer; padding: 0 4px; margin-left: auto;
    }
    #overlayClose:hover { color: var(--vscode-errorForeground); }
    #overlayBody { flex: 1; overflow: auto; margin: 0; padding-top: 6px; white-space: pre-wrap; word-break: break-word; font: inherit; }
    #hint { height: 16px; padding-left: 24px; color: var(--muin-dim); font-size: 11px; line-height: 16px; overflow: hidden; }
    #status { height: 16px; padding-left: 24px; font-size: 12px; line-height: 16px; color: var(--vscode-errorForeground); overflow: hidden; }
    #operation { height: 16px; padding-left: 0; font-size: 12px; line-height: 16px; color: var(--muin-yellow); overflow: hidden; }
    #cmd {
      display: flex; flex-direction: column; align-items: stretch; gap: 0; width: auto; height: auto; min-height: 0; box-sizing: border-box; overflow: hidden; margin: 10px 16px 16px;
      border: 1px solid var(--muin-border); border-radius: 12px; padding: 4px 10px;
      background: var(--vscode-input-background, transparent);
    }
    #cmd.focused { border-color: var(--muin-focus); }
    #cmd-header { display: flex; justify-content: space-between; align-items: baseline; height: 16px; }
    #cmd-header .label { color: var(--muin-cyan); font-weight: 700; flex: 0 0 7ch; min-width: 7ch; white-space: nowrap; overflow: visible; }
    #cmd-header #hint { flex: 1; padding-left: 8px; text-align: right; }
    #cmd-context { height: 32px; color: var(--muin-dim); font-size: 11px; line-height: 16px; overflow: hidden; }
    #cmd-queue { height: 16px; color: var(--muin-yellow); font-size: 12px; line-height: 16px; overflow: hidden; }
    .cmd-row { display: flex; align-items: stretch; min-width: 0; }
    #promptMark { color: var(--muin-green); padding: 6px 8px 6px 0; user-select: none; }
    #promptMark.busy { color: var(--muin-yellow); }
    #promptMark.idle { color: var(--muin-dim); }
    .field { position: relative; flex: 1; min-width: 0; }
    input {
      width: 100%; box-sizing: border-box; padding: 6px 0; border: none;
      background: transparent; color: var(--vscode-input-foreground, inherit); outline: none;
    }
    #suggestions { display: flex; visibility: hidden; flex: 0 0 22px; align-items: center; min-width: 0; padding: 0; color: var(--muin-cyan); font-size: 12px; font-weight: 600; white-space: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
    #suggestions::-webkit-scrollbar { display: none; }
    #suggestions.show { visibility: visible; }
    #suggestions strong { color: var(--muin-cyan); font-weight: 500; opacity: 0.72; }
    #suggestions strong[data-active="true"] { font-weight: 800; opacity: 1; }
  </style>
</head>
<body>
  <div id="app">
    <header>
      <div><span class="brand">muin</span><span class="file" id="file">  Opening…</span></div>
      <div class="location">
        <span id="location"></span>
        <button type="button" class="back" id="back">← back</button>
      </div>
      <div class="rule"></div>
    </header>
    <div id="content">
      <div id="main">
        <div id="graph" class="box" tabindex="0">
          <div id="empty">no references here — try cd or find</div>
          <div id="neighborhood">
            <div class="col side">
              <div class="col-title" id="inTitle">← incoming</div>
              <div class="list" id="incoming"></div>
            </div>
            <div class="col current">
              <div id="currentNode">
                <div class="col-title">current node</div>
                <div id="currentRef"></div>
                <div id="currentKind"></div>
              </div>
            </div>
            <div class="col side">
              <div class="col-title" id="outTitle">outgoing →</div>
              <div class="list" id="outgoing"></div>
            </div>
          </div>
        </div>
        <div id="object" class="box" tabindex="0">
          <div class="col-title">object</div>
          <pre id="ls"></pre>
        </div>
      </div>
      <div id="overlay" class="box">
        <div id="overlayHeader">
          <span id="overlayTitle"></span>
          <span class="hint">Esc closes</span>
          <button type="button" id="overlayClose" title="Close">×</button>
        </div>
        <pre id="overlayBody"></pre>
      </div>
      <div id="busy">…</div>
    </div>
    <form id="cmd">
      <div id="cmd-header">
        <span class="label">COMMAND</span>
        <div id="hint"></div>
      </div>
      <div id="suggestions" role="status"></div>
      <div id="cmd-context"><div id="cmd-file"></div><div id="cmd-location"></div></div>
      <div id="operation" aria-live="polite">active: idle</div>
      <div id="cmd-queue">queue: empty</div>
      <div class="cmd-row">
        <span id="promptMark">›</span>
        <div class="field">
          <input id="line" placeholder="" autocomplete="off" spellcheck="false" />
        </div>
      </div>
      <div id="status" aria-live="polite"></div>
    </form>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const mainEl = document.getElementById("main");
    const overlayEl = document.getElementById("overlay");
    const overlayTitleEl = document.getElementById("overlayTitle");
    const overlayBodyEl = document.getElementById("overlayBody");
    const statusEl = document.getElementById("status");
    const operationEl = document.getElementById("operation");
    const commandQueueEl = document.getElementById("cmd-queue");
    const commandFileEl = document.getElementById("cmd-file");
    const commandLocationEl = document.getElementById("cmd-location");
    const hintEl = document.getElementById("hint");
    const input = document.getElementById("line");
    const cmdEl = document.getElementById("cmd");
    const promptMark = document.getElementById("promptMark");
    const graphEl = document.getElementById("graph");
    const objectEl = document.getElementById("object");
    const suggestEl = document.getElementById("suggestions");
    const incomingEl = document.getElementById("incoming");
    const outgoingEl = document.getElementById("outgoing");
    const emptyEl = document.getElementById("empty");
    const neighborhoodEl = document.getElementById("neighborhood");
    let busy = false;
    let canBack = false;
    let focus = "prompt";
    let history = [];
    let histPos = -1;
    let suggestItems = [];
    let suggestIndex = 0;
    let suggestReplaceFrom = 0;
    let completeOnResponse = false;
    let completionBaseValue = "";
    let completionBaseCursor = 0;
    let neighbors = null;
    let column = "outgoing";
    let index = 0;
    const activityEntries = [];

    function closeSuggestions() {
      suggestItems = [];
      suggestEl.innerHTML = "";
      suggestEl.classList.remove("show");
    }

    function renderSuggestions() {
      suggestEl.replaceChildren();
      suggestEl.classList.toggle("show", suggestItems.length > 0);
      suggestEl.setAttribute("aria-label", "Completion hint");
      suggestItems.forEach((item, itemIndex) => {
        if (itemIndex > 0) suggestEl.appendChild(document.createTextNode("  ·  "));
        const itemEl = document.createElement("strong");
        itemEl.textContent = item;
        if (itemIndex === suggestIndex) itemEl.dataset.active = "true";
        suggestEl.appendChild(itemEl);
      });
      requestAnimationFrame(() => {
        suggestEl.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
      });
    }

    function showSuggestions(items, replaceFrom) {
      suggestItems = items || [];
      suggestReplaceFrom = replaceFrom;
      suggestIndex = 0;
      completionBaseValue = input.value;
      completionBaseCursor = input.selectionStart || input.value.length;
      renderSuggestions();
    }

    function acceptSuggestion(i, keepOpen = false) {
      const chosen = suggestItems[i];
      if (chosen === undefined) return;
      const value = keepOpen ? completionBaseValue : input.value;
      const cursor = keepOpen ? completionBaseCursor : (input.selectionStart || value.length);
      const tail = value.slice(cursor);
      input.value = value.slice(0, suggestReplaceFrom) + chosen + " " + tail;
      const newCursor = suggestReplaceFrom + chosen.length + 1;
      input.setSelectionRange(newCursor, newCursor);
      if (!keepOpen) closeSuggestions();
      setFocus("prompt");
    }

    function requestCompletion(all = false) {
      vscode.postMessage({ type: "complete", line: input.value, cursor: input.selectionStart || input.value.length, all });
    }

    function setBusy(on) {
      busy = on;
      document.getElementById("busy").classList.toggle("show", on);
      promptMark.textContent = on ? "…" : "›";
      promptMark.className = on ? "busy" : (focus === "prompt" ? "" : "idle");
      updateHint();
    }

    function setStatus(text) {
      statusEl.textContent = text || "";
    }

    function setOperation(msg) {
      if (msg.phase === "queued") {
        operationEl.textContent = "active: " + (busy ? "running" : "idle");
        commandQueueEl.textContent = "queue: " + (msg.pending || 1) + " queued";
        return;
      }
      if (msg.phase === "running") {
        operationEl.textContent = "active: running";
        commandQueueEl.textContent = "queue: " + (msg.pending > 0 ? msg.pending + " queued" : "empty");
        return;
      }
      operationEl.textContent = "active: idle";
      commandQueueEl.textContent = "queue: " + (msg.pending > 0 ? msg.pending + " queued" : "empty");
    }

    function setCommandContext(msg) {
      commandFileEl.textContent = "file: " + (msg.fileName || "PDF");
      commandLocationEl.textContent = "cwd: " + (msg.location || msg.cwd || "");
    }

    function overlayOpen() {
      return overlayEl.classList.contains("show");
    }

    function updateHint() {
      if (overlayOpen()) {
        hintEl.textContent = "Esc closes";
        return;
      }
      if (focus === "graph") {
        hintEl.textContent = "click a ref to cd   ←/→ pane   ↑/↓ select   Enter cd   Tab → object   Esc → prompt";
        return;
      }
      if (focus === "object") {
        hintEl.textContent = "click a ref to cd   ↑↓ scroll   Tab/Esc → prompt";
        return;
      }
      hintEl.textContent = "Enter run   Tab complete   Up/Down history";
    }

    function setFocus(next) {
      focus = next;
      graphEl.classList.toggle("focused", next === "graph");
      objectEl.classList.toggle("focused", next === "object");
      cmdEl.classList.toggle("focused", next === "prompt");
      promptMark.className = busy ? "busy" : (next === "prompt" ? "" : "idle");
      if (next === "prompt") input.focus();
      else input.blur();
      if (next === "graph") graphEl.focus();
      if (next === "object") objectEl.focus();
      updateHint();
    }

    function openOverlay(title, body) {
      activityEntries.push("$ " + title + "\\n" + body);
      if (activityEntries.length > 100) activityEntries.shift();
      overlayTitleEl.textContent = "activity";
      overlayBodyEl.textContent = activityEntries.join("\\n\\n");
      overlayEl.classList.add("show");
      mainEl.classList.add("hide");
      updateHint();
    }

    function closeOverlay() {
      overlayEl.classList.remove("show");
      mainEl.classList.remove("hide");
      updateHint();
    }

    function kindNode(kind, emphasize) {
      const span = document.createElement("span");
      if (!kind) return span;
      if (kind.charAt(0) === "/") {
        span.className = "kind-real";
        span.textContent = kind;
        if (emphasize) span.style.color = "var(--muin-green)";
      } else {
        span.className = "kind-sum";
        span.textContent = "[" + kind + "]";
      }
      return span;
    }

    function lists() {
      if (!neighbors) return { incoming: [], outgoing: [] };
      return { incoming: neighbors.incoming.entries || [], outgoing: neighbors.outgoing.entries || [] };
    }

    function selectedEntry() {
      const l = lists();
      return l[column][index];
    }

    function cdTo(ref, missing) {
      if (!ref || missing) return;
      setBusy(true);
      vscode.postMessage({ type: "cd", ref: ref });
    }

    function renderColumn(el, entries, active) {
      el.replaceChildren();
      if (entries.length === 0) {
        const none = document.createElement("div");
        none.className = "entry missing";
        none.textContent = "[none]";
        el.appendChild(none);
        return;
      }
      entries.forEach((entry, i) => {
        const row = document.createElement("div");
        const selected = active && i === index;
        row.className = "entry" + (selected ? " selected" : "") + (entry.missing ? " missing" : "");
        row.dataset.ref = entry.ref;
        const marker = document.createElement("span");
        marker.className = "marker";
        marker.textContent = selected ? (el === incomingEl ? "◀" : "▶") : " ";
        const ref = document.createElement("span");
        ref.textContent = entry.ref;
        row.appendChild(marker);
        row.appendChild(ref);
        if (entry.kind) {
          row.appendChild(kindNode(entry.kind, false));
        } else if (entry.missing) {
          row.appendChild(kindNode("missing", false));
        }
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          column = el === incomingEl ? "incoming" : "outgoing";
          index = i;
          setFocus("graph");
          renderNeighborhood();
          cdTo(entry.ref, entry.missing);
        });
        el.appendChild(row);
        if (selected) row.scrollIntoView({ block: "nearest" });
      });
    }

    function renderNeighborhood() {
      if (!neighbors) return;
      const incoming = neighbors.incoming.entries || [];
      const outgoing = neighbors.outgoing.entries || [];
      const empty = incoming.length === 0 && outgoing.length === 0;
      emptyEl.classList.toggle("show", empty);
      neighborhoodEl.classList.toggle("hide", empty);
      document.getElementById("inTitle").textContent = "← incoming (" + (neighbors.incoming.total || 0) + ")";
      document.getElementById("outTitle").textContent = "outgoing (" + (neighbors.outgoing.total || 0) + ") →";
      const cur = neighbors.current || {};
      document.getElementById("currentRef").textContent = cur.ref || "";
      const kindWrap = document.getElementById("currentKind");
      kindWrap.replaceChildren();
      if (cur.kind) kindWrap.appendChild(kindNode(cur.kind, true));
      renderColumn(incomingEl, incoming, column === "incoming");
      renderColumn(outgoingEl, outgoing, column === "outgoing");
    }

    function renderLs(text) {
      const pre = document.getElementById("ls");
      pre.replaceChildren();
      const re = /(\\d+ \\d+ R)/g;
      let last = 0;
      const src = text || "";
      let m;
      while ((m = re.exec(src))) {
        if (m.index > last) pre.appendChild(document.createTextNode(src.slice(last, m.index)));
        const ref = m[1];
        const btn = document.createElement("span");
        btn.className = "ref";
        btn.textContent = ref;
        btn.title = "cd " + ref;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          setFocus("object");
          cdTo(ref, false);
        });
        pre.appendChild(btn);
        last = m.index + ref.length;
      }
      if (last < src.length) pre.appendChild(document.createTextNode(src.slice(last)));
    }

    function moveColumn(dir) {
      const l = lists();
      const other = column === "incoming" ? "outgoing" : "incoming";
      if (dir === 0) return;
      if (l[other].length > 0) {
        column = other;
        index = 0;
        renderNeighborhood();
      }
    }

    function moveIndex(delta) {
      const l = lists()[column];
      if (l.length === 0) return;
      index = Math.max(0, Math.min(l.length - 1, index + delta));
      renderNeighborhood();
    }

    window.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "operation") {
        setOperation(msg);
        if (msg.phase === "running") setBusy(true);
        if (msg.phase === "idle") setBusy(false);
        return;
      }
      setBusy(false);
      if (msg.type === "state") {
        closeOverlay();
        setStatus("");
        document.getElementById("file").textContent = "  " + (msg.fileName || "PDF");
        document.getElementById("location").textContent = msg.location || msg.cwd || "";
        setCommandContext(msg);
        canBack = !!msg.canBack;
        document.getElementById("back").classList.toggle("show", canBack);
        neighbors = msg.neighbors || null;
        column = neighbors && neighbors.outgoing && neighbors.outgoing.entries.length > 0 ? "outgoing" : "incoming";
        index = 0;
        renderNeighborhood();
        renderLs(msg.ls || "");
        history = Array.isArray(msg.history) ? msg.history : history;
        if (input.value.trim().length === 0) requestCompletion(true);
      }
      if (msg.type === "overlay") {
        openOverlay(msg.title || "", msg.body || "");
        if (Array.isArray(msg.history)) history = msg.history;
      }
      if (msg.type === "log") {
        setStatus(msg.log || "");
      }
      if (msg.type === "completions") {
        showSuggestions(msg.items, typeof msg.replaceFrom === "number" ? msg.replaceFrom : input.value.length);
        if (completeOnResponse) {
          completeOnResponse = false;
          if (suggestItems.length > 0) acceptSuggestion(0, true);
        }
      }
    });

    document.getElementById("cmd").addEventListener("submit", (e) => {
      e.preventDefault();
      if (focus !== "prompt") return;
      const line = input.value.trim();
      if (!line) return;
      histPos = -1;
      input.value = "";
      setBusy(true);
      vscode.postMessage({ type: "run", line });
    });

    document.getElementById("overlayClose").addEventListener("click", () => {
      closeOverlay();
      setFocus("prompt");
    });

    document.getElementById("back").addEventListener("click", (e) => {
      e.stopPropagation();
      if (busy || !canBack) return;
      setBusy(true);
      vscode.postMessage({ type: "run", line: "back" });
    });
    graphEl.addEventListener("click", () => setFocus("graph"));
    objectEl.addEventListener("click", () => setFocus("object"));
    input.addEventListener("focus", () => {
      setFocus("prompt");
      if (input.value.trim().length === 0) requestCompletion(true);
    });

    input.addEventListener("input", () => {
      completeOnResponse = false;
      completionBaseValue = input.value;
      completionBaseCursor = input.selectionStart || input.value.length;
      if (input.value.trim().length === 0) requestCompletion(true);
      else closeSuggestions();
    });

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        if (suggestItems.length > 0) {
          e.preventDefault();
          closeSuggestions();
          return;
        }
        if (overlayOpen()) {
          e.preventDefault();
          closeOverlay();
          setFocus("prompt");
          return;
        }
        if (focus !== "prompt") {
          e.preventDefault();
          setFocus("prompt");
        }
        return;
      }
      if (busy) return;
      if (e.key === "Tab" && e.shiftKey && !overlayOpen()) {
        e.preventDefault();
        closeSuggestions();
        setFocus(focus === "prompt" ? "graph" : focus === "graph" ? "object" : "prompt");
        return;
      }
      if (e.key === "Tab" && !e.shiftKey && !overlayOpen()) {
        e.preventDefault();
        return;
      }
      if (focus === "graph" && !overlayOpen()) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          moveColumn(e.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        if (e.key === "ArrowUp") { e.preventDefault(); moveIndex(-1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); moveIndex(1); return; }
        if (e.key === "Enter") {
          e.preventDefault();
          const entry = selectedEntry();
          if (entry) cdTo(entry.ref, entry.missing);
          return;
        }
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        if (busy) return;
        if (e.shiftKey) {
          closeSuggestions();
          setFocus("graph");
          return;
        }
        if (suggestItems.length === 0) {
          completeOnResponse = true;
          requestCompletion();
        } else {
          suggestIndex = (suggestIndex + 1) % suggestItems.length;
          acceptSuggestion(suggestIndex, true);
          renderSuggestions();
        }
        return;
      }
      if (e.key === "Enter" && suggestItems.length > 0) {
        e.preventDefault();
        acceptSuggestion(suggestIndex);
        return;
      }
      if (e.key === "ArrowUp" && suggestItems.length > 0) {
        e.preventDefault();
        suggestIndex = Math.max(0, suggestIndex - 1);
        renderSuggestions();
        return;
      }
      if (e.key === "ArrowDown" && suggestItems.length > 0) {
        e.preventDefault();
        suggestIndex = Math.min(suggestItems.length - 1, suggestIndex + 1);
        renderSuggestions();
        return;
      }
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

    setBusy(true);
    vscode.postMessage({ type: "ready" });
    requestCompletion(true);
    setFocus("prompt");
    updateHint();
  </script>
</body>
</html>`;
}
