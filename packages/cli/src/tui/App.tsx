import { Box, Text, useApp, useInput } from "ink";
import { memo, useCallback, useState } from "react";
import {
  formatBytes,
  formatProcessError,
  formatSnapshot,
  type CommandResult,
  type MuinSession,
  type SessionSnapshot,
} from "@muin/core";

type Props = {
  session: MuinSession;
};

type LogEntry = { kind: "cmd" | "out" | "err" | "info"; text: string };

const LOG_CAP = 40;
const RESULT_CAP = 8_000;

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
  return `${text.slice(0, RESULT_CAP)}\n… truncated ${text.length - RESULT_CAP} characters`;
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
      <Text dimColor>────────────────────────────────────────</Text>
    </Box>
  );
});

const LogView = memo(function LogView({ entries }: { entries: LogEntry[] }) {
  return (
    <Box flexDirection="column">
      {entries.map((entry, i) => {
        if (entry.kind === "err") {
          return (
            <Text key={i} color="red">
              {entry.text}
            </Text>
          );
        }
        if (entry.kind === "cmd") {
          return (
            <Text key={i} color="green">
              {entry.text}
            </Text>
          );
        }
        return (
          <Text key={i} dimColor={entry.kind === "info"}>
            {entry.text}
          </Text>
        );
      })}
    </Box>
  );
});

function Prompt({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (line: string) => void;
}) {
  const { exit } = useApp();
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [histPos, setHistPos] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c") || (key.ctrl && input === "d")) {
      exit();
      return;
    }
    if (busy) return;

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
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(draft.length, c + 1));
      return;
    }
    if (key.return) {
      const line = draft;
      setDraft("");
      setCursor(0);
      if (line.trim().length === 0) return;
      setHistory((h) => [...h, line].slice(-50));
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
  });

  const before = draft.slice(0, cursor);
  const after = draft.slice(cursor);

  return (
    <Box>
      <Text color={busy ? "yellow" : "green"}>{busy ? "…" : "›"} </Text>
      <Text>{before}</Text>
      <Text inverse>{after.length > 0 ? after[0] : " "}</Text>
      <Text>{after.slice(1)}</Text>
    </Box>
  );
}

export function App({ session }: Props) {
  const { exit } = useApp();
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(() => session.snapshot());
  const [log, setLog] = useState<LogEntry[]>([
    { kind: "info", text: `opened ${baseName(session.filePath)}` },
    { kind: "info", text: "help · back · quit   ↑ history   Ctrl+C exit" },
  ]);

  const onSubmit = useCallback(
    (line: string) => {
      setBusy(true);
      void (async () => {
        try {
          const result = await session.run(line);
          setSnap(session.snapshot());
          if (result.kind === "quit") {
            exit();
            return;
          }
          setLog((prev) =>
            [
              ...prev,
              { kind: "cmd" as const, text: `› ${line}` },
              { kind: "out" as const, text: renderResult(result) },
            ].slice(-LOG_CAP),
          );
        } catch (err) {
          setLog((prev) =>
            [
              ...prev,
              { kind: "cmd" as const, text: `› ${line}` },
              { kind: "err" as const, text: formatProcessError(err) },
            ].slice(-LOG_CAP),
          );
        } finally {
          setBusy(false);
        }
      })();
    },
    [exit, session],
  );

  return (
    <Box flexDirection="column">
      <Header file={baseName(session.filePath)} snap={snap} />
      <LogView entries={log} />
      <Prompt busy={busy} onSubmit={onSubmit} />
    </Box>
  );
}
