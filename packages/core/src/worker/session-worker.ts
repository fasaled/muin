import { parentPort } from "node:worker_threads";
import { MuinError } from "../errors.ts";
import { createSessionInProcess, type MuinSession } from "../session-local.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

type Host = {
  onMessage: (fn: (msg: WorkerRequest) => void) => void;
  post: (msg: WorkerResponse) => void;
};

function host(): Host {
  const thread = parentPort;
  if (thread) {
    return {
      onMessage: (fn) => {
        thread.on("message", fn);
      },
      post: (msg) => {
        thread.postMessage(msg);
      },
    };
  }
  if (typeof process.send === "function") {
    return {
      onMessage: (fn) => {
        process.on("message", (msg) => {
          fn(msg as WorkerRequest);
        });
      },
      post: (msg) => {
        process.send?.(msg);
      },
    };
  }
  throw new Error("session-worker must run as a worker thread or forked child");
}

const port = host();
let session: MuinSession | undefined;

function fail(id: number, err: unknown): WorkerResponse {
  if (err instanceof MuinError) {
    return { id, ok: false, error: { name: err.name, message: err.message, code: err.code } };
  }
  if (err instanceof Error) {
    return { id, ok: false, error: { name: err.name, message: err.message, code: "error" } };
  }
  return { id, ok: false, error: { name: "Error", message: String(err), code: "error" } };
}

port.onMessage(async (msg: WorkerRequest) => {
  try {
    switch (msg.type) {
      case "open": {
        session?.close();
        session = await createSessionInProcess(msg.filePath, msg.options);
        port.post({ id: msg.id, ok: true, snapshot: session.snapshot() } satisfies WorkerResponse);
        return;
      }
      case "run": {
        if (!session) throw new Error("no PDF session in worker");
        const result = await session.run(msg.line);
        port.post({
          id: msg.id,
          ok: true,
          result,
          snapshot: session.snapshot(),
        } satisfies WorkerResponse);
        return;
      }
      case "runCommand": {
        if (!session) throw new Error("no PDF session in worker");
        const result = await session.runCommand(msg.cmd);
        port.post({
          id: msg.id,
          ok: true,
          result,
          snapshot: session.snapshot(),
        } satisfies WorkerResponse);
        return;
      }
      case "close": {
        session?.close();
        session = undefined;
        port.post({ id: msg.id, ok: true } satisfies WorkerResponse);
        return;
      }
    }
  } catch (err) {
    port.post(fail(msg.id, err));
  }
});
