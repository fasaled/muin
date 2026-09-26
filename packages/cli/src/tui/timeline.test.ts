import { describe, expect, test } from "bun:test";
import type { JournalEvent } from "@muin/core";
import {
  appendEvents,
  atTail,
  clearTimeline,
  createTimeline,
  currentEvent,
  faster,
  FOLLOW_DEFAULT_DELAY_MS,
  FOLLOW_MAX_DELAY_MS,
  FOLLOW_MIN_DELAY_MS,
  seekTo,
  slower,
  stepBy,
  tick,
  togglePlay,
} from "./timeline.ts";

function event(line: string): JournalEvent {
  return {
    v: 1,
    ts: 1,
    type: "cmd",
    line,
    cmd: { name: "cd", target: "/Pages" },
    ok: true,
    snapshot: { cwd: { objectNumber: 3, generation: 0 }, path: ["/Root"], historyLength: 1 },
  };
}

function withEvents(...lines: string[]) {
  return appendEvents(createTimeline(), lines.map(event));
}

describe("timeline", () => {
  test("creates an empty paused-at-nothing timeline in play mode", () => {
    const t = createTimeline();
    expect(t).toEqual({ events: [], cursor: -1, mode: "play", delayMs: FOLLOW_DEFAULT_DELAY_MS });
    expect(currentEvent(t)).toBeUndefined();
    expect(atTail(t)).toBe(true);
  });

  test("first batch jumps to the tail; later batches do not move the cursor", () => {
    let t = createTimeline();
    t = appendEvents(t, [event("cd /Pages"), event("ls")]);
    expect(t.cursor).toBe(1);
    t = stepBy(stepBy(t, -1), -1);
    expect(t.cursor).toBe(0);
    t = appendEvents(t, [event("find")]);
    expect(t.cursor).toBe(0);
    expect(t.events).toHaveLength(3);
  });

  test("tick consumes one operation per call, only while playing", () => {
    let t = withEvents("a", "b", "c");
    t = stepBy(t, -1);
    t = stepBy(t, -1);
    expect(t.cursor).toBe(0);

    t = tick(t);
    expect(t.cursor).toBe(0); // paused: tick does nothing

    t = togglePlay(t);
    t = tick(t);
    t = tick(t);
    t = tick(t); // past the tail: still clamped
    expect(t.cursor).toBe(2);
    expect(t.mode).toBe("play");
  });

  test("manual stepping pauses autoplay and clamps at the ends", () => {
    let t = withEvents("a", "b");
    expect(t.mode).toBe("play");
    t = stepBy(t, -1);
    expect(t.mode).toBe("paused");
    expect(t.cursor).toBe(0);
    t = stepBy(t, -1);
    expect(t.cursor).toBe(0);
    t = stepBy(t, 1);
    t = stepBy(t, 1);
    expect(t.cursor).toBe(1);
  });

  test("seekTo jumps absolutely and keeps the mode", () => {
    let t = withEvents("a", "b", "c");
    t = stepBy(t, -1);
    t = seekTo(t, 0);
    expect(t.cursor).toBe(0);
    expect(t.mode).toBe("paused");
    t = seekTo(t, 99);
    expect(t.cursor).toBe(2);
    t = seekTo(t, -5);
    expect(t.cursor).toBe(0);
  });

  test("speed doubles and halves within bounds", () => {
    let t = createTimeline(1_000);
    t = faster(t);
    expect(t.delayMs).toBe(500);
    t = slower(t);
    expect(t.delayMs).toBe(1_000);
    t = createTimeline(FOLLOW_MAX_DELAY_MS);
    expect(slower(t).delayMs).toBe(FOLLOW_MAX_DELAY_MS);
    t = createTimeline(FOLLOW_MIN_DELAY_MS);
    expect(faster(t).delayMs).toBe(FOLLOW_MIN_DELAY_MS);
  });

  test("atTail distinguishes watching-latest from scrubbing-history", () => {
    const t = withEvents("a", "b");
    expect(atTail(t)).toBe(true);
    expect(currentEvent(t)?.line).toBe("b");
    const back = stepBy(t, -1);
    expect(atTail(back)).toBe(false);
  });

  test("clearTimeline drops the log but keeps the playback speed", () => {
    let t = appendEvents(createTimeline(500), [event("a"), event("b")]);
    t = stepBy(t, -1);
    t = clearTimeline(t);
    expect(t).toEqual({ events: [], cursor: -1, mode: "play", delayMs: 500 });
    expect(currentEvent(t)).toBeUndefined();
    t = appendEvents(t, [event("c")]);
    expect(t.cursor).toBe(0);
  });

  test("stepping an empty timeline is a no-op", () => {
    expect(stepBy(createTimeline(), 1).cursor).toBe(-1);
    expect(seekTo(createTimeline(), 4).cursor).toBe(-1);
    expect(tick(createTimeline()).cursor).toBe(-1);
  });
});
