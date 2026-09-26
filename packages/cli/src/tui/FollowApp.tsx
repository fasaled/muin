import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GraphView } from "./GraphView.tsx";
import { baseName, Header, ObjectView, Overlay } from "./chrome.tsx";
import { formatEventLine, type FollowSource, type Mirror, type MirrorView } from "./follow.ts";
import {
  appendEvents,
  atTail,
  clearTimeline,
  createTimeline,
  currentEvent,
  faster,
  seekTo,
  slower,
  stepBy,
  tick,
  togglePlay,
  type Timeline,
} from "./timeline.ts";

const MAX_APP_WIDTH = 100;
const PROGRESS_WIDTH = 14;

type Props = {
  source: FollowSource;
  mirror: Mirror;
  /** Absolute journal path being watched — always visible so a wrong path is obvious. */
  journalPath: string;
};

const emptyView: MirrorView = {
  status: "waiting-open",
  neighbors: null,
  objectText: null,
  overlay: null,
  message: "waiting for journal",
};

/**
 * Read-only follower: no prompt, no history, no command execution from the keyboard.
 * The only input is timeline navigation (step / play / speed / first / last) plus the
 * TUI's scroll keys, which behave exactly like the main TUI's.
 */
export function FollowApp({ source, mirror, journalPath }: Props) {
  const { exit } = useApp();
  const { columns: measuredColumns, rows: measuredRows } = useWindowSize();
  const columns = measuredColumns || 80;
  const rows = measuredRows || 24;
  const width = Math.min(columns, MAX_APP_WIDTH);
  const [timeline, setTimeline] = useState<Timeline>(() => createTimeline());
  const [epoch, setEpoch] = useState(0);
  const [view, setView] = useState<MirrorView>(emptyView);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [scrollRequest, setScrollRequest] = useState<
    { id: number; direction: "up" | "down" | "pageUp" | "pageDown" } | undefined
  >();
  const requestRef = useRef(0);

  useEffect(
    () =>
      source.subscribe(
        (incoming) => setTimeline((t) => appendEvents(t, incoming)),
        () => {
          // Journal rotation: a new agent session started. Drop the previous
          // timeline (its backup stays viewable via `muin --follow <backup>`)
          // and wait for the new session's operations.
          mirror.close();
          setEpoch((e) => e + 1);
          setTimeline((t) => clearTimeline(t));
        },
      ),
    [source, mirror],
  );

  useEffect(() => {
    const id = ++requestRef.current;
    setBusy(true);
    void (async () => {
      try {
        const next = await mirror.seekTo(timeline.events, timeline.cursor);
        if (requestRef.current === id) setView(next);
      } catch {
        if (requestRef.current === id) {
          setView({ status: "error", neighbors: null, objectText: null, overlay: null, message: "mirror failed" });
        }
      } finally {
        if (requestRef.current === id) setBusy(false);
      }
    })();
  }, [mirror, timeline.events, timeline.cursor]);

  useEffect(() => {
    setDismissed(false);
  }, [timeline.cursor]);

  useEffect(() => {
    if (timeline.mode !== "play" || busy) return;
    if (timeline.cursor >= timeline.events.length - 1) return;
    const timer = setTimeout(() => setTimeline((t) => tick(t)), timeline.delayMs);
    return () => clearTimeout(timer);
  }, [timeline, busy]);

  const overlayOpen = view.overlay !== null && view.overlay !== undefined && !dismissed;

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) {
      exit();
      return;
    }
    if (key.escape) {
      if (overlayOpen) {
        setDismissed(true);
        return;
      }
      exit();
      return;
    }
    if (overlayOpen && (key.upArrow || key.downArrow || key.pageUp || key.pageDown)) {
      setScrollRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        direction: key.pageUp ? "pageUp" : key.pageDown ? "pageDown" : key.upArrow ? "up" : "down",
      }));
      return;
    }
    if (key.leftArrow) {
      setTimeline((t) => stepBy(t, -1));
      return;
    }
    if (key.rightArrow) {
      setTimeline((t) => stepBy(t, 1));
      return;
    }
    if (input === " ") {
      setTimeline((t) => togglePlay(t));
      return;
    }
    if (input === "+" || input === "=") {
      setTimeline((t) => faster(t));
      return;
    }
    if (input === "-" || input === "_") {
      setTimeline((t) => slower(t));
      return;
    }
    if (input === "g") {
      setTimeline((t) => seekTo(t, 0));
      return;
    }
    if (input === "G") {
      setTimeline((t) => seekTo(t, t.events.length - 1));
      return;
    }
  });

  return (
    <Box width={columns} height={rows} flexDirection="column" alignItems="center">
      <Box width={width} height={rows} flexDirection="column">
        <Header
          file={view.file === undefined ? "(no PDF open)" : baseName(view.file)}
          {...(view.snap === undefined ? {} : { snap: view.snap })}
          badge={badge(timeline, view, epoch)}
        />
        <Box flexDirection="column" flexGrow={1}>
          {overlayOpen && view.overlay ? (
            <Overlay title={view.overlay.title} body={view.overlay.body} busy={busy} scrollRequest={scrollRequest} />
          ) : (
            <>
              <GraphView neighbors={view.neighbors ?? null} focused={false} busy={busy} />
              <ObjectView text={view.objectText ?? null} focused={!overlayOpen} busy={busy} />
            </>
          )}
        </Box>
        <TimelineBar timeline={timeline} journalPath={journalPath} busy={busy} />
      </Box>
    </Box>
  );
}

