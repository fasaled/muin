import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import { runLine, type Result } from "../commands/core.ts";
import { formatRef } from "../pdf/model.ts";
import type { PdfAdapter } from "../pdf/adapter.ts";
import type { Session } from "../graph/session.ts";

type Props = {
  session: Session;
  adapter: PdfAdapter;
};

function renderResult(result: Result): string {
  switch (result.kind) {
    case "text":
      return result.text;
    case "json":
      return JSON.stringify(result.value, null, 2);
    case "bytes":
      return `<${result.bytes.byteLength} bytes>`;
    case "quit":
      return "";
  }
}

export function App({ session: initial, adapter }: Props) {
  const { exit } = useApp();
  const [session, setSession] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([
    `opened ${initial.filePath}  cwd ${formatRef(initial.cwd)}`,
    "type help; quit to exit",
  ]);

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || (key.ctrl && input === "c") || (key.ctrl && input === "d")) {
      exit();
      return;
    }
    if (key.return) {
      const line = draft;
      setDraft("");
      if (line.trim().length === 0) return;
      setBusy(true);
      void (async () => {
        try {
          const out = await runLine(session, line, adapter);
          if (out.result.kind === "quit") {
            exit();
            return;
          }
          setSession(out.session);
          setLines((prev) => [...prev.slice(-80), `> ${line}`, renderResult(out.result)]);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setLines((prev) => [...prev.slice(-80), `> ${line}`, `error: ${message}`]);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setDraft((d) => d + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>
        muin {formatRef(session.cwd)} {session.path.join(" ")}
      </Text>
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      <Text>
        {busy ? "…" : ">"} {draft}
      </Text>
    </Box>
  );
}
