import { Box, Text } from "ink";
import { memo, type ReactNode } from "react";
import { formatSnapshot, type SessionSnapshot } from "@muin/core";
import { useScrollableText } from "./scroll.ts";

/** Shared screen chrome: the TUI and the read-only follower render the same panes. */

export function baseName(path: string): string {
  return path.replace(/^.*[/\\]/, "") || path;
}

export const Header = memo(function Header({
  file,
  snap,
  badge,
}: {
  file: string;
  snap?: SessionSnapshot;
  badge?: ReactNode;
}) {
  return (
    // Fixed chrome never yields: when the middle panes overflow their flex share,
    // yoga must compress the scrollable panes, never the header.
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between">
        <Text>
          <Text color="cyan" bold>
            muin
          </Text>
          <Text dimColor>  {file}</Text>
        </Text>
        {badge}
      </Box>
      {snap ? <Text>{formatSnapshot(snap.cwd, snap.path)}</Text> : <Text dimColor>(no PDF open)</Text>}
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray" />
    </Box>
  );
});

export function ObjectView({ text, focused, busy }: { text: string | null; focused: boolean; busy: boolean }) {
  const { ref, visible, clamped, total, hasMore } = useScrollableText(text ?? "", focused && !busy);
  return (
    // The object pane absorbs whatever the graph leaves: it may shrink to nothing,
    // and pages its content to the measured remainder instead of overflowing it.
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
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
        <Box ref={ref} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
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

export type OverlayState = { title: string; body: string };

export function Overlay({
  title,
  body,
  busy,
  scrollRequest,
}: OverlayState & {
  busy: boolean;
  scrollRequest: { id: number; direction: "up" | "down" | "pageUp" | "pageDown" } | undefined;
}) {
  const { ref, visible, clamped, total, hasMore } = useScrollableText(body, !busy, title === "activity", scrollRequest);

  return (
    // Sole flexible child of the middle area when open; same yield-and-page contract as ObjectView.
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} borderStyle="round" borderColor="yellow" paddingX={1}>
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
      <Box ref={ref} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {visible.map((line, i) => (
          <Text key={clamped + i} wrap="truncate-end">
            {line.length > 0 ? line : " "}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
