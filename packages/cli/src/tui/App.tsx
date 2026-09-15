import { Box, Text, useApp, useInput, useStdout } from "ink";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  complete,
  formatBytes,
  formatProcessError,
  formatSnapshot,
  TEXT_PREVIEW_MAX_CHARS,
  type CommandResult,
  type MuinSession,
  type Neighbors,
  type SessionSnapshot,
} from "@muin/core";
import { GraphView } from "./GraphView.tsx";
import { useScrollableText } from "./scroll.ts";

const EXTRA_COMMANDS = ["history"];
const MAX_APP_WIDTH = 100;
const FOCUS_ORDER = ["prompt", "graph", "object"] as const;

type Props = {
  session: MuinSession;
};

type Focus = (typeof FOCUS_ORDER)[number];
type OverlayState = { title: string; body: string };

// Overlay and the object pane page through their content, so this is a memory sanity cap, not a screen-space one.
const RESULT_CAP = TEXT_PREVIEW_MAX_CHARS;

export function renderResult(result: CommandResult): string {
  let text: string;
  switch (result.kind) {
    case "text":
      text = result.text;
      break;
    case "json":
      text = JSON.stringify(result.value, null, 2);
      break;
    case "bytes":
      text = formatBytes(result.bytes);
      break;
    case "quit":
      return "";
  }
  if (text.length <= RESULT_CAP) return text;
  return `${text.slice(0, RESULT_CAP)}\n[+${text.length - RESULT_CAP} more chars]`;
}

function baseName(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

const Header = memo(function Header({ file, snap }: { file: string; snap: SessionSnapshot }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          muin
        </Text>
        <Text dimColor>  {file}</Text>
      </Box>
      <Text>{formatSnapshot(snap.cwd, snap.path)}</Text>
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray" />
    </Box>
  );
});

