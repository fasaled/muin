import { measureElement, useInput, type DOMElement } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";

/** Measures a Box's rendered size after layout, so content can be paginated to exactly what fits. */
export function useViewportSize(): { ref: React.RefObject<DOMElement | null>; width: number; height: number } {
  const ref = useRef<DOMElement>(null);
  const [size, setSize] = useState({ width: 80, height: 10 });

  useEffect(() => {
    if (!ref.current) return;
    const { width, height } = measureElement(ref.current);
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      setSize({ width, height });
    }
  });

  return { ref, width: size.width, height: size.height };
}

/** Hard-wraps to a fixed width so one "screen row" always equals one array entry — needed for exact scrolling. */
export function wrapToWidth(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      out.push("");
      continue;
    }
    for (let i = 0; i < line.length; i += width) {
      out.push(line.slice(i, i + width));
    }
  }
  return out;
}

/**
 * Pages arbitrary text through a Box that measures its own size, scrolled with
 * ↑/↓/PageUp/PageDown. Resets to the top whenever `text` changes.
 */
export function useScrollableText(
  text: string,
  active: boolean,
  startAtEnd = false,
  scrollRequest?: { id: number; direction: "up" | "down" | "pageUp" | "pageDown" },
): {
  ref: React.RefObject<DOMElement | null>;
  visible: string[];
  clamped: number;
  total: number;
  hasMore: boolean;
} {
  const { ref, width, height } = useViewportSize();
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    setScroll(startAtEnd ? Number.MAX_SAFE_INTEGER : 0);
  }, [startAtEnd, text]);

  const lines = useMemo(() => wrapToWidth(text, Math.max(1, width)), [text, width]);
  const maxScroll = Math.max(0, lines.length - height);
  const clamped = Math.min(scroll, maxScroll);
  const visible = lines.slice(clamped, clamped + height);

  useEffect(() => {
    if (!scrollRequest) return;
    setScroll((current) => {
      if (scrollRequest.direction === "up") return Math.max(0, current - 1);
      if (scrollRequest.direction === "down") return Math.min(maxScroll, current + 1);
      if (scrollRequest.direction === "pageUp") return Math.max(0, current - height);
      return Math.min(maxScroll, current + height);
    });
  }, [height, maxScroll, scrollRequest]);

  useInput(
    (_input, key) => {
      if (key.upArrow) setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow) setScroll((s) => Math.min(maxScroll, s + 1));
      else if (key.pageUp) setScroll((s) => Math.max(0, s - height));
      else if (key.pageDown) setScroll((s) => Math.min(maxScroll, s + height));
    },
    { isActive: active },
  );

  return { ref, visible, clamped, total: lines.length, hasMore: maxScroll > 0 };
}

/**
 * Keeps `selectedIndex` inside a scrolled window of `itemCount` rows, shifting the
 * window (not the selection) when it would otherwise scroll off-screen.
 */
export function useFollowScroll(selectedIndex: number | undefined, itemCount: number, viewportHeight: number): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (selectedIndex === undefined) {
      setOffset(0);
      return;
    }
    setOffset((s) => {
      if (selectedIndex < s) return selectedIndex;
      if (selectedIndex >= s + viewportHeight) return Math.max(0, selectedIndex - viewportHeight + 1);
      return s;
    });
  }, [selectedIndex, viewportHeight]);

  const maxOffset = Math.max(0, itemCount - viewportHeight);
  return Math.min(offset, maxOffset);
}
