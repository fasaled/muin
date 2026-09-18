import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { bracketKind, type NeighborEntry, type Neighbors } from "@muin/core";
import { useFollowScroll, useViewportSize } from "./scroll.ts";

type Column = "incoming" | "outgoing";

type Props = {
  neighbors: Neighbors | null;
  focused: boolean;
  busy: boolean;
  onNavigate: (line: string) => void;
};

/** The kind span: a real "/Type" name renders plain, muin's own summary is bracketed and dim. */
function KindSpan({ kind, emphasize }: { kind: string; emphasize?: boolean }) {
  if (kind.startsWith("/")) {
    return emphasize ? (
      <Text color="green" bold>
        {kind}
      </Text>
    ) : (
      <Text>{kind}</Text>
    );
  }
  return <Text dimColor>{bracketKind(kind)}</Text>;
}

function EntryLine({ entry, selected, direction }: { entry: NeighborEntry; selected: boolean; direction: "in" | "out" }) {
  const marker = selected ? (direction === "in" ? "◀ " : "▶ ") : "  ";
  const selectedColor = direction === "in" ? "yellow" : "cyan";
  if (entry.missing) {
    return selected ? (
      <Text color={selectedColor} bold>{marker}{entry.ref}  {bracketKind("missing")}</Text>
    ) : (
      <Text dimColor>{marker}{entry.ref}  {bracketKind("missing")}</Text>
    );
  }
  const content = (
    <>
      {marker}
      {entry.ref}
      {entry.kind ? "  " : ""}
      {entry.kind ? <KindSpan kind={entry.kind} /> : null}
    </>
  );
  return selected ? <Text color={selectedColor} bold>{content}</Text> : <Text>{content}</Text>;
}

function NeighborColumn({
  title,
  entries,
  selectedIndex,
  direction,
}: {
  title: string;
  entries: NeighborEntry[];
  selectedIndex: number | undefined;
  direction: "in" | "out";
}) {
  const { ref, height } = useViewportSize();
  const viewportHeight = Math.max(1, height);
  const offset = useFollowScroll(selectedIndex, entries.length, viewportHeight);
  const visible = entries.slice(offset, offset + viewportHeight);

  return (
    <Box flexDirection="column" width={30}>
      <Text color={direction === "in" ? "yellow" : "cyan"} bold>
        {title}
      </Text>
      {entries.length === 0 ? (
        <Text dimColor>{bracketKind("none")}</Text>
      ) : (
        <Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden">
          {visible.map((entry, i) => (
            <EntryLine
              key={entry.ref}
              entry={entry}
              direction={direction}
              selected={offset + i === selectedIndex}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function GraphView({ neighbors, focused, busy, onNavigate }: Props) {
  const [column, setColumn] = useState<Column>("outgoing");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!neighbors) return;
    setColumn(neighbors.outgoing.entries.length > 0 ? "outgoing" : "incoming");
    setIndex(0);
    // Only the identity of the current node should reset the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neighbors?.current.ref]);

  useInput(
    (_input, key) => {
      if (!neighbors) return;
      const lists = { incoming: neighbors.incoming.entries, outgoing: neighbors.outgoing.entries };
      if (key.leftArrow || key.rightArrow) {
        const other: Column = column === "incoming" ? "outgoing" : "incoming";
        if (lists[other].length > 0) {
          setColumn(other);
          setIndex(0);
        }
        return;
      }
      if (key.upArrow) {
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setIndex((i) => Math.min(lists[column].length - 1, i + 1));
        return;
      }
      if (key.return) {
        const entry = lists[column][index];
        if (entry && !entry.missing) onNavigate(`cd ${entry.ref}`);
        return;
      }
    },
    { isActive: focused && !busy },
  );

  if (!neighbors) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>loading neighborhood…</Text>
      </Box>
    );
  }

  const empty = neighbors.incoming.entries.length === 0 && neighbors.outgoing.entries.length === 0;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      {empty ? (
        <Text dimColor>no references here — try cd or find</Text>
      ) : (
        <Box flexDirection="row" flexGrow={1}>
          <NeighborColumn
            title={`← incoming (${neighbors.incoming.total})`}
            entries={neighbors.incoming.entries}
            selectedIndex={column === "incoming" ? index : undefined}
            direction="in"
          />
          <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" paddingX={2}>
            <Box borderStyle="round" borderColor="green" paddingX={2} paddingY={1} flexDirection="column" alignItems="center">
              <Text dimColor>current node</Text>
              <Text>
              <Text color="green" bold>
                {neighbors.current.ref}
              </Text>
              {neighbors.current.kind ? "  " : ""}
              {neighbors.current.kind ? <KindSpan kind={neighbors.current.kind} emphasize /> : null}
              </Text>
            </Box>
          </Box>
          <NeighborColumn
            title={`outgoing (${neighbors.outgoing.total}) →`}
            entries={neighbors.outgoing.entries}
            selectedIndex={column === "outgoing" ? index : undefined}
            direction="out"
          />
        </Box>
      )}
    </Box>
  );
}