function ObjectView({ text, focused, busy }: { text: string | null; focused: boolean; busy: boolean }) {
  const { ref, visible, clamped, total, hasMore } = useScrollableText(text ?? "", focused && !busy);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      <Text>
        <Text dimColor>object</Text>
        {hasMore ? (
          <Text dimColor>
            {"   ↑↓/PgUp/PgDn scroll   "}
            {clamped + 1}-{Math.min(clamped + visible.length, total)}/{total}
          </Text>
        ) : null}
      </Text>
      {text === null ? (
        <Text dimColor>…</Text>
      ) : (
        <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
          {visible.map((line, i) => (
            <Text key={clamped + i} wrap="truncate-end">
              {line.length > 0 ? line : " "}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function Overlay({ title, body, busy }: OverlayState & { busy: boolean }) {
  const { ref, visible, clamped, total, hasMore } = useScrollableText(body, !busy);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        <Text bold>{title}</Text>
        <Text dimColor>{hasMore ? "   ↑↓/PgUp/PgDn scroll   Esc closes" : "   Esc closes"}</Text>
        {hasMore ? (
          <Text dimColor>
            {"   "}
            {clamped + 1}-{Math.min(clamped + visible.length, total)}/{total}
          </Text>
        ) : null}
      </Text>
      <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((line, i) => (
          <Text key={clamped + i} wrap="truncate-end">
            {line.length > 0 ? line : " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

const CompletionMenu = memo(function CompletionMenu({ items, index }: { items: string[]; index: number }) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {items.map((item, i) => (
        <Text key={item} inverse={i === index}>
          {i === index ? "▸ " : "  "}
          {item}
        </Text>
      ))}
    </Box>
  );
});

function Prompt({
  busy,
  focused,
  overlayOpen,
  history,
  neighborRefs,
  onPush,
  onToggleFocus,
  onSubmit,
}: {
  busy: boolean;
  focused: boolean;
  overlayOpen: boolean;
  history: string[];
  neighborRefs: string[];
  onPush: (line: string) => void;
  onToggleFocus: () => void;
  onSubmit: (line: string) => void;
}) {
  const { exit } = useApp();
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [histPos, setHistPos] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);

  const completion = useMemo(
    () => (menuOpen ? complete(draft, cursor, { neighborRefs, extraCommands: EXTRA_COMMANDS }) : null),
    [menuOpen, draft, cursor, neighborRefs],
  );
  const menuItems = completion?.items ?? [];
  const clampedMenuIndex = menuItems.length > 0 ? Math.min(menuIndex, menuItems.length - 1) : 0;

  const acceptCompletion = useCallback(() => {
    if (!completion || menuItems.length === 0) return false;
    const chosen = menuItems[clampedMenuIndex];
    if (chosen === undefined) return false;
    const newDraft = `${draft.slice(0, completion.replaceFrom)}${chosen} ${draft.slice(cursor)}`;
    setDraft(newDraft);
    setCursor(completion.replaceFrom + chosen.length + 1);
    setMenuOpen(false);
    return true;
  }, [completion, menuItems, clampedMenuIndex, draft, cursor]);

  useInput(
    (input, key) => {
      if (key.escape) {
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        if (overlayOpen) return;
        exit();
        return;
      }
      if (busy) return;

      if (menuOpen && menuItems.length > 0 && (key.upArrow || key.downArrow)) {
        setMenuIndex((i) => {
          const next = key.upArrow ? i - 1 : i + 1;
          return Math.max(0, Math.min(menuItems.length - 1, next));
        });
        return;
      }

      if (overlayOpen && !menuOpen && (key.upArrow || key.downArrow || key.pageUp || key.pageDown)) {
        // The open overlay's own useInput scrolls it instead of recalling history.
        return;
      }

      if (key.tab) {
        if (draft.trim().length === 0) {
          onToggleFocus();
          return;
        }
        if (!menuOpen) {
          setMenuOpen(true);
          setMenuIndex(0);
          return;
        }
        setMenuIndex((i) => (menuItems.length === 0 ? 0 : (i + 1) % menuItems.length));
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        const next = Math.min(histPos + 1, history.length - 1);
        setHistPos(next);
        const value = history[history.length - 1 - next] ?? "";
        setDraft(value);
        setCursor(value.length);
        return;
      }
      if (key.downArrow) {
        if (histPos <= 0) {
          setHistPos(-1);
          setDraft("");
          setCursor(0);
          return;
        }
        const next = histPos - 1;
        setHistPos(next);
        const value = history[history.length - 1 - next] ?? "";
        setDraft(value);
        setCursor(value.length);
        return;
      }
      if (key.leftArrow) {
        setMenuOpen(false);
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setMenuOpen(false);
        setCursor((c) => Math.min(draft.length, c + 1));
        return;
      }
      if (key.return) {
        if (menuOpen && acceptCompletion()) return;
        const line = draft;
        setDraft("");
        setCursor(0);
        if (line.trim().length === 0) return;
        onPush(line);
        setHistPos(-1);
        onSubmit(line);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        setDraft((d) => d.slice(0, cursor - 1) + d.slice(cursor));
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDraft((d) => d.slice(0, cursor) + input + d.slice(cursor));
        setCursor((c) => c + input.length);
      }
    },
    { isActive: focused },
  );

  const before = draft.slice(0, cursor);
  const after = draft.slice(cursor);

  return (
    <Box flexDirection="column">
      {menuOpen && menuItems.length > 0 ? <CompletionMenu items={menuItems} index={clampedMenuIndex} /> : null}
      <Box borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
        <Text color={busy ? "yellow" : focused ? "green" : "gray"}>{busy ? "…" : "›"} </Text>
        {focused ? (
          <>
            <Text>{before}</Text>
            <Text inverse>{after.length > 0 ? after[0] : " "}</Text>
            <Text>{after.slice(1)}</Text>
          </>
        ) : (
          <Text dimColor>{draft.length > 0 ? draft : "Tab to type a command"}</Text>
        )}
      </Box>
    </Box>
  );
}

export function App({ session }: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout.columns || 80;
  const rows = stdout.rows || 24;
  const width = Math.min(columns, MAX_APP_WIDTH);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(() => session.snapshot());
  const [focus, setFocus] = useState<Focus>("prompt");
  const [neighbors, setNeighbors] = useState<Neighbors | null>(null);
  const [objectText, setObjectText] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const refreshNeighbors = useCallback(async () => {
    try {
      const res = await session.run("neighbors");
      if (res.kind === "json") setNeighbors(res.value as Neighbors);
    } catch {
      // best-effort refresh; keep showing the last known neighborhood
    }
  }, [session]);

  const refreshObject = useCallback(async () => {
    try {
      const res = await session.run("ls");
      if (res.kind === "text") setObjectText(res.text);
    } catch {
      // best-effort refresh; keep showing the last known object
    }
  }, [session]);

  useEffect(() => {
    void refreshNeighbors();
    void refreshObject();
  }, [refreshNeighbors, refreshObject]);

  const execLine = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (trimmed === "history") {
        setOverlay({
          title: "history",
          body: history.length === 0 ? "(empty)" : history.map((h, i) => `${i + 1}  ${h}`).join("\n"),
        });
        return;
      }
      setBusy(true);
      void (async () => {
        try {
          const result = await session.run(line);
          setSnap(session.snapshot());
          if (result.kind === "quit") {
            exit();
            return;
          }
          const cmdName = trimmed.split(/\s+/)[0];
          setStatus(null);
          if (cmdName === "cd" || cmdName === "back") {
            setOverlay(null);
            await Promise.all([refreshNeighbors(), refreshObject()]);
          } else {
            setOverlay({ title: line, body: renderResult(result) });
          }
        } catch (err) {
          setStatus(formatProcessError(err));
        } finally {
          setBusy(false);
        }
      })();
    },
    [exit, session, refreshNeighbors, refreshObject, history],
  );

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) {
      exit();
      return;
    }
    if (key.escape) {
      if (overlay) {
        setOverlay(null);
        return;
      }
      if (focus !== "prompt") {
        setFocus("prompt");
      }
      return;
    }
    if (key.tab && !overlay && focus !== "prompt") {
      const next = FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length];
      if (next) setFocus(next);
    }
  });

  const neighborRefs = useMemo(() => {
    if (!neighbors) return [];
    return [...neighbors.incoming.entries, ...neighbors.outgoing.entries].map((e) => e.ref);
  }, [neighbors]);

  const hint = overlay
    ? "Esc closes"
    : focus === "prompt"
      ? "help · history · quit   ↑ history   Tab complete/graph   Ctrl+C exit"
      : focus === "graph"
        ? "←/→ pane   ↑/↓ select   Enter cd   Tab → object   Esc → prompt"
        : "↑↓/PgUp/PgDn scroll   Tab/Esc → prompt";

  return (
    <Box width={columns} height={rows} flexDirection="column" alignItems="center">
      <Box width={width} height={rows} flexDirection="column">
        <Header file={baseName(session.filePath)} snap={snap} />
        <Box flexDirection="column" flexGrow={1}>
          {overlay ? (
            <Overlay title={overlay.title} body={overlay.body} busy={busy} />
          ) : (
            <>
              <GraphView
                neighbors={neighbors}
                focused={focus === "graph"}
                busy={busy}
                onNavigate={execLine}
              />
              <ObjectView text={objectText} focused={focus === "object"} busy={busy} />
            </>
          )}
        </Box>
        {status ? <Text color="red">{status}</Text> : null}
        <Text dimColor>{hint}</Text>
        <Prompt
          busy={busy}
          focused={focus === "prompt"}
          overlayOpen={overlay !== null}
          history={history}
          neighborRefs={neighborRefs}
          onPush={(line) => setHistory((h) => [...h, line].slice(-50))}
          onToggleFocus={() => setFocus("graph")}
          onSubmit={execLine}
        />
      </Box>
    </Box>
  );
}
