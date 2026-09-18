import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  complete,
  formatBytes,
  formatProcessError,
  formatSnapshot,
  TEXT_PREVIEW_MAX_CHARS,
  type CommandResult,
  type CompletionResult,
  type MuinSession,
  type Neighbors,
  type SessionSnapshot,
} from "@muin/core";
import { GraphView } from "./GraphView.tsx";
import { loadHistory, saveHistory } from "./history.ts";
import { useScrollableText, useViewportSize } from "./scroll.ts";

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

function Overlay({ title, body, busy, scrollRequest }: OverlayState & { busy: boolean; scrollRequest: { id: number; direction: "up" | "down" | "pageUp" | "pageDown" } | undefined }) {
  const { ref, visible, clamped, total, hasMore } = useScrollableText(body, !busy, title === "activity", scrollRequest);

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

const CompletionHint = memo(function CompletionHint({ items, index }: { items: string[]; index: number }) {
  const { width } = useViewportSize();
  const itemWidths = items.map((item) => item.length + 4);
  const activeOffset = itemWidths.slice(0, index).reduce((total, itemWidth) => total + itemWidth, 0);
  const activeWidth = itemWidths[index] ?? 0;
  const targetOffset = Math.max(0, activeOffset - Math.max(1, width) / 2 + activeWidth / 2);
  let start = 0;
  let visibleWidth = 0;
  while (start < index && visibleWidth + itemWidths[start]! <= targetOffset) {
    visibleWidth += itemWidths[start]!;
    start += 1;
  }
  const visibleItems = items.slice(start);
  return (
    <Box height={1} overflow="hidden">
      {items.length > 0 ? (
        <Text wrap="truncate-end">
          {visibleItems.map((item, visibleIndex) => {
            const itemIndex = start + visibleIndex;
            const separator = visibleIndex > 0 ? "  ·  " : start > 0 && visibleIndex === 0 ? "…  " : "";
            return itemIndex === index ? (
              <Text key={item} color="cyan" bold>{separator}{item}</Text>
            ) : (
              <Text key={item} color="gray">{separator}{item}</Text>
            );
          })}
        </Text>
      ) : <Text> </Text>}
    </Box>
  );
});

function Prompt({
  busy,
  focused,
  overlayOpen,
  history,
  neighborRefs,
  hint,
  file,
  location,
  queueLabel,
  onPush,
  onToggleFocus,
  onSubmit,
  onScroll,
}: {
  busy: boolean;
  focused: boolean;
  overlayOpen: boolean;
  history: string[];
  neighborRefs: string[];
  hint: string;
  file: string;
  location: string;
  queueLabel: string | null;
  onPush: (line: string) => void;
  onToggleFocus: () => void;
  onSubmit: (line: string) => void;
  onScroll: (direction: "up" | "down" | "pageUp" | "pageDown") => void;
}) {
  const { exit } = useApp();
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [histPos, setHistPos] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [completionSeed, setCompletionSeed] = useState<{ draft: string; cursor: number; result: CompletionResult } | null>(null);
  const completionCycleRef = useRef<{ draft: string; cursor: number; result: CompletionResult; index: number } | null>(null);

  const completion = useMemo(
    () => complete(draft, cursor, { neighborRefs, extraCommands: EXTRA_COMMANDS }),
    [draft, cursor, neighborRefs],
  );
  const menuItems = completion.items;
  const initialItems = useMemo(
    () => (focused && draft.trim().length === 0 ? complete("", 0, { neighborRefs, extraCommands: EXTRA_COMMANDS, maxItems: 100 }).items : []),
    [focused, neighborRefs, draft],
  );
  const displayedItems = menuOpen && completionSeed ? completionSeed.result.items : menuItems;
  const draftCandidateIndex = completionSeed
    ? completionSeed.result.items.findIndex((item) => draft.slice(completionSeed.result.replaceFrom).trim() === `${item}`)
    : -1;
  const activeMenuIndex = draftCandidateIndex >= 0 ? draftCandidateIndex : menuIndex;
  const clampedMenuIndex = displayedItems.length > 0 ? Math.min(activeMenuIndex, displayedItems.length - 1) : 0;

  const acceptCompletion = useCallback((index: number, closeMenu = true) => {
    const source = completionSeed?.result ?? completion;
    const sourceDraft = completionSeed?.draft ?? draft;
    const sourceCursor = completionSeed?.cursor ?? cursor;
    if (!source || source.items.length === 0) return false;
    const chosen = source.items[index];
    if (chosen === undefined) return false;
    const newDraft = `${sourceDraft.slice(0, source.replaceFrom)}${chosen} ${sourceDraft.slice(sourceCursor)}`;
    setDraft(newDraft);
    setCursor(source.replaceFrom + chosen.length + 1);
    if (closeMenu) setMenuOpen(false);
    if (closeMenu) setCompletionSeed(null);
    return true;
  }, [completion, completionSeed, draft, cursor]);

  useInput(
    (input, key) => {
      if (key.shift || input === "\u001b[Z") {
        setMenuOpen(false);
        setCompletionSeed(null);
        completionCycleRef.current = null;
        onToggleFocus();
        return;
      }
      if (key.escape) {
        if (menuOpen) {
          setMenuOpen(false);
          setCompletionSeed(null);
          completionCycleRef.current = null;
          return;
        }
        if (overlayOpen) return;
        exit();
        return;
      }
      if (menuOpen && displayedItems.length > 0 && (key.upArrow || key.downArrow)) {
        setMenuIndex((i) => {
          const next = key.upArrow ? i - 1 : i + 1;
          return Math.max(0, Math.min(displayedItems.length - 1, next));
        });
        return;
      }

      if (overlayOpen && !menuOpen && (key.upArrow || key.downArrow || key.pageUp || key.pageDown)) {
        onScroll(key.pageUp ? "pageUp" : key.pageDown ? "pageDown" : key.upArrow ? "up" : "down");
        return;
      }

      if (key.tab) {
        if (draft.trim().length === 0 && !menuOpen && initialItems.length > 0) {
          const initialResult = complete("", 0, { neighborRefs, extraCommands: EXTRA_COMMANDS, maxItems: 100 });
          setCompletionSeed({ draft: "", cursor: 0, result: initialResult });
          completionCycleRef.current = { draft: "", cursor: 0, result: initialResult, index: 0 };
          setMenuIndex(0);
          const first = initialResult.items[0];
          if (first) {
            setDraft(`${first} `);
            setCursor(first.length + 1);
          }
          setMenuOpen(true);
          return;
        }
        if (draft.trim().length === 0 && !menuOpen) {
          return;
        }
        if (menuOpen && completionCycleRef.current) {
          const cycle = completionCycleRef.current;
          const nextIndex = (cycle.index + 1) % cycle.result.items.length;
          cycle.index = nextIndex;
          setMenuIndex(nextIndex);
          const chosen = cycle.result.items[nextIndex];
          if (chosen) {
            setDraft(`${cycle.draft.slice(0, cycle.result.replaceFrom)}${chosen} ${cycle.draft.slice(cycle.cursor)}`);
            setCursor(cycle.result.replaceFrom + chosen.length + 1);
          }
          return;
        }
        if (menuItems.length === 0) {
          setMenuOpen(true);
          return;
        }
        if (!menuOpen) {
          setCompletionSeed({ draft, cursor, result: completion });
          completionCycleRef.current = { draft, cursor, result: completion, index: 0 };
          setMenuIndex(0);
          const first = completion.items[0];
          if (first) {
            setDraft(`${draft.slice(0, completion.replaceFrom)}${first} ${draft.slice(cursor)}`);
            setCursor(completion.replaceFrom + first.length + 1);
          }
          setMenuOpen(true);
          return;
        }
        setMenuOpen(true);
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
                        setCompletionSeed(null);
        setCompletionSeed(null);
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setMenuOpen(false);
        setCompletionSeed(null);
        completionCycleRef.current = null;
        setCursor((c) => Math.min(draft.length, c + 1));
        return;
      }
      if (key.return) {
        if (menuOpen && acceptCompletion(clampedMenuIndex)) return;
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
        setCompletionSeed(null);
        completionCycleRef.current = null;
        setMenuOpen(false);
        setDraft((d) => d.slice(0, cursor - 1) + d.slice(cursor));
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCompletionSeed(null);
        completionCycleRef.current = null;
        setMenuOpen(false);
        setDraft((d) => d.slice(0, cursor) + input + d.slice(cursor));
        setCursor((c) => c + input.length);
      }
    },
    { isActive: focused },
  );

  const before = draft.slice(0, cursor);
  const after = draft.slice(cursor);

  return (
    <Box borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1} flexDirection="column" height={9}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          COMMAND
        </Text>
        <Text dimColor>{hint}</Text>
      </Box>
      <CompletionHint items={menuOpen ? displayedItems : initialItems} index={clampedMenuIndex} />
      <Text dimColor wrap="truncate-end">file: {file}</Text>
      <Text dimColor wrap="truncate-end">cwd: {location}</Text>
      {queueLabel?.startsWith("running") ? (
        <Text color="yellow">active: running</Text>
      ) : (
        <Text>active: {queueLabel?.split(" · ")[0] ?? "idle"}</Text>
      )}
      <Text color="yellow">queue: {queueLabel?.match(/· (.+)$/)?.[1] ?? "empty"}</Text>
      <Box>
        <Text>{busy ? "…" : "›"} </Text>
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
  const { columns: measuredColumns, rows: measuredRows } = useWindowSize();
  const columns = measuredColumns || 80;
  const rows = measuredRows || 24;
  const width = Math.min(columns, MAX_APP_WIDTH);
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(() => session.snapshot());
  const [focus, setFocus] = useState<Focus>("prompt");
  const [neighbors, setNeighbors] = useState<Neighbors | null>(null);
  const [objectText, setObjectText] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const activityRef = useRef<string[]>([]);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [commandQueue, setCommandQueue] = useState<string[]>([]);
  const [activityScrollRequest, setActivityScrollRequest] = useState<{ id: number; direction: "up" | "down" | "pageUp" | "pageDown" }>();

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
      const appendActivity = (body: string) => {
        activityRef.current = [...activityRef.current, `$ ${line}\n${body}`].slice(-100);
        setOverlay({ title: "activity", body: activityRef.current.join("\n\n") });
      };
      if (trimmed === "history") {
        appendActivity(history.length === 0 ? "(empty)" : history.map((h, i) => `${i + 1}  ${h}`).join("\n"));
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
          if (cmdName === "cd" || cmdName === "back") {
            setOverlay(null);
            await Promise.all([refreshNeighbors(), refreshObject()]);
          } else {
            appendActivity(renderResult(result));
          }
        } catch (err) {
          appendActivity(`error: ${formatProcessError(err)}`);
        } finally {
          setBusy(false);
        }
      })();
    },
    [exit, session, refreshNeighbors, refreshObject, history],
  );

  useEffect(() => {
    if (busy || commandQueue.length === 0) return;
    const [line, ...rest] = commandQueue;
    if (!line) return;
    setCommandQueue(rest);
    execLine(line);
  }, [busy, commandQueue, execLine]);

  const recordHistory = useCallback((line: string) => {
    setHistory((current) => {
      const next = [...current, line].slice(-200);
      saveHistory(next);
      return next;
    });
  }, []);

  const enqueueLine = useCallback((line: string) => {
    setCommandQueue((current) => [...current, line]);
  }, []);

  const requestActivityScroll = useCallback((direction: "up" | "down" | "pageUp" | "pageDown") => {
    setActivityScrollRequest((current) => ({ id: (current?.id ?? 0) + 1, direction }));
  }, []);

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
    if ((key.shift || input === "\u001b[Z") && !overlay) {
      const next = FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length];
      if (next) setFocus(next);
      return;
    }
    if ((key.shift || input === "\u001b[Z") && !overlay && focus !== "prompt") {
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
        ? "←/→ pane   ↑/↓ select   Enter cd   Shift+Tab → object   Esc → prompt"
        : "↑↓/PgUp/PgDn scroll   Shift+Tab → prompt";
  const commandHint = !overlay && focus === "prompt" ? "Enter run   Tab complete   Up/Down history" : hint;

  return (
    <Box width={columns} height={rows} flexDirection="column" alignItems="center">
      <Box width={width} height={rows} flexDirection="column">
        <Header file={baseName(session.filePath)} snap={snap} />
        <Box flexDirection="column" flexGrow={1}>
          {overlay ? (
            <Overlay title={overlay.title} body={overlay.body} busy={busy} scrollRequest={activityScrollRequest} />
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
        <Prompt
          busy={busy}
          focused={focus === "prompt"}
          overlayOpen={overlay !== null}
          history={history}
          neighborRefs={neighborRefs}
          hint={commandHint}
          file={baseName(session.filePath)}
          location={formatSnapshot(snap.cwd, snap.path)}
          queueLabel={
            busy || commandQueue.length > 0
              ? `${busy ? "running" : "ready"}${commandQueue.length > 0 ? ` · ${commandQueue.length} queued` : ""}`
              : null
          }
          onPush={recordHistory}
          onToggleFocus={() => setFocus("graph")}
          onSubmit={enqueueLine}
          onScroll={requestActivityScroll}
        />
      </Box>
    </Box>
  );
}