function badge(timeline: Timeline, view: MirrorView, epoch: number): ReactNode {
  if (timeline.events.length === 0) {
    return <Text dimColor>{epoch === 0 ? "… waiting for journal" : "… waiting for operations"}</Text>;
  }
  if (view.status === "waiting-open") return <Text dimColor>… waiting for open</Text>;
  if (view.status === "error") return <Text color="red" bold>! error</Text>;
  if (view.diverged) return <Text color="red" bold>! diverged</Text>;
  if (timeline.mode === "play")
    return (
      <Text color="green" bold>
        ▶ play · {delayLabel(timeline.delayMs)}
      </Text>
    );
  return <Text color="yellow" bold>■ paused</Text>;
}

function TimelineBar({ timeline, journalPath, busy }: { timeline: Timeline; journalPath: string; busy: boolean }) {
  const total = timeline.events.length;
  const tail = atTail(timeline);
  const position = total === 0 ? "no operations yet" : `◂ ${timeline.cursor + 1}/${total} ▸`;
  const event = currentEvent(timeline);
  return (
    // Fixed height: the timeline bar never yields rows to the panes above it.
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" height={6} flexShrink={0}>
      <Box justifyContent="space-between">
        <Text>
          <Text>{busy ? "…" : "›"} </Text>
          <Text color={total === 0 ? "gray" : tail ? "cyan" : "yellow"}>{position}</Text>
          {total > 0 ? <Text dimColor>  {progressBar(timeline.cursor, total)}</Text> : null}
        </Text>
        <Text dimColor wrap="truncate-end">journal: {journalPath}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        op: {event === undefined ? "(none)" : formatEventLine(event)}
      </Text>
      <Text dimColor wrap="truncate-end">
        ←/→ ops   Space {timeline.mode === "play" ? "pause" : "play"}   +/- speed   g/G first/last   Esc exit
      </Text>
      <Text dimColor wrap="truncate-end">
        ↑↓/PgUp/PgDn scroll
      </Text>
    </Box>
  );
}

function progressBar(cursor: number, total: number): string {
  const filled = Math.round(((cursor + 1) / total) * PROGRESS_WIDTH);
  return "▓".repeat(filled) + "░".repeat(Math.max(0, PROGRESS_WIDTH - filled));
}

function delayLabel(delayMs: number): string {
  return delayMs >= 1000 ? `${(delayMs / 1000).toFixed(1)}s` : `${delayMs}ms`;
}
