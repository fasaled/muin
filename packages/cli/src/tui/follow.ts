import { createElement } from "react";
import { render } from "ink";
import { stdin, stdout } from "node:process";
import {
  createSession,
  formatProcessError,
  tailJournal,
  type JournalEvent,
  type MuinSession,
  type Neighbors,
  type SessionOptions,
  type SessionSnapshot,
} from "@muin/core";
import { FollowApp } from "./FollowApp.tsx";

/**
 * Read-only observation runtime. The follower never runs user-typed commands: the only
 * thing driving its mirror session is the journal (`tailJournal`), replayed operation
 * by operation. The mirror session is a separate worker on the same PDF, so it can
 * never touch the agent's session.
 */

export type FollowSource = {
  subscribe(onEvents: (events: JournalEvent[]) => void, onReset?: () => void): () => void;
};

export function journalSource(path: string, intervalMs?: number): FollowSource {
  return {
    subscribe: (callback, onReset) => {
      const tail = tailJournal(path, callback, {
        ...(intervalMs === undefined ? {} : { intervalMs }),
        ...(onReset === undefined ? {} : { onReset }),
      });
      return () => tail.close();
    },
  };
}

export type MirrorView = {
  status: "waiting-open" | "ready" | "error";
  file?: string;
  snap?: SessionSnapshot;
  neighbors?: Neighbors | null;
  objectText?: string | null;
  overlay?: { title: string; body: string } | null;
  diverged?: boolean;
  message?: string;
};

export type Mirror = {
  /** Bring the mirror session to the state right after `events[index]` and describe it. Serialized: calls never interleave. */
  seekTo(events: JournalEvent[], index: number): Promise<MirrorView>;
  close(): void;
};

export type MirrorOptions = {
  openSession?: (path: string, options?: SessionOptions) => Promise<MuinSession>;
  cacheSize?: number;
};

export function createMirror(options: MirrorOptions = {}): Mirror {
  const opener = options.openSession ?? createSession;
  const cacheSize = options.cacheSize ?? 8;
  let session: MuinSession | undefined;
  let sessionFile: string | undefined;
  let applied = -1;
  let appliedOpenIndex = -1;
  let rootTarget: string | undefined;
  const cache = new Map<string, MirrorView>();
  let chain = Promise.resolve();

  const closeSession = (): void => {
    session?.close();
    session = undefined;
    sessionFile = undefined;
    applied = -1;
    appliedOpenIndex = -1;
    rootTarget = undefined;
  };

  const seek = async (events: JournalEvent[], index: number): Promise<MirrorView> => {
    const event = index >= 0 ? events[index] : undefined;
    if (!event) return waitingView("no operations yet");

    // The open segment active at `index`: the nearest lifecycle event below it wins.
    let openIndex = -1;
    for (let i = index; i >= 0; i--) {
      const candidate = events[i];
      if (candidate?.type === "close") {
        closeSession();
        return waitingView("agent closed the PDF", { title: "close", body: "closed" });
      }
      if (candidate?.type === "open") {
        openIndex = i;
        break;
      }
    }
    if (openIndex === -1) {
      closeSession();
      return waitingView("no PDF open yet");
    }
    const openEvent = events[openIndex];
    if (openEvent?.type !== "open") return waitingView("no PDF open yet");

    if (!session || sessionFile !== openEvent.path || appliedOpenIndex !== openIndex) {
      closeSession();
      try {
        session = await opener(
          openEvent.path,
          openEvent.maxBytes === undefined ? {} : { maxBytes: openEvent.maxBytes },
        );
      } catch (err) {
        return {
          status: "error",
          file: openEvent.path,
          neighbors: null,
          objectText: null,
          overlay: { title: "open", body: `error: ${formatProcessError(err)}` },
          message: formatProcessError(err),
        };
      }
      sessionFile = openEvent.path;
      appliedOpenIndex = openIndex;
      const root = session.snapshot().cwd;
      rootTarget = `${root.objectNumber} ${root.generation} R`;
      applied = openIndex;
    }
    const current = session;
    const root = rootTarget;
    if (!current || !root) return waitingView("no PDF open yet");

    const key = `${openIndex}:${index}`;
    const cached = cache.get(key);
    if (cached) return cached;

    // Seek: reset to the catalog ref (one in-memory op, no qpdf re-parse) when going
    // backwards, then replay only the ok navigation ops forward. Replaying exactly the
    // agent's successful nav sequence from the root lands on the same cwd by
    // construction; a snapshot compare below guards against anything else.
    if (index < applied) {
      await current.run(`cd ${root}`);
      applied = openIndex;
    }
    for (let i = applied + 1; i <= index; i++) {
      const candidate = events[i];
      if (
        candidate?.type === "cmd" &&
        candidate.ok &&
        candidate.cmd &&
        (candidate.cmd.name === "cd" || candidate.cmd.name === "back")
      ) {
        await current.runCommand(candidate.cmd);
      }
    }
    applied = index;

    const title = event.type === "open" ? "open" : event.type === "close" ? "close" : event.line;
    const overlay =
      event.type === "cmd" && !isNavigation(event)
        ? { title, body: event.ok ? (event.preview ?? "(no output)") : `error: ${event.error ?? "failed"}` }
        : event.type === "open"
          ? { title, body: `opened ${event.path}` }
          : null;

    const [neighborsResult, objectResult] = await Promise.all([current.run("neighbors"), current.run("ls")]);
    const snap = current.snapshot();
    const view: MirrorView = {
      status: "ready",
      file: sessionFile,
      snap,
      neighbors: neighborsResult.kind === "json" ? (neighborsResult.value as Neighbors) : null,
      objectText: objectResult.kind === "text" ? objectResult.text : null,
      overlay,
      diverged:
        event.type === "cmd" &&
        (snap.cwd.objectNumber !== event.snapshot.cwd.objectNumber ||
          snap.cwd.generation !== event.snapshot.cwd.generation),
    };
    cache.set(key, view);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    return view;
  };

  return {
    seekTo: (events, index) => {
      const next = chain.then(() => seek(events, index));
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    close: () => {
      cache.clear();
      closeSession();
    },
  };
}

function waitingView(message: string, overlay?: { title: string; body: string }): MirrorView {
  return {
    status: "waiting-open",
    neighbors: null,
    objectText: null,
    ...(overlay === undefined ? {} : { overlay }),
    message,
  };
}

function isNavigation(event: Extract<JournalEvent, { type: "cmd" }>): boolean {
  return event.cmd?.name === "cd" || event.cmd?.name === "back";
}

export async function startFollow(journalPath: string): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    await printFollow(journalPath);
    return;
  }
  const source = journalSource(journalPath);
  const mirror = createMirror();
  try {
    const instance = render(createElement(FollowApp, { source, mirror, journalPath }), {
      alternateScreen: true,
    });
    await instance.waitUntilExit();
  } finally {
    mirror.close();
  }
}

/** Non-TTY fallback: print journaled operations as they land, one line each. */
async function printFollow(journalPath: string): Promise<void> {
  stdout.write(`following ${journalPath} — Ctrl+C to exit\n`);
  const stop = journalSource(journalPath).subscribe((incoming) => {
    for (const event of incoming) stdout.write(`${formatEventLine(event)}\n`);
  });
  try {
    await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  } finally {
    stop();
  }
}

export function formatEventLine(event: JournalEvent): string {
  switch (event.type) {
    case "open":
      return `opened ${event.path}`;
    case "close":
      return "closed";
    case "cmd":
      return `$ ${event.line}${event.ok ? "" : `  [error] ${event.error ?? "failed"}`}`;
  }
}
