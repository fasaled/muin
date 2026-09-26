import type { JournalEvent } from "@muin/core";

/**
 * Follower timeline: a pure state machine over the journaled operation log. The cursor
 * always shows "what the agent's view looked like at that operation". Playback runs on
 * an observation clock (observation delays), never on the journal's real timestamps —
 * a burst of agent tool calls is consumed one operation per delay.
 */

export const FOLLOW_DEFAULT_DELAY_MS = 1_000;
export const FOLLOW_MIN_DELAY_MS = 100;
export const FOLLOW_MAX_DELAY_MS = 5_000;

export type FollowMode = "play" | "paused";

export type Timeline = {
  events: JournalEvent[];
  /** Index of the operation being viewed, -1 when the log is empty. */
  cursor: number;
  mode: FollowMode;
  delayMs: number;
};

export function createTimeline(delayMs = FOLLOW_DEFAULT_DELAY_MS): Timeline {
  return { events: [], cursor: -1, mode: "play", delayMs };
}

/**
 * Append new events. A fresh timeline (the follower just opened) jumps to the tail so
 * the first view is the agent's current state; after that the cursor stays put and
 * play/pause keys move it.
 */
export function appendEvents(timeline: Timeline, incoming: JournalEvent[]): Timeline {
  if (incoming.length === 0) return timeline;
  const events = [...timeline.events, ...incoming];
  const cursor = timeline.events.length === 0 && timeline.cursor === -1 ? events.length - 1 : timeline.cursor;
  return { ...timeline, events, cursor };
}

/** One autoplay tick: consumes the next operation when playing from behind the tail. */
export function tick(timeline: Timeline): Timeline {
  if (timeline.mode !== "play" || timeline.cursor >= timeline.events.length - 1) return timeline;
  return { ...timeline, cursor: timeline.cursor + 1 };
}

/** Manual stepping, forward or backward. Taking the wheel pauses autoplay. */
export function stepBy(timeline: Timeline, delta: -1 | 1): Timeline {
  if (timeline.events.length === 0) return timeline;
  return { ...timeline, mode: "paused", cursor: clamp(timeline.cursor + delta, 0, timeline.events.length - 1) };
}

/** Absolute jump (first/last operation). Keeps the current play/pause mode. */
export function seekTo(timeline: Timeline, index: number): Timeline {
  if (timeline.events.length === 0) return timeline;
  return { ...timeline, cursor: clamp(index, 0, timeline.events.length - 1) };
}

/** Drop the whole log (journal rotation): a fresh session starts empty, keeping the playback speed. */
export function clearTimeline(timeline: Timeline): Timeline {
  return createTimeline(timeline.delayMs);
}

export function togglePlay(timeline: Timeline): Timeline {
  return { ...timeline, mode: timeline.mode === "play" ? "paused" : "play" };
}

export function faster(timeline: Timeline): Timeline {
  return { ...timeline, delayMs: Math.max(FOLLOW_MIN_DELAY_MS, Math.floor(timeline.delayMs / 2)) };
}

export function slower(timeline: Timeline): Timeline {
  return { ...timeline, delayMs: Math.min(FOLLOW_MAX_DELAY_MS, timeline.delayMs * 2) };
}

export function currentEvent(timeline: Timeline): JournalEvent | undefined {
  return timeline.events[timeline.cursor];
}

/** Watching the latest operation — any new agent activity arrives at the cursor. */
export function atTail(timeline: Timeline): boolean {
  return timeline.cursor >= timeline.events.length - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
